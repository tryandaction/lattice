import type { CloudWorkspaceAnchor } from "@/lib/cloud-workspace-host";
import type { WorkspaceNavigationTarget } from "@/lib/link-router/types";
import type { CloudLibraryResource } from "./source-provider";

/** The static host keeps the original path while serving the exported library shell. */
export function parseSharedLibraryPath(pathname: string | null | undefined): { libraryId: string | null; itemId: string | null } {
  const segments = (pathname ?? "").split("/").filter(Boolean).map(segment => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  });
  if (segments[0] !== "library" || !segments[1] || segments[1] === "__index__") return { libraryId: null, itemId: null };
  return { libraryId: segments[1], itemId: segments[2] === "item" && segments[3] ? segments[3] : null };
}

/** Existing viewer navigation consumes the virtual source path; it never resolves it as a local file. */
export function cloudNavigationTarget(resource: CloudLibraryResource, anchor?: CloudWorkspaceAnchor): WorkspaceNavigationTarget | null {
  if (!anchor) return null;
  if (anchor.page !== undefined && resource.kind === "pdf") {
    if (!Number.isInteger(anchor.page) || anchor.page < 1) throw new Error("PDF页码必须是正整数。");
    return { type: "pdf_page", path: resource.path, page: anchor.page, ...(anchor.snippet ? { snippet: anchor.snippet } : {}) };
  }
  if (anchor.line !== undefined && resource.kind === "code") {
    if (!Number.isInteger(anchor.line) || anchor.line < 1) throw new Error("代码行号必须是正整数。");
    return { type: "code_line", path: resource.path, line: anchor.line };
  }
  if (anchor.cellId && resource.kind === "notebook") return { type: "notebook_cell", path: resource.path, cellId: anchor.cellId };
  if (anchor.snippet && resource.kind === "markdown") return { type: "workspace_text", path: resource.path, snippet: anchor.snippet };
  return null;
}
