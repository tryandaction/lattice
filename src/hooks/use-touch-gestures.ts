"use client";

import { useRef, useCallback, useEffect } from 'react';
import { useGesture } from '@use-gesture/react';

/**
 * Swipe direction type
 */
export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

/**
 * Configuration for touch gestures
 */
export interface GestureConfig {
  /** Called when user performs pinch gesture with scale factor */
  onPinch?: (scale: number, origin: { x: number; y: number }) => void;
  /** Called when user performs pan/drag gesture */
  onPan?: (delta: { x: number; y: number }, velocity: { x: number; y: number }) => void;
  /** Called when pan gesture ends (for momentum scrolling) */
  onPanEnd?: (velocity: { x: number; y: number }) => void;
  /** Called when user swipes in a direction */
  onSwipe?: (direction: SwipeDirection) => void;
  /** Called when user long-presses */
  onLongPress?: (position: { x: number; y: number }) => void;
  /** Called when user double-taps */
  onDoubleTap?: (position: { x: number; y: number }) => void;
  /** Called when pinch gesture starts */
  onPinchStart?: () => void;
  /** Called when pinch gesture ends */
  onPinchEnd?: (scale: number) => void;
}

/**
 * Options for the gesture hook
 */
export interface GestureOptions {
  /** Minimum distance for swipe detection (default: 50) */
  swipeThreshold?: number;
  /** Minimum velocity for swipe detection (default: 0.5) */
  swipeVelocity?: number;
  /** Duration for long press detection in ms (default: 500) */
  longPressDelay?: number;
  /** Whether to enable pinch gesture (default: true) */
  enablePinch?: boolean;
  /** Whether to enable pan gesture (default: true) */
  enablePan?: boolean;
  /** Whether to enable swipe gesture (default: true) */
  enableSwipe?: boolean;
  /** Whether to prevent default touch behavior (default: false) */
  preventDefault?: boolean;
}

const DEFAULT_OPTIONS: Required<GestureOptions> = {
  swipeThreshold: 50,
  swipeVelocity: 0.5,
  longPressDelay: 500,
  enablePinch: true,
  enablePan: true,
  enableSwipe: true,
  preventDefault: false,
};

/**
 * Hook for handling touch gestures on an element
 * 
 * Supports:
 * - Pinch to zoom
 * - Pan/drag with momentum
 * - Swipe in four directions
 * - Long press
 * - Double tap
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */
export function useTouchGestures<T extends HTMLElement>(
  config: GestureConfig,
  options: GestureOptions = {}
) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const elementRef = useRef<T>(null);
  const lastTapRef = useRef<number>(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear long press timer
  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Detect swipe direction from velocity
  const getSwipeDirection = useCallback(
    (vx: number, vy: number, dx: number, dy: number): SwipeDirection | null => {
      const absVx = Math.abs(vx);
      const absVy = Math.abs(vy);
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // Check if swipe meets threshold
      if (Math.max(absDx, absDy) < opts.swipeThreshold) {
        return null;
      }

      // Check if velocity meets threshold
      if (Math.max(absVx, absVy) < opts.swipeVelocity) {
        return null;
      }

      // Determine direction based on dominant axis
      if (absDx > absDy) {
        return dx > 0 ? 'right' : 'left';
      } else {
        return dy > 0 ? 'down' : 'up';
      }
    },
    [opts.swipeThreshold, opts.swipeVelocity]
  );

  // Bind gestures using @use-gesture/react
  const bind = useGesture(
    {
      onPinch: ({ offset: [scale], origin, first, last }) => {
        if (!opts.enablePinch) return;

        if (first && config.onPinchStart) {
          config.onPinchStart();
        }

        if (config.onPinch) {
          config.onPinch(scale, { x: origin[0], y: origin[1] });
        }

        if (last && config.onPinchEnd) {
          config.onPinchEnd(scale);
        }
      },

      onDrag: ({ movement: [mx, my], velocity: [vx, vy], last, first, xy, tap }) => {
        // Handle tap for double-tap detection
        if (tap) {
          const now = Date.now();
          const timeSinceLastTap = now - lastTapRef.current;

          if (timeSinceLastTap < 300 && config.onDoubleTap) {
            config.onDoubleTap({ x: xy[0], y: xy[1] });
            lastTapRef.current = 0;
          } else {
            lastTapRef.current = now;
          }
          return;
        }

        // Clear long press on any movement
        if (first) {
          clearLongPressTimer();
        }

        if (!opts.enablePan) return;

        // Handle pan
        if (config.onPan && !first) {
          config.onPan({ x: mx, y: my }, { x: vx, y: vy });
        }

        // Handle swipe and pan end
        if (last) {
          if (opts.enableSwipe && config.onSwipe) {
            const direction = getSwipeDirection(vx, vy, mx, my);
            if (direction) {
              config.onSwipe(direction);
            }
          }

          if (config.onPanEnd) {
            config.onPanEnd({ x: vx, y: vy });
          }
        }
      },

      onPointerDown: ({ event }) => {
        // Start long press timer
        if (config.onLongPress && event) {
          clearLongPressTimer();
          const x = event.clientX;
          const y = event.clientY;
          longPressTimerRef.current = setTimeout(() => {
            config.onLongPress?.({ x, y });
          }, opts.longPressDelay);
        }
      },

      onPointerUp: () => {
        clearLongPressTimer();
      },
    },
    {
      target: elementRef,
      eventOptions: { passive: !opts.preventDefault },
      drag: {
        filterTaps: true,
        threshold: 5,
      },
      pinch: {
        scaleBounds: { min: 0.5, max: 4 },
      },
    }
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  return {
    ref: elementRef,
    bind,
  };
}

/**
 * Simple hook for pinch-to-zoom functionality
 */
export function usePinchZoom(
  onZoom: (scale: number) => void,
  options?: { minScale?: number; maxScale?: number }
) {
  const { minScale = 0.5, maxScale = 4 } = options || {};
  const scaleRef = useRef(1);

  const handlePinch = useCallback(
    (scale: number) => {
      const newScale = Math.min(maxScale, Math.max(minScale, scale));
      scaleRef.current = newScale;
      onZoom(newScale);
    },
    [onZoom, minScale, maxScale]
  );

  const handlePinchEnd = useCallback(() => {
    // Optionally snap to certain scale values
  }, []);

  return useTouchGestures<HTMLDivElement>(
    {
      onPinch: handlePinch,
      onPinchEnd: handlePinchEnd,
    },
    {
      enablePan: false,
      enableSwipe: false,
    }
  );
}

/**
 * Simple hook for swipe navigation
 */
export function useSwipeNavigation(
  onSwipeLeft?: () => void,
  onSwipeRight?: () => void
) {
  const handleSwipe = useCallback(
    (direction: SwipeDirection) => {
      if (direction === 'left' && onSwipeLeft) {
        onSwipeLeft();
      } else if (direction === 'right' && onSwipeRight) {
        onSwipeRight();
      }
    },
    [onSwipeLeft, onSwipeRight]
  );

  return useTouchGestures<HTMLDivElement>(
    {
      onSwipe: handleSwipe,
    },
    {
      enablePinch: false,
      enablePan: false,
    }
  );
}
