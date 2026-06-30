import {
  isExternalUrl,
  isLikelySystemPath,
  normalizeWorkspacePath,
  resolveRelativeWorkspacePath,
  safeDecodeLinkTarget,
  toSystemPath,
} from "./path-utils";
import type { LinkTarget, ParsedLinkTarget, ParseLinkTargetOptions } from "./types";

function unwrapWikiLinkTarget(target: string): string {
  const match = target.match(/^!?\[\[([\s\S]+)\]\]$/);
  if (!match) {
    return target;
  }

  const inner = match[1].trim();
  const aliasIndex = inner.indexOf("|");
  return (aliasIndex >= 0 ? inner.slice(0, aliasIndex) : inner).trim();
}

function isPdfWorkspacePath(path: string): boolean {
  return /\.pdf$/i.test(path);
}

function parseFragmentTarget(path: string, fragment: string): LinkTarget {
  const params = new URLSearchParams(fragment);
  const page = params.get("page");
  const line = params.get("line");
  const cellId = params.get("cell");
  const annotationId = params.get("annotation") ?? params.get("ann");

  if (fragment.startsWith("ann-")) {
    return { type: "pdf_annotation", path, annotationId: fragment };
  }

  if (annotationId?.trim()) {
    const pageNumber = page ? Number.parseInt(page, 10) : Number.NaN;
    return Number.isFinite(pageNumber) && pageNumber > 0
      ? { type: "pdf_annotation", path, annotationId, page: pageNumber }
      : { type: "pdf_annotation", path, annotationId };
  }

  if (page) {
    const pageNumber = Number.parseInt(page, 10);
    if (Number.isFinite(pageNumber) && pageNumber > 0) {
      return { type: "pdf_page", path, page: pageNumber };
    }
  }

  if (line) {
    const lineNumber = Number.parseInt(line, 10);
    if (Number.isFinite(lineNumber) && lineNumber > 0) {
      return { type: "code_line", path, line: lineNumber };
    }
  }

  if (cellId) {
    return { type: "notebook_cell", path, cellId };
  }

  if (isPdfWorkspacePath(path)) {
    return { type: "pdf_annotation", path, annotationId: fragment };
  }

  return { type: "workspace_heading", path, heading: fragment };
}

function resolveWorkspacePath(pathPart: string, currentFilePath?: string): string {
  if (!pathPart) {
    return currentFilePath ? normalizeWorkspacePath(currentFilePath) : "";
  }

  if (pathPart.startsWith("/")) {
    return normalizeWorkspacePath(pathPart.slice(1));
  }

  if (currentFilePath) {
    return resolveRelativeWorkspacePath(currentFilePath, pathPart);
  }

  return normalizeWorkspacePath(pathPart);
}

export function parseLinkTarget(
  rawTarget: string,
  options: ParseLinkTargetOptions = {}
): ParsedLinkTarget {
  const normalized = unwrapWikiLinkTarget(safeDecodeLinkTarget(rawTarget.trim()));
  if (!normalized) {
    return { raw: rawTarget, normalized, target: null };
  }

  if (isLikelySystemPath(normalized)) {
    return {
      raw: rawTarget,
      normalized,
      target: { type: "system_path", path: toSystemPath(normalized) },
    };
  }

  if (isExternalUrl(normalized)) {
    return {
      raw: rawTarget,
      normalized,
      target: { type: "external_url", url: normalized },
    };
  }

  const hashIndex = normalized.indexOf("#");
  const pathPart = hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized;
  const fragment = hashIndex >= 0 ? normalized.slice(hashIndex + 1) : "";
  const resolvedPath = resolveWorkspacePath(pathPart, options.currentFilePath);

  if (!fragment) {
    return {
      raw: rawTarget,
      normalized,
      target: resolvedPath ? { type: "workspace_file", path: resolvedPath } : null,
    };
  }

  if (!resolvedPath) {
    return { raw: rawTarget, normalized, target: null };
  }

  return {
    raw: rawTarget,
    normalized,
    target: parseFragmentTarget(resolvedPath, fragment),
  };
}
