/**
 * Coordinate Adapter
 * 
 * Handles coordinate transformations for popups and dialogs
 * to ensure they appear correctly within the application window.
 */

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PopupPosition {
  x: number;
  y: number;
}

export interface PopupSize {
  width: number;
  height: number;
}

/**
 * Get the current window/viewport bounds
 */
export function getWindowBounds(): WindowBounds {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0, width: 800, height: 600 };
  }
  
  return {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

/**
 * Adjust popup position to stay within window bounds
 * 
 * @param position - Desired popup position
 * @param popupSize - Size of the popup
 * @param padding - Minimum padding from window edges (default: 8px)
 * @returns Adjusted position that keeps popup fully visible
 */
export function adjustPopupPosition(
  position: PopupPosition,
  popupSize: PopupSize,
  padding: number = 8
): PopupPosition {
  const bounds = getWindowBounds();
  
  let { x, y } = position;
  
  // Adjust horizontal position
  if (x + popupSize.width + padding > bounds.width) {
    // Would overflow right edge, move left
    x = bounds.width - popupSize.width - padding;
  }
  if (x < padding) {
    // Would overflow left edge
    x = padding;
  }
  
  // Adjust vertical position
  if (y + popupSize.height + padding > bounds.height) {
    // Would overflow bottom edge, move up
    y = bounds.height - popupSize.height - padding;
  }
  if (y < padding) {
    // Would overflow top edge
    y = padding;
  }
  
  return { x, y };
}

/**
 * Calculate centered position for a modal dialog
 * 
 * @param dialogSize - Size of the dialog
 * @returns Position that centers the dialog in the window
 */
export function getCenteredPosition(dialogSize: PopupSize): PopupPosition {
  const bounds = getWindowBounds();
  
  return {
    x: Math.max(0, (bounds.width - dialogSize.width) / 2),
    y: Math.max(0, (bounds.height - dialogSize.height) / 2),
  };
}

/**
 * Calculate position for a context menu at cursor
 * 
 * @param cursorPosition - Current cursor position
 * @param menuSize - Size of the context menu
 * @returns Adjusted position for the menu
 */
export function getContextMenuPosition(
  cursorPosition: PopupPosition,
  menuSize: PopupSize
): PopupPosition {
  return adjustPopupPosition(cursorPosition, menuSize);
}

/**
 * Calculate position for a dropdown menu below a trigger element
 * 
 * @param triggerRect - Bounding rect of the trigger element
 * @param menuSize - Size of the dropdown menu
 * @param preferBelow - Whether to prefer showing below the trigger (default: true)
 * @returns Position for the dropdown menu
 */
export function getDropdownPosition(
  triggerRect: DOMRect,
  menuSize: PopupSize,
  preferBelow: boolean = true
): PopupPosition & { showAbove: boolean } {
  const bounds = getWindowBounds();
  const padding = 8;
  
  let x = triggerRect.left;
  let y: number;
  let showAbove = false;
  
  // Check if there's room below
  const spaceBelow = bounds.height - triggerRect.bottom;
  const spaceAbove = triggerRect.top;
  
  if (preferBelow && spaceBelow >= menuSize.height + padding) {
    // Show below
    y = triggerRect.bottom + 4;
  } else if (spaceAbove >= menuSize.height + padding) {
    // Show above
    y = triggerRect.top - menuSize.height - 4;
    showAbove = true;
  } else {
    // Not enough space either way, show where there's more room
    if (spaceBelow >= spaceAbove) {
      y = triggerRect.bottom + 4;
    } else {
      y = triggerRect.top - menuSize.height - 4;
      showAbove = true;
    }
  }
  
  // Adjust horizontal position
  if (x + menuSize.width + padding > bounds.width) {
    x = bounds.width - menuSize.width - padding;
  }
  if (x < padding) {
    x = padding;
  }
  
  return { x, y, showAbove };
}

/**
 * Calculate position for a tooltip near an element
 * 
 * @param targetRect - Bounding rect of the target element
 * @param tooltipSize - Size of the tooltip
 * @param placement - Preferred placement ('top' | 'bottom' | 'left' | 'right')
 * @returns Position for the tooltip
 */
export function getTooltipPosition(
  targetRect: DOMRect,
  tooltipSize: PopupSize,
  placement: 'top' | 'bottom' | 'left' | 'right' = 'top'
): PopupPosition {
  const gap = 8;
  
  let x: number;
  let y: number;
  
  switch (placement) {
    case 'top':
      x = targetRect.left + (targetRect.width - tooltipSize.width) / 2;
      y = targetRect.top - tooltipSize.height - gap;
      break;
    case 'bottom':
      x = targetRect.left + (targetRect.width - tooltipSize.width) / 2;
      y = targetRect.bottom + gap;
      break;
    case 'left':
      x = targetRect.left - tooltipSize.width - gap;
      y = targetRect.top + (targetRect.height - tooltipSize.height) / 2;
      break;
    case 'right':
      x = targetRect.right + gap;
      y = targetRect.top + (targetRect.height - tooltipSize.height) / 2;
      break;
  }
  
  // Adjust to stay within bounds
  return adjustPopupPosition({ x, y }, tooltipSize);
}

/**
 * Hook to track window resize and update positions
 * Returns a function to recalculate positions
 */
export function createResizeHandler(
  onResize: () => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  
  window.addEventListener('resize', onResize);
  
  return () => {
    window.removeEventListener('resize', onResize);
  };
}
