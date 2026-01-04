/**
 * Popup Position Hook
 * 
 * React hook for calculating and adjusting popup positions
 * to ensure they stay within viewport bounds.
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  adjustPopupPosition,
  getDropdownPosition,
  getContextMenuPosition,
  getTooltipPosition,
  type PopupPosition,
  type PopupSize,
} from '@/lib/coordinate-adapter';

interface UsePopupPositionOptions {
  /** Initial position */
  initialPosition?: PopupPosition;
  /** Popup size (width and height) */
  popupSize?: PopupSize;
  /** Minimum padding from viewport edges */
  padding?: number;
  /** Whether to recalculate on window resize */
  recalculateOnResize?: boolean;
}

interface UsePopupPositionReturn {
  /** Adjusted position that keeps popup in viewport */
  position: PopupPosition;
  /** Update the target position */
  setTargetPosition: (pos: PopupPosition) => void;
  /** Update the popup size */
  setPopupSize: (size: PopupSize) => void;
  /** Force recalculation */
  recalculate: () => void;
}

/**
 * Hook for managing popup positions with automatic viewport boundary adjustment
 */
export function usePopupPosition(options: UsePopupPositionOptions = {}): UsePopupPositionReturn {
  const {
    initialPosition = { x: 0, y: 0 },
    popupSize: initialSize = { width: 200, height: 100 },
    padding = 8,
    recalculateOnResize = true,
  } = options;

  const [targetPosition, setTargetPosition] = useState<PopupPosition>(initialPosition);
  const [popupSize, setPopupSize] = useState<PopupSize>(initialSize);
  const [adjustedPosition, setAdjustedPosition] = useState<PopupPosition>(initialPosition);

  const recalculate = useCallback(() => {
    const newPosition = adjustPopupPosition(targetPosition, popupSize, padding);
    setAdjustedPosition(newPosition);
  }, [targetPosition, popupSize, padding]);

  // Recalculate when target position or size changes
  useEffect(() => {
    recalculate();
  }, [recalculate]);

  // Recalculate on window resize
  useEffect(() => {
    if (!recalculateOnResize) return;

    const handleResize = () => {
      recalculate();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [recalculateOnResize, recalculate]);

  return {
    position: adjustedPosition,
    setTargetPosition,
    setPopupSize,
    recalculate,
  };
}

/**
 * Hook for context menu positioning
 */
export function useContextMenuPosition() {
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const [menuSize, setMenuSize] = useState<PopupSize>({ width: 180, height: 200 });
  const menuRef = useRef<HTMLDivElement>(null);

  const openAt = useCallback((x: number, y: number) => {
    const adjusted = getContextMenuPosition({ x, y }, menuSize);
    setPosition(adjusted);
  }, [menuSize]);

  const close = useCallback(() => {
    setPosition(null);
  }, []);

  // Update menu size when ref changes
  useEffect(() => {
    if (menuRef.current && position) {
      const rect = menuRef.current.getBoundingClientRect();
      if (rect.width !== menuSize.width || rect.height !== menuSize.height) {
        setMenuSize({ width: rect.width, height: rect.height });
        // Recalculate position with new size
        const adjusted = getContextMenuPosition(position, { width: rect.width, height: rect.height });
        setPosition(adjusted);
      }
    }
  }, [position, menuSize]);

  return {
    position,
    menuRef,
    openAt,
    close,
    isOpen: position !== null,
  };
}

/**
 * Hook for dropdown menu positioning
 */
export function useDropdownPosition(triggerRef: React.RefObject<HTMLElement | null>) {
  const [position, setPosition] = useState<PopupPosition & { showAbove: boolean } | null>(null);
  const [menuSize, setMenuSize] = useState<PopupSize>({ width: 200, height: 300 });
  const menuRef = useRef<HTMLDivElement>(null);

  const open = useCallback(() => {
    if (!triggerRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const pos = getDropdownPosition(triggerRect, menuSize);
    setPosition(pos);
  }, [triggerRef, menuSize]);

  const close = useCallback(() => {
    setPosition(null);
  }, []);

  const toggle = useCallback(() => {
    if (position) {
      close();
    } else {
      open();
    }
  }, [position, open, close]);

  // Update menu size when ref changes
  useEffect(() => {
    if (menuRef.current && position) {
      const rect = menuRef.current.getBoundingClientRect();
      if (rect.width !== menuSize.width || rect.height !== menuSize.height) {
        setMenuSize({ width: rect.width, height: rect.height });
      }
    }
  }, [position, menuSize]);

  return {
    position,
    menuRef,
    open,
    close,
    toggle,
    isOpen: position !== null,
    showAbove: position?.showAbove ?? false,
  };
}

/**
 * Hook for tooltip positioning
 */
export function useTooltipPosition(
  targetRef: React.RefObject<HTMLElement | null>,
  placement: 'top' | 'bottom' | 'left' | 'right' = 'top'
) {
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const [tooltipSize, setTooltipSize] = useState<PopupSize>({ width: 150, height: 40 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    if (!targetRef.current) return;
    const targetRect = targetRef.current.getBoundingClientRect();
    const pos = getTooltipPosition(targetRect, tooltipSize, placement);
    setPosition(pos);
  }, [targetRef, tooltipSize, placement]);

  const hide = useCallback(() => {
    setPosition(null);
  }, []);

  // Update tooltip size when ref changes
  useEffect(() => {
    if (tooltipRef.current && position) {
      const rect = tooltipRef.current.getBoundingClientRect();
      if (rect.width !== tooltipSize.width || rect.height !== tooltipSize.height) {
        setTooltipSize({ width: rect.width, height: rect.height });
      }
    }
  }, [position, tooltipSize]);

  return {
    position,
    tooltipRef,
    show,
    hide,
    isVisible: position !== null,
  };
}
