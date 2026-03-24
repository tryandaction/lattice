export function convertWikiLinksToMarkdown(content: string): string {
  return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => {
    const safeTarget = target.trim();
    const safeLabel = (label ?? target).trim();
    return `[${safeLabel}](${safeTarget})`;
  });
}
