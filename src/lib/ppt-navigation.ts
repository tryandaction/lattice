/**
 * PPT Navigation Controller Module
 * 
 * Provides navigation utilities for PowerPoint viewer:
 * - Keyboard navigation (arrow keys, space)
 * - Mouse click navigation (left/right half)
 * - Mouse wheel navigation
 * - Boundary checking
 */

/**
 * Navigation direction
 */
export type NavigationDirection = 'prev' | 'next';

/**
 * Navigation result
 */
export interface NavigationResult {
  newIndex: number;
  changed: boolean;
  direction: NavigationDirection | null;
}

/**
 * Navigate to a specific slide with boundary checking
 * 
 * @param targetIndex - Target slide index
 * @param totalSlides - Total number of slides
 * @returns Clamped slide index
 */
export function navigateToSlide(targetIndex: number, totalSlides: number): number {
  if (totalSlides <= 0) return 0;
  return Math.max(0, Math.min(totalSlides - 1, targetIndex));
}

/**
 * Navigate to previous or next slide
 * 
 * @param currentIndex - Current slide index
 * @param totalSlides - Total number of slides
 * @param direction - Navigation direction
 * @returns Navigation result with new index and whether it changed
 */
export function navigate(
  currentIndex: number,
  totalSlides: number,
  direction: NavigationDirection
): NavigationResult {
  if (totalSlides <= 0) {
    return { newIndex: 0, changed: false, direction: null };
  }
  
  let newIndex: number;
  
  if (direction === 'prev') {
    newIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
  } else {
    newIndex = currentIndex >= totalSlides - 1 ? totalSlides - 1 : currentIndex + 1;
  }
  
  return {
    newIndex,
    changed: newIndex !== currentIndex,
    direction: newIndex !== currentIndex ? direction : null,
  };
}

/**
 * Navigate to previous slide
 * 
 * @param currentIndex - Current slide index
 * @param totalSlides - Total number of slides
 * @returns Navigation result
 */
export function navigatePrev(currentIndex: number, totalSlides: number): NavigationResult {
  return navigate(currentIndex, totalSlides, 'prev');
}

/**
 * Navigate to next slide
 * 
 * @param currentIndex - Current slide index
 * @param totalSlides - Total number of slides
 * @returns Navigation result
 */
export function navigateNext(currentIndex: number, totalSlides: number): NavigationResult {
  return navigate(currentIndex, totalSlides, 'next');
}

/**
 * Check if navigation is possible in a direction
 * 
 * @param currentIndex - Current slide index
 * @param totalSlides - Total number of slides
 * @param direction - Navigation direction
 * @returns Whether navigation is possible
 */
export function canNavigate(
  currentIndex: number,
  totalSlides: number,
  direction: NavigationDirection
): boolean {
  if (totalSlides <= 0) return false;
  
  if (direction === 'prev') {
    return currentIndex > 0;
  } else {
    return currentIndex < totalSlides - 1;
  }
}

/**
 * Determine navigation direction from keyboard event
 * 
 * @param event - Keyboard event
 * @returns Navigation direction or null if not a navigation key
 */
export function getNavigationFromKeyboard(event: KeyboardEvent): NavigationDirection | null {
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return 'prev';
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ': // Space
      return 'next';
    case 'Home':
      return 'prev'; // Will be handled specially to go to first slide
    case 'End':
      return 'next'; // Will be handled specially to go to last slide
    default:
      return null;
  }
}

/**
 * Check if keyboard event should navigate to first/last slide
 * 
 * @param event - Keyboard event
 * @returns 'first', 'last', or null
 */
