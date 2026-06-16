function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\\[\]])/g, "\\$1");
}

function encodeMarkdownTarget(target: string): string {
  return target
    .trim()
    .replace(/\\/g, "/")
    .replace(/[\s<>]/g, (char) => encodeURIComponent(char));
}

function isLikelyImageTarget(target: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)(?:[#?].*)?$/i.test(target.trim());
}

function isObsidianImageSize(value: string): boolean {
  return /^\d{1,4}(?:x\d{1,4})?$/i.test(value.trim());
}

export function convertWikiLinksToMarkdown(content: string): string {
  return content.replace(/(!?)\[\[([^\]|]+(?:#[^\]|]+)?)(?:\|([^\]]+))?\]\]/g, (
    _match,
    embedPrefix: string,
    target: string,
    label?: string,
  ) => {
    const safeTarget = encodeMarkdownTarget(target);
    const safeLabel = escapeMarkdownLabel((label ?? target).trim());

    if (embedPrefix) {
      if (isLikelyImageTarget(target)) {
        if (label && isObsidianImageSize(label)) {
          return `![|${label.trim()}](${safeTarget})`;
        }
        return `![${safeLabel}](${safeTarget})`;
      }
      return `[${safeLabel}](${safeTarget})`;
    }

    return `[${safeLabel}](${safeTarget})`;
  });
}
