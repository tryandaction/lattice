"use client";

import React, { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, PanInfo, useAnimation } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOUCH_TARGET_MIN } from '@/lib/responsive';

interface MobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** Width of the sidebar in pixels or percentage */
  width?: number | string;
}

// Animation variants for the sidebar
const sidebarVariants = {
  closed: {
    x: '-100%',
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 40,
    },
  },
  open: {
    x: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 40,
    },
  },
};

// Animation variants for the overlay
const overlayVariants = {
  closed: {
    opacity: 0,
    transition: {
      duration: 0.2,
    },
  },
  open: {
    opacity: 1,
    transition: {
      duration: 0.2,
    },
  },
};

// Swipe threshold for closing (in pixels)
const SWIPE_THRESHOLD = 50;
// Velocity threshold for closing (in pixels per second)
const VELOCITY_THRESHOLD = 500;

/**
 * MobileSidebar - A drawer-style sidebar for mobile devices
 * 
 * Features:
 * - Slides in from the left with spring animation
 * - Background overlay that closes sidebar on tap
 * - Swipe left gesture to close
 * - Touch-friendly close button (44px minimum)
 * - Prevents body scroll when open
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */
export function MobileSidebar({
  isOpen,
  onClose,
  children,
  className,
  width = '85%',
}: MobileSidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const controls = useAnimation();

  // Prevent body scroll when sidebar is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Handle drag/swipe gesture
  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const { offset, velocity } = info;

      // Close if swiped left past threshold or with high velocity
      if (offset.x < -SWIPE_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) {
        onClose();
      } else {
        // Snap back to open position
        controls.start('open');
      }
    },
    [onClose, controls]
  );

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      // Only close if clicking the overlay itself, not the sidebar
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            variants={overlayVariants}
            initial="closed"
            animate="open"
            exit="closed"
            onClick={handleOverlayClick}
            aria-hidden="true"
          />

          {/* Sidebar */}
          <motion.div
            ref={sidebarRef}
            className={cn(
              'fixed left-0 top-0 z-50 h-full',
              'bg-card border-r border-border',
              'flex flex-col',
              'shadow-xl',
              className
            )}
            style={{ width }}
            variants={sidebarVariants}
            initial="closed"
            animate={controls}
            exit="closed"
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.2, right: 0 }}
            onDragEnd={handleDragEnd}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation sidebar"
          >
            {/* Close button - touch-friendly size */}
            <div className="flex items-center justify-end p-2 border-b border-border">
              <button
                onClick={onClose}
                className={cn(
                  'flex items-center justify-center',
                  'rounded-md',
                  'text-muted-foreground hover:text-foreground',
                  'hover:bg-muted',
                  'transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
                )}
                style={{
                  minWidth: TOUCH_TARGET_MIN,
                  minHeight: TOUCH_TARGET_MIN,
                }}
                aria-label="Close sidebar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Sidebar content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {children}
            </div>

            {/* Drag indicator */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-16 bg-muted-foreground/20 rounded-full mr-1" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * MobileSidebarTrigger - A touch-friendly button to open the sidebar
 */
interface MobileSidebarTriggerProps {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}

export function MobileSidebarTrigger({
  onClick,
  children,
  className,
}: MobileSidebarTriggerProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center justify-center',
        'rounded-md',
        'text-muted-foreground hover:text-foreground',
        'hover:bg-muted',
        'transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
        className
      )}
      style={{
        minWidth: TOUCH_TARGET_MIN,
        minHeight: TOUCH_TARGET_MIN,
      }}
      aria-label="Open sidebar"
    >
      {children}
    </button>
  );
}
