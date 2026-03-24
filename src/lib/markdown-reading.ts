export function stripLeadingFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) {
    return content;
  }

  const endIndex = content.indexOf("\n---", 4);
  if (endIndex < 0) {
    return content;
  }

  return content.slice(endIndex + 4).trimStart();
}
