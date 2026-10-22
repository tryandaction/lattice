export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/").trim();
  if (!normalized) {
    return /^$/;
  }

  let output = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "*") {
      if (next === "*") {
        output += ".*";
        i += 1;
      } else {
        output += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      output += "[^/]";
      continue;
    }

    if ("\\.^$+{}()|[]".includes(char)) {
      output += `\\${char}`;
      continue;
    }

    output += char;
  }

  output += "$";
  return new RegExp(output, "i");
}

export function matchesVSCodeGlob(path: string, pattern: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedPattern) return false;

  if (!normalizedPattern.includes("/") && normalizedPath.includes("/")) {
    const parts = normalizedPath.split("/");
    return parts.some((part) => globToRegExp(normalizedPattern).test(part));
  }

  if (normalizedPattern.startsWith("**/")) {
    const trimmed = normalizedPattern.slice(3);
    return matchesVSCodeGlob(normalizedPath, trimmed) || globToRegExp(normalizedPattern).test(normalizedPath);
  }

  if (normalizedPattern.includes("/")) {
    return globToRegExp(normalizedPattern).test(normalizedPath);
  }

  const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
  return globToRegExp(normalizedPattern).test(fileName);
}

export function isExcludedByPatterns(path: string, patterns: Record<string, boolean>): boolean {
  return Object.entries(patterns).some(([pattern, excluded]) => excluded && matchesVSCodeGlob(path, pattern));
}
