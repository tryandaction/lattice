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

function positiveInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function parseFragmentTarget(path: string, fragment: string): LinkTarget | null {
  const params = new URLSearchParams(fragment);
  const page = params.get("page");
  const line = params.get("line");
  const cellId = params.get("cell");
  const snippet = params.get("text") ?? params.get("quote");
  const annotationId = params.get("annotation") ?? params.get("ann");

  if (fragment.startsWith("ann-")) {
    return { type: "pdf_annotation", path, annotationId: safeDecodeLinkTarget(fragment) };
  }

  if (annotationId?.trim()) {
    const pageNumber = positiveInteger(page);
    return pageNumber !== undefined
      ? { type: "pdf_annotation", path, annotationId, page: pageNumber }
      : { type: "pdf_annotation", path, annotationId };
  }

  if (page !== null) {
    const pageNumber = positiveInteger(page);
    if (pageNumber === undefined) return null;
    return { type: "pdf_page", path, page: pageNumber, ...(snippet?.trim() ? { snippet: snippet.trim() } : {}) };
  }

  if (line !== null) {
    const range = line.match(/^(\d+)-(\d+)$/);
    const lineNumber = positiveInteger(range ? range[1] : line);
    if (range) {
      const end = positiveInteger(range[2]);
      if (lineNumber === undefined || end === undefined || end < lineNumber) return null;
    }
    return lineNumber === undefined ? null : { type: "code_line", path, line: lineNumber };
  }

  if (cellId) {
    return { type: "notebook_cell", path, cellId };
  }

  if (snippet?.trim()) {
    return { type: "workspace_text", path, snippet: snippet.trim() };
  }

  if (isPdfWorkspacePath(path)) {
    return { type: "pdf_annotation", path, annotationId: safeDecodeLinkTarget(fragment) };
  }

  return { type: "workspace_heading", path, heading: safeDecodeLinkTarget(fragment) };
}

function resolveWorkspacePath(pathPart: string, currentFilePath?: string, pathMode: "relative" | "workspace" = "relative"): string {
  if (!pathPart) {
    return currentFilePath ? normalizeWorkspacePath(currentFilePath) : "";
  }

  if (pathPart.startsWith("/")) {
    return normalizeWorkspacePath(pathPart.slice(1));
  }

  if (pathMode === "workspace") {
    return normalizeWorkspacePath(pathPart);
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
  // Split syntax before decoding values. Decoding the whole link corrupts
  // encoded delimiters in file names, URLs, and quoted scientific text.
  const normalized = unwrapWikiLinkTarget(rawTarget.trim());
  if (!normalized) {
    return { raw: rawTarget, normalized, target: null };
  }

  const systemPath = isLikelySystemPath(normalized);
  if (systemPath && options.pathMode !== "workspace") {
    return {
      raw: rawTarget,
      normalized,
      target: { type: "system_path", path: normalized.startsWith("file://") ? toSystemPath(normalized) : safeDecodeLinkTarget(normalized) },
    };
  }

  if (!systemPath && isExternalUrl(normalized)) {
    return {
      raw: rawTarget,
      normalized,
      target: { type: "external_url", url: normalized },
    };
  }

  const hashIndex = normalized.indexOf("#");
  const pathPart = hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized;
  const fragment = hashIndex >= 0 ? normalized.slice(hashIndex + 1) : "";
  const resolvedPath = systemPath
    ? normalizeWorkspacePath(pathPart.startsWith("file://") ? toSystemPath(pathPart) : safeDecodeLinkTarget(pathPart))
    : resolveWorkspacePath(safeDecodeLinkTarget(pathPart), options.currentFilePath, options.pathMode);

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
