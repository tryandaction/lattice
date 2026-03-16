export function safeDecodeLinkTarget(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isExternalUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("//")) return true;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
}

export function normalizeWorkspacePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
}

export function resolveRelativeWorkspacePath(basePath: string, targetPath: string): string {
  const baseParts = normalizeWorkspacePath(basePath).split("/").filter(Boolean);
  baseParts.pop();

  const targetParts = normalizeWorkspacePath(targetPath).split("/").filter(Boolean);
  const resolvedParts = [...baseParts];

  for (const part of targetParts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (resolvedParts.length > 0) {
        resolvedParts.pop();
      }
      continue;
    }
    resolvedParts.push(part);
  }

  return resolvedParts.join("/");
}

export function hasFileExtension(path: string): boolean {
  return /\.[^/.]+$/.test(path);
}

export function isLikelySystemPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) return false;
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true;
  if (trimmed.startsWith("\\\\")) return true;
  return trimmed.startsWith("file://");
}

export function toSystemPath(path: string): string {
  if (!path.startsWith("file://")) {
    return path;
  }

  try {
    const url = new URL(path);
    if (url.protocol !== "file:") return path;
    const pathname = decodeURIComponent(url.pathname);
    return pathname.replace(/^\/([a-zA-Z]:\/)/, "$1");
  } catch {
    return path;
  }
}

export function buildWorkspaceCandidatePaths(path: string): string[] {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized) return [];
  if (hasFileExtension(normalized)) return [normalized];
  return [normalized, `${normalized}.md`, `${normalized}.ipynb`];
}

export function isSameWorkspacePath(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right);
}
