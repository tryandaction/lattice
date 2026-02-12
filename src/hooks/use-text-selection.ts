"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface TextSelectionState {
  text: string;
  position: { x: number; y: number };
}

/**
 * Hook that detects text selection within a container element.
 * Returns the selected text and position for showing a floating menu.
 */
export function useTextSelection(containerRef: React.RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<TextSelectionState | null>(null);
  const dismissedRef = useRef(false);

  const dismiss = useCallback(() => {
    setSelection(null);
    dismissedRef.current = true;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      // Small delay to let the browser finalize the selection
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";

        if (text.length < 2) {
          if (!dismissedRef.current) setSelection(null);
          return;
        }

        dismissedRef.current = false;

        // Get position from the selection range
        const range = sel?.getRangeAt(0);
        if (!range) return;

        const rect = range.getBoundingClientRect();
        setSelection({
          text,
          position: {
            x: rect.left + rect.width / 2,
            y: rect.bottom + 6,
          },
        });
      }, 10);
    };

    const handleMouseDown = () => {
      dismissedRef.current = false;
      setSelection(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelection(null);
        dismissedRef.current = true;
      }
    };

    container.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [containerRef]);

  return { selection, dismiss };
}
