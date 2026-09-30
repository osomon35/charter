import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateToken, hashToken } from "@/lib/envelopes/tokens";
import { notifyRecipient } from "@/lib/envelopes/notify";
import { recordAudit } from "@/lib/envelopes/audit";

/**
 * Daily housekeeping, run by Vercel Cron.
 *
 * Three jobs, none of which anything else does:
 *
 *   1. Prune spent rate-limit windows. That table gains a row per bucket per
 *      window and nothing was ever deleting them.
 *   2. Mark envelopes whose links have expired. Expiry is already enforced when
 *      a token is resolved, so this is about the owner's view being honest
 *      rather than about access.
 *   3. Send auto-reminders for envelopes configured with one.
 *   4. Purge contracts soft-deleted more than 30 days ago, and their stored
 *      objects, which is the promise the Trash makes.
 *
 * Authenticated by CRON_SECRET, compared in constant time. Vercel sends it as a
 * Bearer token; without it this endpoint is a way for anyone to trigger a purge.
 */
const PURGE_AFTER_DAYS = 30;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (provided.length !== secret.length || provided.length === 0) return false;

  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  const report: Record<string, unknown> = {};

  // 1. Rate-limit windows.
  const { error: pruneError } = await admin.rpc("prune_rate_limits");
  report.rate_limits = pruneError ? `failed: ${pruneError.message}` : "pruned";

  // 2. Expired envelopes.
  const nowIso = new Date().toISOString();
  const { data: expired, error: expireError } = await admin
    .from("envelopes")
    .update({ status: "expired" })
    .in("status", ["sent", "partially_signed"])
    .lt("expires_at", nowIso)
    .select("id");

  report.envelopes_expired = expireError ? `failed: ${expireError.message}` : (expired ?? []).length;

  if (expired && expired.length > 0) {
    // Expiry revokes the links too; leaving live hashes on a dead envelope would
    // mean the expiry check was the only thing standing between them and a
    // signature.
    await admin
      .from("recipients")
      .update({ token_hash: null })
      .in("envelope_id", expired.map((row) => row.id))
      .neq("status", "signed");
  }

  // 3. Auto-reminders.
  report.reminders_sent = await sendAutoReminders();

  // 4. Purge the trash.
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - PURGE_AFTER_DAYS);

  const { data: doomed } = await admin
    .from("contracts")
    .select("id")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff.toISOString());

  let purged = 0;
  for (const contract of (doomed ?? []) as { id: string }[]) {
    // Storage first: the row's cascade would otherwise orphan the objects with
    // nothing left pointing at them.
    await removeStoredObjects(contract.id);
    const { error } = await admin.from("contracts").delete().eq("id", contract.id);
    if (!error) purged += 1;
  }
  report.contracts_purged = purged;

  return NextResponse.json({ ok: true, at: nowIso, ...report });
}

/**
 * Nudges recipients on envelopes that asked for reminders.
 *
 * A reminder has to mint a fresh token, because the stored hash is one-way and
 * the original link is unrecoverable by design. That invalidates the previous
 * link, which is the correct trade: a recipient following an old email gets a
 * dead link rather than two live credentials existing at once.
 *
 * Paced off whichever is later of the last reminder and the original
 * notification, so turning reminders on for an old envelope does not fire
 * immediately.
 */
async function sendAutoReminders(): Promise<number> {
  const admin = createAdminClient();

  const { data: envelopes } = await admin
    .from("envelopes")
    .select(
      "id, contract_id, message, expires_at, reminder_after_days, last_reminder_at, sent_at, contracts(title)",
    )
    .in("status", ["sent", "partially_signed"])
    .not("reminder_after_days", "is", null);

  let sent = 0;

  for (const envelope of (envelopes ?? []) as EnvelopeForReminder[]) {
    const days = envelope.reminder_after_days;
    if (!days) continue;

    const since = envelope.last_reminder_at ?? envelope.sent_at;
    if (!since) continue;

    const dueAt = new Date(since).getTime() + days * 86_400_000;
    if (Date.now() < dueAt) continue;

    const { data: pending } = await admin
      .from("recipients")
      .select("id, name, email, status")
      .eq("envelope_id", envelope.id)
      .not("status", "in", "(signed,declined)");

    let anySent = false;

    for (const recipient of (pending ?? []) as { id: string; name: string; email: string }[]) {
      const token = generateToken();
      await admin
        .from("recipients")
        .update({ token_hash: hashToken(token), token_expires_at: envelope.expires_at })
        .eq("id", recipient.id);

      const result = await notifyRecipient({
        recipientId: recipient.id,
        token,
        name: recipient.name,
        email: recipient.email,
        senderName: "Charter",
        documentTitle: envelope.contracts?.title ?? "your document",
        message: envelope.message,
        expiresAt: envelope.expires_at,
      });

      if (result.ok) {
        anySent = true;
        sent += 1;
        await recordAudit({
          contractId: envelope.contract_id,
          envelopeId: envelope.id,
          recipientId: recipient.id,
          kind: "reminded",
          actor: "system",
          detail: { email: recipient.email, automatic: true },
        });
      }
    }

    if (anySent) {
      await admin
        .from("envelopes")
        .update({ last_reminder_at: new Date().toISOString() })
        .eq("id", envelope.id);
    }
  }

  return sent;
}

type EnvelopeForReminder = {
  id: string;
  contract_id: string;
  message: string | null;
  expires_at: string | null;
  reminder_after_days: number | null;
  last_reminder_at: string | null;
  sent_at: string | null;
  contracts: { title: string } | null;
};

/** Removes everything under a contract's prefix in the private bucket. */
async function removeStoredObjects(contractId: string): Promise<void> {
  const admin = createAdminClient();

  // Storage has no recursive delete, so each prefix is listed and removed.
  for (const prefix of [contractId, `${contractId}/assets`, `${contractId}/signer`]) {
    const { data } = await admin.storage.from("contracts").list(prefix, { limit: 1000 });
    const files = (data ?? []).filter((entry) => entry.id !== null);
    if (files.length > 0) {
      await admin.storage
        .from("contracts")
        .remove(files.map((entry) => `${prefix}/${entry.name}`));
    }
  }

  // Version folders are one level deeper again.
  const { data: folders } = await admin.storage.from("contracts").list(contractId, { limit: 1000 });
  for (const folder of (folders ?? []).filter((entry) => entry.id === null)) {
    const { data } = await admin.storage
      .from("contracts")
      .list(`${contractId}/${folder.name}`, { limit: 1000 });
    const files = (data ?? []).filter((entry) => entry.id !== null);
    if (files.length > 0) {
      await admin.storage
        .from("contracts")
        .remove(files.map((entry) => `${contractId}/${folder.name}/${entry.name}`));
    }
  }
}
