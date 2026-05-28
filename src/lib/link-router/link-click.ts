export interface LinkClickLikeEvent {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  button?: number;
}

export function shouldOpenLinkExternally(event: LinkClickLikeEvent | null | undefined): boolean {
  if (!event) {
    return false;
  }

  return Boolean(
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.button === 1,
  );
}

export function findClosestAnchorHref(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  const href = anchor?.getAttribute("href")?.trim();
  return href || null;
}
