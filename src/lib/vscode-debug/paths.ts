export function normalizeDebugSourcePath(filePath: string): string {
  let normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("//?/")) {
    normalized = normalized.slice(4);
  }
  return /^[a-zA-Z]:\//.test(normalized)
    ? `${normalized[0]!.toLowerCase()}${normalized.slice(1)}`
    : normalized;
}

