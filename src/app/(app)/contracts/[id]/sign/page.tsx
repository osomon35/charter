import { redirect } from "next/navigation";

/**
 * The read-only preview this route used to serve is superseded by the
 * full-screen editor. Kept as a redirect so older links still land somewhere
 * sensible.
 */
export default async function SignRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/editor/${id}`);
}
