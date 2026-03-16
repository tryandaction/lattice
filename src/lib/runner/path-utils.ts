function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function normalizeRelativePath(filePath: string, rootName?: string | null): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (!rootName) {
    return normalized.replace(/^\/+/, "");
  }

  const prefix = `${rootName.replace(/\\/g, "/")}/`;
  if (normalized === rootName) {
    return "";
  }
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length);
  }
  return normalized.replace(/^\/+/, "");
}

export function resolveWorkspaceFilePath(
  workspaceRootPath: string | null,
  filePath: string,
  rootName?: string | null,
): string | null {
  if (!workspaceRootPath) {
    return null;
  }

  const relativePath = normalizeRelativePath(filePath, rootName);
  const base = trimTrailingSeparators(workspaceRootPath);

  if (!relativePath) {
    return base;
  }

  return `${base}/${relativePath}`;
}

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return normalized;
  }
  return normalized.slice(0, index);
}
