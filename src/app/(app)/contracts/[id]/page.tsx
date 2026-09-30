import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileText, PenLine } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { getContract, listVersions } from "@/lib/contracts/queries";
import { formatBytes } from "@/lib/contracts/types";
import { MetadataForm } from "@/components/contracts/metadata-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Contract" };

export default async function ContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const { id } = await params;

  const contract = await getContract(id);
  if (!contract) notFound();

  const versions = await listVersions(id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/contracts"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All contracts
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{contract.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {contract.latest
              ? `${contract.latest.page_count ?? "?"} pages · ${formatBytes(contract.latest.byte_size)} · version ${contract.latest.version_no}`
              : "No file attached"}
          </p>
        </div>

        {contract.latest ? (
          <div className="flex items-center gap-2">
            <a
              href={`/api/versions/${contract.latest.id}/file`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Download aria-hidden />
              Open PDF
            </a>
            <Link href={`/editor/${contract.id}`} className={buttonVariants({ size: "sm" })}>
              <PenLine aria-hidden />
              Edit &amp; sign
            </Link>
          </div>
        ) : null}
      </div>

      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <MetadataForm contract={contract} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Versions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {versions.map((version) => (
                <li key={version.id} className="flex items-center gap-3 px-5 py-3.5">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      Version {version.version_no}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {version.kind}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {version.original_name ?? "—"} ·{" "}
                      {new Date(version.created_at).toLocaleString()}
                    </p>
                    {version.sha256 ? (
                      <p
                        className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                        title={version.sha256}
                      >
                        sha256 {version.sha256.slice(0, 32)}…
                      </p>
                    ) : null}
                  </div>
                  {version.state !== "ready" ? (
                    <Badge className="border-border bg-muted text-muted-foreground">
                      {version.state}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
        The original upload is never modified. Editing and signing, in the next phases,
        append a new version and leave version 1 byte-for-byte as it arrived — which is
        what makes its SHA-256 worth recording.
      </p>
    </div>
  );
}
