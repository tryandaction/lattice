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

function replaceHighlightsOutsideInlineCode(line: string): string {
  const parts = line.split(/(`+[^`]*`+)/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        return part;
      }
      return part.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
    })
    .join("");
}

function updateFenceState(line: string, inFence: boolean, fenceMarker: string): { inFence: boolean; fenceMarker: string; isFenceLine: boolean } {
  const trimmed = line.trim();
  const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
  if (!fenceMatch) {
    return { inFence, fenceMarker, isFenceLine: false };
  }

  const marker = fenceMatch[1];
  if (!inFence) {
    return {
      inFence: true,
      fenceMarker: marker[0].repeat(marker.length),
      isFenceLine: true,
    };
  }

  if (trimmed.startsWith(fenceMarker)) {
    return { inFence: false, fenceMarker: "", isFenceLine: true };
  }

  return { inFence, fenceMarker, isFenceLine: true };
}

function stripObsidianCommentsFromLine(line: string, inComment: boolean): { line: string; inComment: boolean } {
  let index = 0;
  let nextLine = "";
  let commentOpen = inComment;

  while (index < line.length) {
    if (commentOpen) {
      const closeIndex = line.indexOf("%%", index);
      if (closeIndex < 0) {
        return { line: nextLine.trimEnd(), inComment: true };
      }
      index = closeIndex + 2;
      commentOpen = false;
      if (nextLine.trim() === "") {
        while (line[index] === " " || line[index] === "\t") {
          index += 1;
        }
      }
      continue;
    }

    if (line.startsWith("%%", index)) {
      index += 2;
      commentOpen = true;
      continue;
    }

    if (line[index] === "`") {
      const markerMatch = line.slice(index).match(/^`+/);
      const marker = markerMatch?.[0] ?? "`";
      const closeIndex = line.indexOf(marker, index + marker.length);
      if (closeIndex >= 0) {
        nextLine += line.slice(index, closeIndex + marker.length);
        index = closeIndex + marker.length;
        continue;
      }
    }

    nextLine += line[index];
    index += 1;
  }

  return { line: nextLine.trimEnd(), inComment: commentOpen };
}

function stripBlockIdOutsideInlineCode(line: string): string {
  const parts = line.split(/(`+[^`]*`+)/g);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (index % 2 === 1) {
      continue;
    }

    const nextPart = parts[index].replace(/(?:^|\s)\^[A-Za-z0-9_-]+\s*$/, "");
    if (nextPart !== parts[index]) {
      parts[index] = nextPart;
      break;
    }
  }

  return parts.join("").trimEnd();
}

export function normalizeObsidianHighlights(content: string): string {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split("\n");
  let inFence = false;
  let fenceMarker = "";

  return lines
    .map((line) => {
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

      return inFence ? line : replaceHighlightsOutsideInlineCode(line);
    })
    .join("\n");
}

export function hideObsidianComments(content: string): string {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split("\n");
  let inFence = false;
  let fenceMarker = "";
  let inComment = false;

  return lines
    .map((line) => {
      const fenceState = updateFenceState(line, inFence, fenceMarker);
      inFence = fenceState.inFence;
      fenceMarker = fenceState.fenceMarker;
      if (fenceState.isFenceLine || inFence) {
        return line;
      }

      const result = stripObsidianCommentsFromLine(line, inComment);
      inComment = result.inComment;
      return result.line;
    })
    .join("\n");
}

export function hideObsidianBlockIds(content: string): string {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split("\n");
  let inFence = false;
  let fenceMarker = "";

  return lines
    .map((line) => {
      const fenceState = updateFenceState(line, inFence, fenceMarker);
      inFence = fenceState.inFence;
      fenceMarker = fenceState.fenceMarker;
      if (fenceState.isFenceLine || inFence) {
        return line;
      }

      return stripBlockIdOutsideInlineCode(line);
    })
    .join("\n");
}

export function prepareMarkdownForReading(content: string): string {
  return hideObsidianBlockIds(
    hideObsidianComments(
      normalizeObsidianHighlights(
        normalizeStandaloneHorizontalRules(stripLeadingFrontmatter(content)),
      ),
    ),
  );
}
