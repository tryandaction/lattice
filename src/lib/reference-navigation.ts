import { findMarkdownHeadingLine, type MarkdownNavigationOutlineItem } from "./markdown-navigation";
import type { WorkspaceNavigationTarget } from "./link-router/types";
import { findReferenceTextRange, type ReferenceTextRange } from "./reference-text-range";

export type ReferenceNavigationResolution =
  | { status: "success"; line?: number; cellId?: string; range?: ReferenceTextRange }
  | { status: "quote_not_found" };

export function resolveMarkdownReference(
  target: WorkspaceNavigationTarget,
  outline: MarkdownNavigationOutlineItem[],
  lineCount: number,
  content?: string,
): ReferenceNavigationResolution | null {
  let line: number | undefined;
  if (target.type === "workspace_heading") {
    line = findMarkdownHeadingLine(outline, target.heading);
  } else if (target.type === "code_line") {
    line = target.line;
  } else if (target.type === "workspace_text") {
    const range = content ? findReferenceTextRange(content, target.snippet) : null;
    if (!range) return { status: "quote_not_found" };
    line = content!.slice(0, range.from).split(/\r?\n/).length;
    return line <= lineCount ? { status: "success", line, range } : { status: "quote_not_found" };
  } else {
    return null;
  }

  return line && line >= 1 && line <= lineCount
    ? { status: "success", line }
    : { status: "quote_not_found" };
}

export function resolveCodeReference(
  target: WorkspaceNavigationTarget,
  lineCount: number,
  content?: string,
): ReferenceNavigationResolution | null {
  if (target.type === "workspace_text") {
    const range = content ? findReferenceTextRange(content, target.snippet) : null;
    if (!range) return { status: "quote_not_found" };
    const line = content!.slice(0, range.from).split(/\r?\n/).length;
    return line <= lineCount ? { status: "success", line, range } : { status: "quote_not_found" };
  }
  if (target.type !== "code_line") {
    return null;
  }

  return target.line >= 1 && target.line <= lineCount
    ? { status: "success", line: target.line }
    : { status: "quote_not_found" };
}

export function resolveNotebookReference(
  target: WorkspaceNavigationTarget,
  cellIds: string[],
): ReferenceNavigationResolution | null {
  if (target.type !== "notebook_cell") {
    return null;
  }

  return cellIds.includes(target.cellId)
    ? { status: "success", cellId: target.cellId }
    : { status: "quote_not_found" };
}