export function getJumpFromKeyboard(event: KeyboardEvent): 'first' | 'last' | null {
  switch (event.key) {
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

/**
 * Determine navigation direction from click position
 * 
 * @param clickX - X coordinate of click
 * @param containerWidth - Width of the container
 * @returns Navigation direction based on click position
 */
export function getNavigationFromClick(clickX: number, containerWidth: number): NavigationDirection {
  // Left half -> previous, right half -> next
  return clickX < containerWidth / 2 ? 'prev' : 'next';
}

/**
 * Determine navigation direction from wheel event
 * 
 * @param deltaY - Wheel delta Y value
 * @returns Navigation direction based on scroll direction
 */
export function getNavigationFromWheel(deltaY: number): NavigationDirection {
  // Scroll up (negative delta) -> previous, scroll down (positive delta) -> next
  return deltaY < 0 ? 'prev' : 'next';
}

/**
 * Create a keyboard event handler for slide navigation
 * 
 * @param currentIndex - Current slide index
 * @param totalSlides - Total number of slides
 * @param onNavigate - Callback when navigation occurs
 * @returns Event handler function
 */
export function createKeyboardHandler(
  getCurrentIndex: () => number,
  getTotalSlides: () => number,
  onNavigate: (newIndex: number, direction: NavigationDirection) => void
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    const currentIndex = getCurrentIndex();
    const totalSlides = getTotalSlides();
    
    // Check for jump to first/last
    const jump = getJumpFromKeyboard(event);
    if (jump) {
      event.preventDefault();
      const newIndex = jump === 'first' ? 0 : totalSlides - 1;
      if (newIndex !== currentIndex) {
        onNavigate(newIndex, jump === 'first' ? 'prev' : 'next');
      }
      return;
    }
    
    // Check for regular navigation
    const direction = getNavigationFromKeyboard(event);
    if (direction) {
      event.preventDefault();
      const result = navigate(currentIndex, totalSlides, direction);
      if (result.changed && result.direction) {
        onNavigate(result.newIndex, result.direction);
      }
    }
  };
}

/**
 * Create a click event handler for slide navigation
 * 
 * @param getCurrentIndex - Function to get current slide index
 * @param getTotalSlides - Function to get total slides
 * @param onNavigate - Callback when navigation occurs
 * @returns Event handler function
 */
export function createClickHandler(
  getCurrentIndex: () => number,
  getTotalSlides: () => number,
  onNavigate: (newIndex: number, direction: NavigationDirection) => void
): (event: MouseEvent, containerRect: DOMRect) => void {
  return (event: MouseEvent, containerRect: DOMRect) => {
    const currentIndex = getCurrentIndex();
    const totalSlides = getTotalSlides();
    
    const clickX = event.clientX - containerRect.left;
    const direction = getNavigationFromClick(clickX, containerRect.width);
    
    const result = navigate(currentIndex, totalSlides, direction);
    if (result.changed && result.direction) {
      onNavigate(result.newIndex, result.direction);
    }
  };
}

/**
 * Create a wheel event handler for slide navigation
 * 
 * @param getCurrentIndex - Function to get current slide index
 * @param getTotalSlides - Function to get total slides
 * @param onNavigate - Callback when navigation occurs
 * @param debounceMs - Debounce time in milliseconds (default: 100)
 * @returns Event handler function
 */
export function createWheelHandler(
  getCurrentIndex: () => number,
  getTotalSlides: () => number,
  onNavigate: (newIndex: number, direction: NavigationDirection) => void,
  debounceMs: number = 100
): (event: WheelEvent) => void {
  let lastWheelTime = 0;
  
  return (event: WheelEvent) => {
    const now = Date.now();
    if (now - lastWheelTime < debounceMs) {
      return;
    }
    lastWheelTime = now;
    
    const currentIndex = getCurrentIndex();
    const totalSlides = getTotalSlides();
    
    // Ignore small scroll amounts
    if (Math.abs(event.deltaY) < 10) {
      return;
    }
    
    const direction = getNavigationFromWheel(event.deltaY);
    const result = navigate(currentIndex, totalSlides, direction);
    
    if (result.changed && result.direction) {
      event.preventDefault();
      onNavigate(result.newIndex, result.direction);
    }
  };
}
