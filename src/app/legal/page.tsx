import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Electronic signature notice",
  robots: { index: false, follow: false },
};

export default function LegalPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">Electronic signature notice</h1>

      <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          Signatures created in Charter are <strong className="font-medium text-foreground">simple
          electronic signatures</strong>. Their validity rests on two things: the signer&apos;s
          demonstrated intent to sign, captured through an explicit consent step before any
          field can be completed, and an audit trail recorded alongside the document.
        </p>
        <p>
          That audit trail records each view, signature, and decline, with a timestamp, the
          originating IP address, the browser user agent, and a SHA-256 hash of the document
          at each stage. The hashes let anyone confirm afterwards that the file has not
          changed since it was signed. A certificate of completion summarising all of this is
          appended to the final PDF.
        </p>
        <p>
          This approach is consistent with the US ESIGN Act and with simple electronic
          signatures under EU eIDAS (Regulation 910/2014). It is{" "}
          <strong className="font-medium text-foreground">not</strong> an advanced or
          qualified electronic signature, and Charter is not a notarisation service, a
          certificate authority, or a qualified trust service provider. Documents that
          require notarisation, a qualified certificate, or a witnessed signature under the
          law that governs them need a different tool.
        </p>
        <p>
          Nothing here is legal advice. Whether an electronic signature suffices for a given
          agreement depends on the document and the jurisdiction.
        </p>
      </div>
    </main>
  );
}
