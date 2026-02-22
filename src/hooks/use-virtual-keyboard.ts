"use client";

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Virtual keyboard state
 */
export interface VirtualKeyboardState {
  /** Whether the keyboard is currently visible */
  isVisible: boolean;
  /** Height of the keyboard in pixels */
  height: number;
  /** Whether the keyboard is animating */
  isAnimating: boolean;
}

/**
 * Options for the virtual keyboard hook
 */
export interface UseVirtualKeyboardOptions {
  /** Callback when keyboard shows */
  onShow?: (height: number) => void;
  /** Callback when keyboard hides */
  onHide?: () => void;
  /** Callback when keyboard height changes */
  onHeightChange?: (height: number) => void;
  /** Whether to adjust viewport (default: true) */
  adjustViewport?: boolean;
  /** Minimum height to consider as keyboard (default: 150) */
  minKeyboardHeight?: number;
}

/**
 * Hook for detecting and handling virtual keyboard on mobile devices
 * 
 * Features:
 * - Detects keyboard show/hide
 * - Calculates keyboard height
 * - Provides viewport adjustment utilities
 * - Works with iOS and Android
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */
export function useVirtualKeyboard(options: UseVirtualKeyboardOptions = {}) {
  const {
    onShow,
    onHide,
    onHeightChange,
    adjustViewport = true,
    minKeyboardHeight = 150,
  } = options;

  const [state, setState] = useState<VirtualKeyboardState>({
    isVisible: false,
    height: 0,
    isAnimating: false,
  });

  const previousHeightRef = useRef(0);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Calculate keyboard height from visual viewport
  const calculateKeyboardHeight = useCallback(() => {
    if (typeof window === 'undefined') return 0;

    // Use Visual Viewport API if available (modern browsers)
    if (window.visualViewport) {
      const viewportHeight = window.visualViewport.height;
      const windowHeight = window.innerHeight;
      const heightDiff = windowHeight - viewportHeight;
      
      // Only consider it a keyboard if the difference is significant
      return heightDiff > minKeyboardHeight ? heightDiff : 0;
    }

    // Fallback: compare window height to document height
    // This is less reliable but works on older browsers
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.clientHeight;
    const heightDiff = documentHeight - windowHeight;
    
    return heightDiff > minKeyboardHeight ? heightDiff : 0;
  }, [minKeyboardHeight]);

  // Handle viewport changes
  const handleViewportChange = useCallback(() => {
    const newHeight = calculateKeyboardHeight();
    const wasVisible = previousHeightRef.current > 0;
    const isNowVisible = newHeight > 0;

    // Clear any pending animation timeout
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
    }

    // Set animating state
    if (wasVisible !== isNowVisible) {
      setState(prev => ({ ...prev, isAnimating: true }));
      
      // Clear animating state after animation completes
      animationTimeoutRef.current = setTimeout(() => {
        setState(prev => ({ ...prev, isAnimating: false }));
      }, 300);
    }

    // Update state
    setState(prev => ({
      ...prev,
      isVisible: isNowVisible,
      height: newHeight,
    }));

    // Call callbacks
    if (!wasVisible && isNowVisible) {
      onShow?.(newHeight);
    } else if (wasVisible && !isNowVisible) {
      onHide?.();
    }

    if (newHeight !== previousHeightRef.current) {
      onHeightChange?.(newHeight);
    }

    previousHeightRef.current = newHeight;
  }, [calculateKeyboardHeight, onShow, onHide, onHeightChange]);

  // Set up event listeners
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Use Visual Viewport API if available
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportChange);
      window.visualViewport.addEventListener('scroll', handleViewportChange);
    }

    // Also listen to window resize as fallback
    window.addEventListener('resize', handleViewportChange);

    // Listen to focus events on input elements
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // Small delay to allow keyboard to appear
        setTimeout(handleViewportChange, 100);
      }
    };

    const handleFocusOut = () => {
      // Small delay to allow keyboard to hide
      setTimeout(handleViewportChange, 100);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    // Initial check
    // eslint-disable-next-line react-hooks/set-state-in-effect
    handleViewportChange();

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportChange);
        window.visualViewport.removeEventListener('scroll', handleViewportChange);
      }
      window.removeEventListener('resize', handleViewportChange);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);

      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, [handleViewportChange]);

  // Apply viewport adjustment
  useEffect(() => {
    if (!adjustViewport || typeof document === 'undefined') return;

    if (state.isVisible) {
      // Add padding to body to account for keyboard
      document.body.style.paddingBottom = `${state.height}px`;
    } else {
      document.body.style.paddingBottom = '';
    }

    return () => {
      document.body.style.paddingBottom = '';
    };
  }, [state.isVisible, state.height, adjustViewport]);

  /**
   * Scroll an element into view, accounting for keyboard
   */
  const scrollIntoView = useCallback((element: HTMLElement | null, options?: ScrollIntoViewOptions) => {
    if (!element) return;

    // Default options
    const scrollOptions: ScrollIntoViewOptions = {
      behavior: 'smooth',
      block: 'center',
      ...options,
    };

    // If keyboard is visible, we need to account for it
    if (state.isVisible) {
      // Get element position
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      
      // Check if element is below the visible area
      if (rect.bottom > viewportHeight) {
        element.scrollIntoView(scrollOptions);
      }
    } else {
      element.scrollIntoView(scrollOptions);
    }
  }, [state.isVisible]);

  /**
   * Get the available viewport height (excluding keyboard)
   */
  const getAvailableHeight = useCallback(() => {
    if (typeof window === 'undefined') return 0;
    
    if (window.visualViewport) {
      return window.visualViewport.height;
    }
    
    return window.innerHeight - state.height;
  }, [state.height]);

  return {
    ...state,
    scrollIntoView,
    getAvailableHeight,
  };
}

/**
 * Hook for adjusting an element's position when keyboard appears
 */
export function useKeyboardAvoidance(elementRef: React.RefObject<HTMLElement>) {
  const { isVisible, height, scrollIntoView } = useVirtualKeyboard({
    adjustViewport: false,
  });

  useEffect(() => {
    if (isVisible && elementRef.current) {
      // Check if element is focused or contains focused element
      const activeElement = document.activeElement;
      if (
        elementRef.current === activeElement ||
        elementRef.current.contains(activeElement)
      ) {
        scrollIntoView(elementRef.current);
      }
    }
  }, [isVisible, height, elementRef, scrollIntoView]);

  return { isKeyboardVisible: isVisible, keyboardHeight: height };
}

/**
 * CSS custom property for keyboard height
 * Can be used in CSS: var(--keyboard-height)
 */
export function useKeyboardHeightCSSVar() {
  const { height } = useVirtualKeyboard({ adjustViewport: false });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    
    document.documentElement.style.setProperty('--keyboard-height', `${height}px`);
    
    return () => {
      document.documentElement.style.removeProperty('--keyboard-height');
    };
  }, [height]);
}
