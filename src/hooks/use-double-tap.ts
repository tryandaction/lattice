/**
 * useDoubleTap Hook
 * Detects double-tap of a specific key within a time threshold
 */

import { useEffect, useRef, useCallback } from 'react';

export interface UseDoubleTapOptions {
  /** The key to detect (e.g., 'Tab') */
  key: string;
  /** Time window in milliseconds (default: 250) */
  threshold?: number;
  /** Callback when double-tap is detected */
  onDoubleTap: () => void;
  /** Whether the hook is enabled (default: true) */
  enabled?: boolean;
  /** Optional condition check - if provided, only intercept key when this returns true */
  shouldIntercept?: () => boolean;
  /** Optional callback on first tap - useful for saving state before Tab changes things */
  onFirstTap?: () => void;
}

/**
 * Hook to detect double-tap of a specific key
 * 
 * @example
 * ```tsx
 * useDoubleTap({
 *   key: 'Tab',
 *   threshold: 250,
 *   onDoubleTap: () => console.log('Double tap detected!'),
 * });
 * ```
 */
export function useDoubleTap({
  key,
  threshold = 250,
  onDoubleTap,
  enabled = true,
  shouldIntercept,
  onFirstTap,
}: UseDoubleTapOptions): void {
  const lastPressTimeRef = useRef<number>(0);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) {
        return;
      }
      if (event.key !== key) return;

      // Check if we should intercept this key press
      // If shouldIntercept is provided and returns false, let the browser handle it
      const shouldInterceptResult = shouldIntercept ? shouldIntercept() : true;
      
      if (shouldIntercept && !shouldInterceptResult) {
        return;
      }

      const now = Date.now();
      const timeSinceLastPress = now - lastPressTimeRef.current;

      // Clear any pending timeout
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = null;
      }

      if (timeSinceLastPress < threshold && timeSinceLastPress > 0) {
        // Double-tap detected!
        // Only prevent default on the SECOND tap
        event.preventDefault();
        event.stopPropagation();
        lastPressTimeRef.current = 0; // Reset to prevent triple-tap triggering
        onDoubleTap();
      } else {
        // First tap - record time and call onFirstTap if provided
        // This allows saving cursor position BEFORE Tab changes it
        lastPressTimeRef.current = now;
        
        // Call onFirstTap to save current state
        if (onFirstTap) {
          onFirstTap();
        }
        
        // Reset after threshold expires
        pendingTimeoutRef.current = setTimeout(() => {
          lastPressTimeRef.current = 0;
          pendingTimeoutRef.current = null;
        }, threshold);
      }
    },
    [key, threshold, onDoubleTap, enabled, shouldIntercept, onFirstTap]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Use capture phase to intercept before other handlers
    document.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
      }
    };
  }, [handleKeyDown, enabled]);
}

// ============================================================================
// Pure Logic for Testing
// ============================================================================

export interface DoubleTapState {
  lastPressTime: number;
}

export interface DoubleTapResult {
  isDoubleTap: boolean;
  newState: DoubleTapState;
}

/**
 * Pure function to detect double-tap
 * Useful for testing without React hooks
 */
export function detectDoubleTap(
  currentTime: number,
  state: DoubleTapState,
  threshold: number
): DoubleTapResult {
  const timeSinceLastPress = currentTime - state.lastPressTime;

  if (timeSinceLastPress < threshold && timeSinceLastPress > 0) {
    // Double-tap detected
    return {
      isDoubleTap: true,
      newState: { lastPressTime: 0 }, // Reset
    };
  } else {
    // First tap or timeout expired
    return {
      isDoubleTap: false,
      newState: { lastPressTime: currentTime },
    };
  }
}

/**
 * Check if a time interval would trigger a double-tap
 */
export function wouldTriggerDoubleTap(
  interval: number,
  threshold: number
): boolean {
  return interval > 0 && interval < threshold;
}
