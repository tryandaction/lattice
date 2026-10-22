function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readAnnotationColor(line: string): string | null {
  if (!line.includes("lattice-pdf-annotation")) {
    return null;
  }
  return /\bcolor="([^"]+)"/.exec(line)?.[1]?.trim() || null;
}

export function decoratePdfAnnotationMarkdown(markdown: string): string {
  if (!markdown.includes("lattice-pdf-annotation")) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const decorated: string[] = [];
  let annotationColor: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^###\s+/.test(line)) {
      annotationColor = null;
    }
    annotationColor = readAnnotationColor(line) ?? annotationColor;

    if (annotationColor && /^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      index -= 1;
      decorated.push(
        `<blockquote class="lattice-pdf-annotation-quote" data-color="${escapeHtml(annotationColor)}">${quoteLines.map(escapeHtml).join("<br />")}</blockquote>`,
      );
      continue;
    }

    const imageMatch = annotationColor
      ? /^!\[([^\]]*)\]\((.+)\)\s*$/.exec(line)
      : null;
    if (annotationColor && imageMatch) {
      const source = imageMatch[2].trim().replace(/^<(.+)>$/, "$1");
      decorated.push(
        `<img class="lattice-pdf-annotation-preview" data-color="${escapeHtml(annotationColor)}" src="${escapeHtml(source)}" alt="${escapeHtml(imageMatch[1])}" />`,
      );
      continue;
    }

    decorated.push(line);
  }

  return decorated.join("\n");
}
