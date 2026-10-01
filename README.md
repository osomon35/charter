# Charter

Private contract management and electronic signature. One owner, external
signers who never hold an account, and a document history where the original
upload is never mutated.

Next.js (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres, Auth,
Storage) · pdf-lib · pdf.js · Resend · Vercel.

---

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Auth, owner allowlist, route protection, app shell | Done |
| 2 | PDF upload, private storage, verification, thumbnails | Done |
| 3 | Full-screen overlay editor, flatten to new version | Done |
| 4 | Reusable signatures and initials | Done |
| 5 | Recipients, fields, routing, signer flow, audit, certificate | Done |
| 6 | Folders, tags, search, filters, archive, trash, reminders | Done |
| 7a | Members: invites, roles, blocking | Done |
| 7b | Workspaces (separate libraries per space) | **Not built** |

**What members can and cannot do:** invites, three roles and blocking are built
and enforced in RLS — `admin` manages members, `sender` works with contracts,
`signer` has no contract access at all. What is *not* built is per-person
visibility: everyone with contract access sees every contract. Separating that
needs workspaces, which re-scopes every policy again, so invite someone as
“Signs only” if they should not see the library.

---

## Setup

### 1. Supabase

Create a project. Then, in **SQL Editor → New query**, run each file in
[`supabase/migrations/`](supabase/migrations) in order, pasting the contents.
Migrations are applied by hand, not through the CLI.

Two things to know about this database's history:

* Several migrations begin by moving a same-named table into a timestamped
  `pre_charter_*` schema. This project's own database already contained tables
  called `contracts`, `contract_versions` and `signatures`, plus an
  `enforce_email_allowlist` function, from some earlier use. `create table if not
  exists` adopts such a table silently — no error, but without the expected
  columns — which surfaces later as PostgREST reporting a missing column. Those
  guards move the stranger aside rather than dropping it.
* Every migration ends with `notify pgrst, 'reload schema'`. Without it
  PostgREST keeps reporting columns as missing on a table that is already
  correct.

Before running `0001_init.sql`, edit its seed insert so it lists your address:

```sql
insert into public.owner_allowlist (email, note)
values ('you@example.com', 'owner')
on conflict (email) do nothing;
```

### 2. Create your user

**Authentication → Users → Add user**, your allowlisted address, tick *Auto
Confirm User*. Then **Authentication → Sign In / Providers → Allow new users to
sign up → off**.

Nothing in this schema touches `auth.users`. An earlier draft enforced the
allowlist with a trigger there; don't. An exception raised in an `auth.users`
trigger surfaces only as "Database error creating new user" and blocks all
account creation, with the real cause visible nowhere but the Postgres log.

### 3. Resend

1. **Domains → Add Domain**, then publish the DNS records it gives you. They sit
   on a `send.` subdomain plus a DKIM TXT, so existing email on the domain is
   unaffected.
2. **API Keys → Create**, sending access only.
3. Optional but worth it: point Supabase Auth's SMTP at Resend
   (`smtp.resend.com`, port 465, user `resend`, password = the API key).
   Supabase's shared sender caps at a handful of emails per hour, which silently
   breaks magic links once you start testing properly.

A From address does not need a mailbox to exist — only the domain needs
verifying. But replies to an address nobody reads are lost, so either use a real
address or rely on Reply-To.

### 4. Environment

Copy `.env.example` to `.env.local`, and paste the same values into **Vercel →
Settings → Environment Variables**. Every variable is documented in that file.
Mark `SUPABASE_SERVICE_ROLE_KEY`, `SIGNER_TOKEN_PEPPER` and `RESEND_API_KEY`
**Sensitive** so they cannot be read back out of the dashboard.

Generate the two secrets yourself:

```sh
openssl rand -base64 32   # SIGNER_TOKEN_PEPPER
openssl rand -base64 32   # CRON_SECRET
```

`SIGNER_TOKEN_PEPPER` is required before anything can be sent for signature, and
**must never change once links are live** — it is the key the stored token hashes
are derived from, so rotating it invalidates every outstanding signing link.

`NEXT_PUBLIC_APP_URL` is optional. Set it for a custom domain; leave it unset and
Vercel's own domain is used. A wrong value is worse than none — it puts a dead
host into every signing email.

### 5. Deploy

Import the repo into Vercel. The cron in [`vercel.json`](vercel.json) registers
itself on deploy.

Add your deployment origin to **Supabase → Authentication → URL Configuration →
Redirect URLs**, including `/auth/callback`.

---

## Before real use

- [ ] `REVEAL_SIGNING_LINKS` **unset**. It prints live signing credentials into
      the UI. A banner appears across the app while it is on.
- [ ] `SIGNER_TOKEN_PEPPER` set, Sensitive, and backed up somewhere.
- [ ] Service-role key rotated if it has ever been pasted anywhere shared.
- [ ] Signups disabled in Supabase.
- [ ] Resend domain verified, and a test envelope actually received.
- [ ] Your name set in **Settings → Account** — it is the From line recipients
      see.
