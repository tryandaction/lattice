"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import {
  ResponsiveState,
  ResponsiveContextValue,
  getResponsiveState,
  createResponsiveContextValue,
} from '@/lib/responsive';

// Create context with undefined default (will be provided by provider)
const ResponsiveContext = createContext<ResponsiveContextValue | undefined>(undefined);

// Debounce delay for resize events (ms)
const RESIZE_DEBOUNCE_DELAY = 100;

interface ResponsiveProviderProps {
  children: React.ReactNode;
}

/**
 * ResponsiveProvider - Provides responsive state to the entire application
 * 
 * Features:
 * - Detects device type (mobile/tablet/desktop) based on screen width
 * - Detects screen orientation (portrait/landscape)
 * - Detects touch and stylus support
 * - Updates state on window resize with debouncing
 * - SSR-safe with hydration handling
 */
export function ResponsiveProvider({ children }: ResponsiveProviderProps) {
  // Initialize with SSR-safe default state
  const [state, setState] = useState<ResponsiveState>(() => getResponsiveState());

  // Update state from window dimensions
  const updateState = useCallback(() => {
    setState(getResponsiveState());
  }, []);

  // Handle hydration and initial state
  useEffect(() => {
    // Update state after hydration to get accurate client values
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateState();
  }, [updateState]);

  // Handle window resize with debouncing
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleResize = () => {
      // Clear previous timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Debounce resize updates
      timeoutId = setTimeout(() => {
        updateState();
      }, RESIZE_DEBOUNCE_DELAY);
    };

    // Listen for resize events
    window.addEventListener('resize', handleResize);

    // Listen for orientation change events (mobile devices)
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [updateState]);

  // Create context value with computed helpers
  const contextValue = useMemo(() => {
    return createResponsiveContextValue(state);
  }, [state]);

  // During SSR or before hydration, still render children but with default state
  // This prevents hydration mismatches
  return (
    <ResponsiveContext.Provider value={contextValue}>
      {children}
    </ResponsiveContext.Provider>
  );
}

/**
 * useResponsive - Hook to access responsive state
 * 
 * Returns:
 * - deviceType: 'mobile' | 'tablet' | 'desktop'
 * - orientation: 'portrait' | 'landscape'
 * - isTouchDevice: boolean
 * - hasStylusSupport: boolean
 * - screenWidth: number
 * - screenHeight: number
 * - isMobile: boolean (computed)
 * - isTablet: boolean (computed)
 * - isDesktop: boolean (computed)
 * - isPortrait: boolean (computed)
 * - isLandscape: boolean (computed)
 * 
 * @throws Error if used outside of ResponsiveProvider
 */
export function useResponsive(): ResponsiveContextValue {
  const context = useContext(ResponsiveContext);
  
  if (context === undefined) {
    throw new Error('useResponsive must be used within a ResponsiveProvider');
  }
  
  return context;
}

/**
 * useIsMobile - Convenience hook for mobile detection
 */
export function useIsMobile(): boolean {
  const { isMobile } = useResponsive();
  return isMobile;
}

/**
 * useIsTablet - Convenience hook for tablet detection
 */
export function useIsTablet(): boolean {
  const { isTablet } = useResponsive();
  return isTablet;
}

/**
 * useIsDesktop - Convenience hook for desktop detection
 */
export function useIsDesktop(): boolean {
  const { isDesktop } = useResponsive();
  return isDesktop;
}

/**
 * useIsTouchDevice - Convenience hook for touch device detection
 */
export function useIsTouchDevice(): boolean {
  const { isTouchDevice } = useResponsive();
  return isTouchDevice;
}

/**
 * useDeviceType - Convenience hook for device type
 */
export function useDeviceType() {
  const { deviceType } = useResponsive();
  return deviceType;
}

/**
 * useOrientation - Convenience hook for orientation
 */
export function useOrientation() {
  const { orientation, isPortrait, isLandscape } = useResponsive();
  return { orientation, isPortrait, isLandscape };
}

// Export context for testing purposes
export { ResponsiveContext };
