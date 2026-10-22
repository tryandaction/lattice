import { CloudLibraryWorkspace } from "@/components/shared-library/cloud-library-workspace";

export function generateStaticParams(): Array<{ libraryId: string }> {
  // `output: export` requires every dynamic route to enumerate at least one
  // static path (an empty array is rejected by Next as "missing
  // generateStaticParams"). In-app navigation is client-side (store-driven);
  // this placeholder exports `/library/__index__`, which renders the shell's
  // fallback. Real deep links are served by the SPA fallback on the static host.
  return [{ libraryId: "__index__" }];
}

export default async function LibraryDetailPage({
  params,
}: {
  params: Promise<{ libraryId: string }>;
}) {
  const { libraryId } = await params;
  return <CloudLibraryWorkspace initialLibraryId={libraryId === "__index__" ? undefined : libraryId} />;
}
