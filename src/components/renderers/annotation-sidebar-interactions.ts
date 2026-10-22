import { useCallback, useLayoutEffect, useRef, type KeyboardEvent } from 'react';

/** Keep event props stable without keeping a stale file or annotation callback. */
export function useAnnotationSidebarCallback<Args extends unknown[]>(callback: (...args: Args) => void) {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => { callbackRef.current = callback; }, [callback]);
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}

export function scrollToSidebarAnnotation(root: HTMLElement | null, id: string | null | undefined) {
  if (!root || !id) return;
  // IDs originate in saved files and can contain CSS selector punctuation.
  const card = Array.from(root.querySelectorAll<HTMLElement>('[data-annotation-id]'))
    .find((element) => element.dataset.annotationId === id);
  card?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
}

/** Arrow navigation applies to cards, never to their comment editors or menus. */
export function handleAnnotationSidebarKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const target = event.target as HTMLElement;
  if (!target.matches('[data-annotation-id]') || event.ctrlKey || event.metaKey || event.altKey) return;
  const cards = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-annotation-id]'));
  const index = cards.indexOf(target);
  if (index < 0) return;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1
    : Math.max(0, Math.min(cards.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
  event.preventDefault();
  cards[next]?.focus({ preventScroll: true });
  cards[next]?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
}
