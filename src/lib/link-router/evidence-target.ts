import type { LinkTarget, WorkspaceEvidenceAnchor } from "./types";

/** Shared by citation display and actual navigation so their targets cannot drift. */
export function attachEvidenceAnchor(target: LinkTarget, anchor?: WorkspaceEvidenceAnchor): LinkTarget {
  if (!anchor) return target;
  const page = Number.isSafeInteger(anchor.page) && (anchor.page ?? 0) > 0 ? anchor.page : undefined;
  if (target.type === "workspace_file" && /\.pdf$/i.test(target.path) && page !== undefined) {
    return attachEvidenceAnchor({ type: "pdf_page", path: target.path, page }, anchor);
  }
  if (target.type === "pdf_page") {
    // Geometry and quotes belong to their evidence page. An explicit link to
    // another page must not inherit the current reader page's anchor.
    if (page !== undefined && page !== target.page) return target;
    // The link can point to a different passage on the same page. Geometry
    // from the broader/previous selection must never replace that exact quote.
    if (target.snippet?.trim() && target.snippet.trim() !== anchor.snippet?.trim()) return target;
    return {
      ...target,
      ...(anchor.snippet?.trim() ? { snippet: anchor.snippet.trim() } : {}),
      ...(anchor.rects?.length ? { rects: anchor.rects } : {}),
    };
  }
  if (target.type === "workspace_file" && anchor.snippet?.trim()) {
    return { type: "workspace_text", path: target.path, snippet: anchor.snippet.trim() };
  }
  return target;
}