- [ ] One end-to-end run: upload, edit, send, sign, confirm the signed PDF has a
      certificate page and that the audit trail reads correctly.

---

## Working on it

This machine has no Node runtime, so the loop is edit, commit, push, and let
GitHub Actions and the Vercel build do the verifying.

- `.github/workflows/ci.yml` runs typecheck, lint and build on every push. The
  build uses placeholder credentials — nothing may read a real secret at build
  time, only at request time.
- `.github/workflows/lockfile.yml` is manual (**Actions → Refresh lockfile → Run
  workflow**). Run it after any dependency change.

With Node available, `npm install` and `npm run dev` work as usual, and
`npm run seed` creates a few sample contracts with generated PDFs.

---

## Security model

**Every export from a `"use server"` file is a public HTTP endpoint.** Two
internal helpers were once exported from action files: one took a destination
address and a message body, making it an open mail relay through the project's
Resend account; the other completed an envelope by id, bypassing the requirement
that every recipient had signed. Both now live in plain server-only modules
(`lib/envelopes/notify.ts`, `lib/envelopes/complete.ts`). When adding an action,
check that it authorises before it acts.

**RLS, deny by default.** Every table has RLS enabled, with no permissive policy
for `anon`. Owner access is gated on `public.is_owner()`, which checks the JWT's
email against `owner_allowlist`; remove an address there and access ends
immediately, live session or not. RLS is enabled but never FORCEd — FORCE applies
to the table owner too, which locks out the `SECURITY DEFINER` functions that are
the only permitted writers of some tables.

**`requireOwner()`, not middleware.** `lib/auth.ts` is the boundary, called by
every protected page and every mutation. Middleware only refreshes the session
cookie and bounces anonymous page requests — deliberately, because Next.js
middleware has had header-spoofing bypasses (CVE-2025-29927) and cannot see which
row a request concerns. It does not run on `/api` at all; those routes authorise
themselves.

**Signer tokens.** 32 random bytes; what is stored is HMAC-SHA256(token, pepper).
The token exists only in the emailed URL and the incoming request — never logged,
never in an audit row, never shown back to the owner. Signing, declining, voiding
and expiring all clear the hash, which is what invalidates a link. A nudge
therefore mints a new token and invalidates the old one; the original cannot be
re-sent because it was never stored.

**`resolveSignerToken` is the whole authorization boundary for unauthenticated
signing**, in application code because no RLS policy can express "this bearer
token maps to this one recipient row". Refusals are indistinguishable from
outside — expired, wrong, already-signed and not-your-turn all present alike.

**Rate limiting** in Postgres, no Redis: login per IP and per address, the signer
page and its document fetch per IP and per token. Fails closed.

**Uploads** are verified after they land, not before: `%PDF-` magic bytes, page
count via pdf-lib, SHA-256. Nothing the client claims about a file is trusted or
stored. A rejected upload has its object and contract shell removed.

**The audit trail is append-only** — `audit_events` has select and insert
policies and no update or delete, so history cannot be rewritten through the API,
including by the owner. That is what makes the recorded hashes worth anything.

Public routes are exactly `/login`, `/auth/*`, `/sign/*`, `/api/sign/*` and
`/legal`.

**Not done:** there is no Content-Security-Policy header. Adding one means
allowing the pdf.js worker from jsdelivr, `blob:` and `data:` URIs, and Supabase
Storage, and getting it wrong breaks the editor silently. Worth doing with a
browser to hand.

---

## Layout

```
src/
  app/
    (app)/            Owner-only. Group layout calls requireOwner().
    editor/[id]/      Full-screen overlay editor (outside the shell)
    send/[id]/        Full-screen send flow (outside the shell)
    sign/[token]/     The signer experience — public, token-authorised
    api/
      versions/[id]/  Authorised document and thumbnail delivery
      sign/[token]/   The signer's own document fetch
      cron/           Daily maintenance, CRON_SECRET-authenticated
  components/
    ui/               Primitives
    editor/ send/ signer/ signatures/ contracts/ shell/ settings/
  lib/
    auth.ts           requireOwner() — the authorization boundary
    editor/           Element model, history, snapping, flatten
    envelopes/        Tokens, signer resolution, completion, certificate
    email/            Resend REST client, templates, sender identity
supabase/migrations/  Paste-ready SQL, applied by hand
```

---

## Electronic signature notice

Signatures created in Charter are **simple electronic signatures**. Their
validity rests on the signer's demonstrated intent to sign — captured through an
explicit consent step before any field can be completed — together with an audit
trail recording every view, signature and decline with a timestamp, IP address,
user agent, and a SHA-256 hash of the document at each stage. A certificate of
completion summarising this is appended to the final PDF.

This is consistent with the US ESIGN Act and with simple electronic signatures
under EU eIDAS (Regulation 910/2014). It is **not** an advanced or qualified
electronic signature. Charter is not a notarisation service, a certificate
authority, or a qualified trust service provider. Documents requiring
notarisation, a qualified certificate, or a witnessed signature under their
governing law need a different tool.

Not legal advice.
