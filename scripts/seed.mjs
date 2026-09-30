/**
 * Development seed. Creates a handful of contracts with generated PDFs so the
 * dashboard and list views have something in them.
 *
 *   node scripts/seed.mjs
 *
 * Reads .env.local. Uses the service-role key, so it bypasses RLS — never
 * point it at anything but a development project.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) env[match[1]] = match[2].trim();
    }
  } catch {
    // Fall through to process.env.
  }
  return { ...env, ...process.env };
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SAMPLES = [
  { title: "Master Services Agreement", counterparty: "Northwind Studios", status: "draft", pages: 4 },
  { title: "Freelance Design Contract", counterparty: "Ana Ferreira", status: "sent", pages: 3 },
  { title: "Mutual NDA", counterparty: "Harbour Labs", status: "partially_signed", pages: 2 },
  { title: "Statement of Work 014", counterparty: "Cobalt Retail", status: "completed", pages: 6 },
  { title: "Equipment Rental Terms", counterparty: "Praça AV", status: "expired", pages: 2 },
];

async function buildPdf({ title, counterparty, pages }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(title, { x: 56, y: 770, size: 18, font: bold });
    page.drawText(`Between Charter and ${counterparty}`, { x: 56, y: 744, size: 11, font });
    page.drawText(`Page ${i + 1} of ${pages}`, { x: 56, y: 60, size: 9, font });

    let y = 700;
    for (let line = 0; line < 22; line += 1) {
      page.drawText(
        `${line + 1}. Sample clause text for development purposes only.`,
        { x: 56, y, size: 10, font },
      );
      y -= 22;
    }
  }

  return Buffer.from(await doc.save());
}

const owner = await supabase.from("owner_allowlist").select("email").limit(1).maybeSingle();
if (!owner.data) {
  console.error("owner_allowlist is empty — run the migrations first.");
  process.exit(1);
}

for (const sample of SAMPLES) {
  const { data: contract, error } = await supabase
    .from("contracts")
    .insert({
      title: sample.title,
      counterparty_name: sample.counterparty,
      status: sample.status,
      notes: "Seeded sample. Safe to delete.",
    })
    .select("id")
    .single();

  if (error) {
    console.error(`  ${sample.title}: ${error.message}`);
    continue;
  }

  const bytes = await buildPdf(sample);
  const path = `${contract.id}/v1/original.pdf`;

  const upload = await supabase.storage
    .from("contracts")
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });

  if (upload.error) {
    console.error(`  ${sample.title}: ${upload.error.message}`);
    continue;
  }

  await supabase.from("contract_versions").insert({
    contract_id: contract.id,
    version_no: 1,
    kind: "original",
    state: "ready",
    storage_path: path,
    original_name: `${sample.title}.pdf`,
    byte_size: bytes.length,
    page_count: sample.pages,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });

  console.log(`  seeded ${sample.title}`);
}

console.log("Done.");
