"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AutoHideHeaderProps {
  children: React.ReactNode;
  /** Reference to the scroll container */
  scrollContainerRef?: React.RefObject<HTMLElement>;
  /** Pixels to scroll before hiding (default: 50) */
  threshold?: number;
  /** Height of the header in pixels (default: auto) */
  height?: number;
  /** Custom class name */
  className?: string;
  /** Whether auto-hide is enabled (default: true) */
  enabled?: boolean;
  /** Callback when visibility changes */
  onVisibilityChange?: (visible: boolean) => void;
}

/**
 * AutoHideHeader - A header that hides on scroll down and shows on scroll up
 * 
 * Features:
 * - Smooth CSS transform animation
 * - Configurable scroll threshold
 * - Works with any scroll container
 * - Accessible (doesn't hide content, just moves it)
 * 
 * Requirements: 5.4, 5.5
 */
export function AutoHideHeader({
  children,
  scrollContainerRef,
  threshold = 50,
  height,
  className,
  enabled = true,
  onVisibilityChange,
}: AutoHideHeaderProps) {
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollY = useRef(0);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(height || 0);

  // Measure header height if not provided
  useEffect(() => {
    if (!height && headerRef.current) {
      setHeaderHeight(headerRef.current.offsetHeight);
    }
  }, [height, children]);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    if (!enabled) return;

    const currentScrollY = scrollContainerRef?.current
      ? scrollContainerRef.current.scrollTop
      : window.scrollY;

    const scrollDelta = currentScrollY - lastScrollY.current;

    // Scrolling down - hide header
    if (scrollDelta > 0 && currentScrollY > threshold) {
      if (isVisible) {
        setIsVisible(false);
        onVisibilityChange?.(false);
      }
    }
    // Scrolling up - show header
    else if (scrollDelta < 0) {
      if (!isVisible) {
        setIsVisible(true);
        onVisibilityChange?.(true);
      }
    }

    lastScrollY.current = currentScrollY;
  }, [enabled, scrollContainerRef, threshold, isVisible, onVisibilityChange]);

  // Attach scroll listener
  useEffect(() => {
    if (!enabled) return;

    const scrollContainer = scrollContainerRef?.current || window;
    
    // Use passive listener for better performance
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, [enabled, scrollContainerRef, handleScroll]);

  // Reset visibility when disabled
  useEffect(() => {
    if (!enabled && !isVisible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsVisible(true);
      onVisibilityChange?.(true);
    }
  }, [enabled, isVisible, onVisibilityChange]);

  return (
    <motion.header
      ref={headerRef}
      className={cn(
        'sticky top-0 z-30',
        'bg-card border-b border-border',
        'transition-shadow',
        !isVisible && 'shadow-none',
        className
      )}
      initial={false}
      animate={{
        y: isVisible ? 0 : -(height || headerHeight),
        opacity: isVisible ? 1 : 0,
      }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 40,
      }}
      style={{
        height: height || 'auto',
      }}
    >
      {children}
    </motion.header>
  );
}

/**
 * Hook for auto-hide header logic (for custom implementations)
 */
export function useAutoHideHeader(
  scrollContainerRef?: React.RefObject<HTMLElement>,
  options?: {
    threshold?: number;
    enabled?: boolean;
  }
) {
  const { threshold = 50, enabled = true } = options || {};
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollY = useRef(0);

  const handleScroll = useCallback(() => {
    if (!enabled) return;

    const currentScrollY = scrollContainerRef?.current
      ? scrollContainerRef.current.scrollTop
      : window.scrollY;

    const scrollDelta = currentScrollY - lastScrollY.current;

    if (scrollDelta > 0 && currentScrollY > threshold) {
      setIsVisible(false);
    } else if (scrollDelta < 0) {
      setIsVisible(true);
    }

    lastScrollY.current = currentScrollY;
  }, [enabled, scrollContainerRef, threshold]);

  useEffect(() => {
    if (!enabled) return;

    const scrollContainer = scrollContainerRef?.current || window;
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, [enabled, scrollContainerRef, handleScroll]);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsVisible(true);
    }
  }, [enabled]);

  return {
    isVisible,
    setIsVisible,
  };
}
