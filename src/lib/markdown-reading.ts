const HORIZONTAL_RULE_PATTERN = /^([-*_])(?:\s*\1){2,}\s*$/;

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function stripLeadingFrontmatter(content: string): string {
  const normalized = normalizeLineEndings(content);
  if (!normalized.startsWith("---\n")) {
    return normalized;
  }

  const endIndex = normalized.indexOf("\n---", 4);
  if (endIndex < 0) {
    return normalized;
  }

  return normalized.slice(endIndex + 4).trimStart();
}

export function normalizeStandaloneHorizontalRules(content: string): string {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split("\n");
  let inFence = false;
  let fenceMarker = "";

  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0].repeat(marker.length);
      } else if (trimmed.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
      return line;
    }

    if (!inFence && HORIZONTAL_RULE_PATTERN.test(trimmed)) {
      return "<hr />";
    }

    return line;
  });

  return nextLines.join("\n");
}

export function prepareMarkdownForReading(content: string): string {
  return normalizeStandaloneHorizontalRules(stripLeadingFrontmatter(content));
}
