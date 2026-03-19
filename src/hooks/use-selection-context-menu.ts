"use client";

import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { isMeaningfulSelectionText } from '@/lib/ai/selection-ui';

export interface SelectionSnapshot {
  text: string;
  eventTarget: EventTarget | null;
  domRange?: Range;
  inputOffsets?: {
    start: number;
    end: number;
  };
  lineStart?: number;
  lineEnd?: number;
  boundingRect?: DOMRect;
}

export interface SelectionContextMenuState<T> {
  context: T | null;
  selectedText: string;
  position: { x: number; y: number };
  disabledReason?: string;
  returnFocusTo?: HTMLElement | null;
}

export type BuildSelectionContextArgs = SelectionSnapshot;

interface UseSelectionContextMenuOptions {
  getSelectionSnapshot?: () => Partial<SelectionSnapshot> | null;
}

function mergeSelectionSnapshots(
  base: SelectionSnapshot | null,
  override: Partial<SelectionSnapshot> | null,
): SelectionSnapshot | null {
  if (!base && !override) {
    return null;
  }

  const text = override?.text?.trim() || base?.text?.trim() || '';
  if (!text) {
    return null;
  }

  return {
    text,
    eventTarget: override?.eventTarget ?? base?.eventTarget ?? null,
    domRange: override?.domRange ?? base?.domRange,
    inputOffsets: override?.inputOffsets ?? base?.inputOffsets,
    lineStart: override?.lineStart ?? base?.lineStart,
    lineEnd: override?.lineEnd ?? base?.lineEnd,
    boundingRect: override?.boundingRect ?? base?.boundingRect,
  };
}

function extractSelectedText(container: HTMLElement): SelectionSnapshot | null {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLTextAreaElement ||
    (activeElement instanceof HTMLInputElement && activeElement.type === 'text')
  ) {
    if (container.contains(activeElement)) {
      const start = activeElement.selectionStart ?? 0;
      const end = activeElement.selectionEnd ?? 0;
      if (end > start) {
        return {
          text: activeElement.value.slice(start, end).trim(),
          eventTarget: activeElement,
          inputOffsets: { start, end },
          boundingRect: activeElement.getBoundingClientRect(),
        };
      }
    }
  }

  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';
  if (!selection || selection.rangeCount === 0 || text.length === 0) {
    return null;
  }

  const range = selection.getRangeAt(0).cloneRange();
  const node = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;

  if (!(node instanceof Node) || !container.contains(node)) {
    return null;
  }

  return {
    text,
    eventTarget: selection.anchorNode instanceof Node ? selection.anchorNode : node,
    domRange: range,
    boundingRect: range.getBoundingClientRect(),
  };
}

function resolveMenuPosition(snapshot: SelectionSnapshot | null, container: HTMLElement, fallback?: { x: number; y: number }) {
  if (fallback) {
    return fallback;
  }

  const rect = snapshot?.boundingRect;
  if (rect && rect.width >= 0 && rect.height >= 0) {
    return {
      x: rect.left + Math.max(12, Math.min(rect.width, 24)),
      y: rect.bottom + 8,
    };
  }

  const containerRect = container.getBoundingClientRect();
  return {
    x: containerRect.left + 16,
    y: containerRect.top + 16,
  };
}

export function useSelectionContextMenu<T>(
  containerRef: RefObject<HTMLElement | null>,
  buildContext: (args: BuildSelectionContextArgs) => T | null,
  options: UseSelectionContextMenuOptions = {},
) {
  const [menuState, setMenuState] = useState<SelectionContextMenuState<T> | null>(null);

  const closeMenu = useCallback((config?: { restoreFocus?: boolean }) => {
    setMenuState((current) => {
      if (config?.restoreFocus !== false) {
        current?.returnFocusTo?.focus?.();
      }
      return null;
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const openMenu = (mode: 'pointer' | 'keyboard', event?: MouseEvent | KeyboardEvent) => {
      const mergedSelection = mergeSelectionSnapshots(
        extractSelectedText(container),
        options.getSelectionSnapshot?.() ?? null,
      );

      const selectedText = mergedSelection?.text?.trim() ?? '';
      const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : container;
      const position = resolveMenuPosition(
        mergedSelection,
        container,
        event instanceof MouseEvent ? { x: event.clientX, y: event.clientY } : undefined,
      );

      if (!selectedText) {
        if (mode === 'keyboard') {
          event?.preventDefault();
          setMenuState({
            context: null,
            selectedText: '',
            position,
            disabledReason: '先选择一段有意义的文本，再打开 Selection AI。',
            returnFocusTo,
          });
        } else {
          setMenuState(null);
        }
        return;
      }

      if (!isMeaningfulSelectionText(selectedText)) {
        if (mode === 'keyboard') {
          event?.preventDefault();
          setMenuState({
            context: null,
            selectedText,
            position,
            disabledReason: 'Selection AI 仅在长度至少 3 且包含有效文本内容的选区上启用。',
            returnFocusTo,
          });
        } else {
          setMenuState(null);
        }
        return;
      }

      if (!mergedSelection) {
        setMenuState(null);
        return;
      }

      const context = buildContext(mergedSelection);
      if (!context) {
        if (mode === 'keyboard') {
          event?.preventDefault();
          setMenuState({
            context: null,
            selectedText,
            position,
            disabledReason: '当前视图暂不支持把这个选区送入 Selection AI。',
            returnFocusTo,
          });
        } else {
          setMenuState(null);
        }
        return;
      }

      event?.preventDefault();
      event?.stopPropagation();
      setMenuState({
        context,
        selectedText,
        position,
        returnFocusTo,
      });
    };

    const handleContextMenu = (event: MouseEvent) => {
      openMenu('pointer', event);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const isContextMenuKey = event.key === 'ContextMenu';
      const isShiftF10 = event.shiftKey && event.key === 'F10';
      if (!isContextMenuKey && !isShiftF10) {
        return;
      }

      const target = event.target instanceof Node ? event.target : null;
      if (target && !container.contains(target)) {
        return;
      }

      openMenu('keyboard', event);
    };

    container.addEventListener('contextmenu', handleContextMenu);
    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [buildContext, containerRef, options]);

  return { menuState, closeMenu };
}
