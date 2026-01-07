/**
 * Responsive utilities for mobile and tablet adaptation
 * 
 * This module provides breakpoint constants, type definitions,
 * and utility functions for responsive design.
 */

// Breakpoint constants (in pixels)
export const BREAKPOINTS = {
  mobile: 640,   // < 640px is mobile
  tablet: 1024,  // 640px - 1024px is tablet
  desktop: 1280, // > 1024px is desktop
} as const;

// Touch target minimum size (Apple HIG recommendation)
export const TOUCH_TARGET_MIN = 44;

// Device type
export type DeviceType = 'mobile' | 'tablet' | 'desktop';

// Screen orientation
export type Orientation = 'portrait' | 'landscape';

// Pointer type for input detection
export type PointerType = 'pen' | 'touch' | 'mouse';

// Responsive state interface
export interface ResponsiveState {
  deviceType: DeviceType;
  orientation: Orientation;
  isTouchDevice: boolean;
  hasStylusSupport: boolean;
  screenWidth: number;
  screenHeight: number;
}

// Extended responsive context value with computed helpers
export interface ResponsiveContextValue extends ResponsiveState {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isPortrait: boolean;
  isLandscape: boolean;
}

/**
 * Get device type based on screen width
 * 
 * Property 1: Device Classification Correctness
 * - width < 640px → 'mobile'
 * - 640px ≤ width < 1024px → 'tablet'
 * - width ≥ 1024px → 'desktop'
 */
export function getDeviceType(width: number): DeviceType {
  if (width < BREAKPOINTS.mobile) {
    return 'mobile';
  }
  if (width < BREAKPOINTS.tablet) {
    return 'tablet';
  }
  return 'desktop';
}

/**
 * Get screen orientation based on dimensions
 */
export function getOrientation(width: number, height: number): Orientation {
  return width >= height ? 'landscape' : 'portrait';
}

/**
 * Check if the device supports touch input
 */
export function checkTouchSupport(): boolean {
  if (typeof window === 'undefined') return false;
  
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    // @ts-expect-error - msMaxTouchPoints is IE-specific
    navigator.msMaxTouchPoints > 0
  );
}

/**
 * Check if the device potentially supports stylus input
 * Note: Actual stylus support can only be confirmed when a pen event occurs
 */
export function checkStylusSupport(): boolean {
  if (typeof window === 'undefined') return false;
  
  // Check for PointerEvent support (required for stylus)
  if (!window.PointerEvent) return false;
  
  // Check for touch support (stylus devices typically have touch)
  return checkTouchSupport();
}

/**
 * Get current responsive state from window
 */
export function getResponsiveState(): ResponsiveState {
  if (typeof window === 'undefined') {
    // SSR fallback - assume desktop
    return {
      deviceType: 'desktop',
      orientation: 'landscape',
      isTouchDevice: false,
      hasStylusSupport: false,
      screenWidth: 1280,
      screenHeight: 800,
    };
  }

  const width = window.innerWidth;
  const height = window.innerHeight;

  return {
    deviceType: getDeviceType(width),
    orientation: getOrientation(width, height),
    isTouchDevice: checkTouchSupport(),
    hasStylusSupport: checkStylusSupport(),
    screenWidth: width,
    screenHeight: height,
  };
}

/**
 * Create responsive context value with computed helpers
 */
export function createResponsiveContextValue(state: ResponsiveState): ResponsiveContextValue {
  return {
    ...state,
    isMobile: state.deviceType === 'mobile',
    isTablet: state.deviceType === 'tablet',
    isDesktop: state.deviceType === 'desktop',
    isPortrait: state.orientation === 'portrait',
    isLandscape: state.orientation === 'landscape',
  };
}

/**
 * CSS media query strings for use in styled-components or CSS-in-JS
 */
export const mediaQueries = {
  mobile: `(max-width: ${BREAKPOINTS.mobile - 1}px)`,
  tablet: `(min-width: ${BREAKPOINTS.mobile}px) and (max-width: ${BREAKPOINTS.tablet - 1}px)`,
  desktop: `(min-width: ${BREAKPOINTS.tablet}px)`,
  touch: '(hover: none) and (pointer: coarse)',
  stylus: '(hover: none) and (pointer: fine)',
  portrait: '(orientation: portrait)',
  landscape: '(orientation: landscape)',
} as const;

/**
 * Tailwind-compatible breakpoint classes
 */
export const breakpointClasses = {
  mobile: 'max-sm',      // < 640px
  tablet: 'sm:max-lg',   // 640px - 1024px
  desktop: 'lg:',        // > 1024px
} as const;
