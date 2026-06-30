import { isSameWorkspacePath, normalizeWorkspacePath } from "@/lib/link-router/path-utils";

export interface MarkdownNavigationOutlineItem {
  text: string;
  line: number;
  children?: MarkdownNavigationOutlineItem[];
}

function safeDecodeFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeMarkdownHeadingFragment(value: string): string {
  return safeDecodeFragment(value)
    .trim()
    .replace(/\s+#+$/u, "")
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function findMarkdownHeadingLine(
  items: MarkdownNavigationOutlineItem[],
  target: string,
): number | undefined {
  const normalizedTarget = normalizeMarkdownHeadingFragment(target);
  if (!normalizedTarget) {
    return undefined;
  }

  const stack = [...items];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) continue;
    if (normalizeMarkdownHeadingFragment(current.text) === normalizedTarget) {
      return current.line;
    }
    if (current.children?.length) {
      stack.push(...current.children);
    }
  }

  return undefined;
}

function stripWorkspaceRootPrefix(path: string, workspaceRootName?: string): string {
  const normalized = normalizeWorkspacePath(path);
  const rootName = workspaceRootName ? normalizeWorkspacePath(workspaceRootName) : "";
  if (!rootName) {
    return normalized;
  }

  const prefix = `${rootName}/`;
  return normalized === rootName
    ? ""
    : normalized.startsWith(prefix)
      ? normalized.slice(prefix.length)
      : normalized;
}

export function isPendingNavigationForFile(
  pendingFilePath: string,
  currentFilePath: string,
  workspaceRootName?: string,
): boolean {
  if (isSameWorkspacePath(pendingFilePath, currentFilePath)) {
    return true;
  }

  const pendingWithoutRoot = stripWorkspaceRootPrefix(pendingFilePath, workspaceRootName);
  const currentWithoutRoot = stripWorkspaceRootPrefix(currentFilePath, workspaceRootName);
  return Boolean(pendingWithoutRoot && currentWithoutRoot && isSameWorkspacePath(pendingWithoutRoot, currentWithoutRoot));
}
