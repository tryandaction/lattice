export function shouldLetHtmlPreviewHandleAnchor(href: string | null | undefined): boolean {
  const trimmed = href?.trim() ?? "";
  return /^#[^#]/.test(trimmed);
}
