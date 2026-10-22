"use client";

import { memo, useCallback, useEffect, useRef, useState, type ComponentProps, type RefObject } from 'react';
import { AnnotationMarkdownRenderer } from './annotation-markdown-renderer';

export type AnnotationCommentObserver = (element: HTMLElement, reveal: () => void) => () => void;

/** One observer per scroll container, not one observer per annotation. */
export function useAnnotationCommentObserver(root: RefObject<HTMLElement | null>): AnnotationCommentObserver {
  const pendingRef = useRef(new Map<Element, () => void>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  return useCallback((element: HTMLElement, reveal: () => void) => {
    const pending = pendingRef.current;
    if (typeof IntersectionObserver === 'undefined') {
      reveal();
      return () => undefined;
    }
    observerRef.current ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = pending.get(entry.target);
        pending.delete(entry.target);
        observerRef.current?.unobserve(entry.target);
        callback?.();
      }
    }, { root: root.current, rootMargin: '320px 0px' });
    pending.set(element, reveal);
    observerRef.current.observe(element);
    return () => {
      pending.delete(element);
      observerRef.current?.unobserve(element);
      if (pending.size === 0) {
        observerRef.current?.disconnect();
        observerRef.current = null;
      }
    };
  }, [root]);
}

const MemoizedMarkdown = memo(AnnotationMarkdownRenderer);

/** Keep offscreen text searchable while deferring only Markdown/KaTeX parsing. */
export const DeferredAnnotationMarkdown = memo(function DeferredAnnotationMarkdown({
  observe, eager = false, ...props
}: ComponentProps<typeof AnnotationMarkdownRenderer> & { observe: AnnotationCommentObserver; eager?: boolean }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(() => eager || typeof IntersectionObserver === 'undefined');
  if (eager && !revealed) setRevealed(true);

  useEffect(() => {
    if (revealed || !elementRef.current) return;
    return observe(elementRef.current, () => setRevealed(true));
  }, [observe, revealed]);

  return (
    <div ref={elementRef}>
      {revealed ? <MemoizedMarkdown {...props} /> : (
        <div className="whitespace-pre-wrap break-words text-xs leading-relaxed">{props.content}</div>
      )}
    </div>
  );
});
