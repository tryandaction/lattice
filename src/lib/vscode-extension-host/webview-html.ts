"use client";

import { resolveDesktopPreviewUrl, resolveDesktopWebviewResourceUrl } from "@/lib/desktop-preview";
import { isTauriHost } from "@/lib/storage-adapter";

export const VSCODE_WEBVIEW_RESOURCE_SCHEME = "lattice-webview-resource:";
export const LATTICE_PREVIEW_CSP_SOURCE = "lattice-preview:";

function resolveWebviewResourceUrl(filePath: string): string {
  const hasDirectorySuffix = /[\\/]$/.test(filePath);
  const normalized = filePath.replace(/\\/g, "/");
  const resolved = isTauriHost() ? resolveDesktopWebviewResourceUrl(normalized) : normalized;
  return hasDirectorySuffix && !resolved.endsWith("/") ? `${resolved}/` : resolved;
}

function resolveDesktopPreviewCspSource(): string {
  try {
    const previewUrl = new URL(resolveDesktopPreviewUrl("/"));
    if (previewUrl.origin !== "null") {
      return previewUrl.origin;
    }
    return `${previewUrl.protocol}//${previewUrl.host}`;
  } catch {
    return LATTICE_PREVIEW_CSP_SOURCE;
  }
}

export function rewriteVSCodeWebviewHtmlResources(html: string): string {
  const rewrittenResources = String(html || "").replace(
    /lattice-webview-resource:([^"'`\s<>)]*)/g,
    (_match, encodedPath: string) => {
      try {
        return resolveWebviewResourceUrl(decodeURIComponent(encodedPath));
      } catch {
        return _match;
      }
    },
  );
  return isTauriHost()
    ? rewriteVSCodeWebviewCspSource(rewrittenResources, resolveDesktopPreviewCspSource())
    : rewrittenResources;
}

export function rewriteVSCodeWebviewCspSource(html: string, resourceScheme: string): string {
  return String(html || "")
    .replace(/\bvscode-webview:/g, resourceScheme)
    .replace(/\bfont-src\b([^;"']*)/gi, (directive, rawSources: string) => {
      const sources = rawSources.trim();
      if (/(?:^|\s)data:(?:\s|$)/i.test(sources)) {
        return directive;
      }
      return `font-src${sources ? ` ${sources}` : ""} data:`;
    });
}
