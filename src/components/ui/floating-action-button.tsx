"use client";

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOUCH_TARGET_MIN } from '@/lib/responsive';

interface FABAction {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

interface FloatingActionButtonProps {
  /** Main button icon */
  icon?: React.ReactNode;
  /** Click handler for main button (when no actions) */
  onClick?: () => void;
  /** Expandable action items */
  actions?: FABAction[];
  /** Position of the FAB */
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center';
  /** Custom class name */
  className?: string;
  /** Whether the FAB is visible */
  visible?: boolean;
  /** Aria label for accessibility */
  ariaLabel?: string;
}

const positionClasses = {
  'bottom-right': 'right-4 bottom-4',
  'bottom-left': 'left-4 bottom-4',
  'bottom-center': 'left-1/2 -translate-x-1/2 bottom-4',
};

/**
 * FloatingActionButton - A Material Design style FAB for mobile
 * 
 * Features:
 * - Expandable action menu
 * - Touch-friendly size (56px)
 * - Smooth animations
 * - Accessible
 * 
 * Requirements: 5.3
 */
export function FloatingActionButton({
  icon = <Plus className="h-6 w-6" />,
  onClick,
  actions,
  position = 'bottom-right',
  className,
  visible = true,
  ariaLabel = 'Actions',
}: FloatingActionButtonProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleMainClick = useCallback(() => {
    if (actions && actions.length > 0) {
      setIsExpanded((prev) => !prev);
    } else if (onClick) {
      onClick();
    }
  }, [actions, onClick]);

  const handleActionClick = useCallback((action: FABAction) => {
    action.onClick();
    setIsExpanded(false);
  }, []);

  const handleBackdropClick = useCallback(() => {
    setIsExpanded(false);
  }, []);

  if (!visible) return null;

  return (
    <>
      {/* Backdrop when expanded */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className="fixed inset-0 z-40 bg-black/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleBackdropClick}
          />
        )}
      </AnimatePresence>

      {/* FAB Container */}
      <div
        className={cn(
          'fixed z-50 flex flex-col-reverse items-center gap-3',
          positionClasses[position],
          className
        )}
      >
        {/* Action items */}
        <AnimatePresence>
          {isExpanded && actions && (
            <motion.div
              className="flex flex-col-reverse items-center gap-2 mb-2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2 }}
            >
              {actions.map((action, index) => (
                <motion.div
                  key={index}
                  className="flex items-center gap-2"
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 10 }}
                  transition={{ delay: index * 0.05 }}
                >
                  {/* Label */}
                  <span className="px-3 py-1.5 bg-card text-foreground text-sm rounded-lg shadow-md whitespace-nowrap">
                    {action.label}
                  </span>
                  {/* Mini FAB */}
                  <button
                    onClick={() => handleActionClick(action)}
                    className={cn(
                      'flex items-center justify-center',
                      'w-12 h-12 rounded-full',
                      'bg-card text-foreground',
                      'shadow-lg',
                      'hover:bg-muted transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
                    )}
                    style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
                    aria-label={action.label}
                  >
                    {action.icon}
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main FAB */}
        <motion.button
          onClick={handleMainClick}
          className={cn(
            'flex items-center justify-center',
            'w-14 h-14 rounded-full',
            'bg-primary text-primary-foreground',
            'shadow-lg',
            'hover:bg-primary/90 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
          )}
          style={{ minWidth: 56, minHeight: 56 }}
          whileTap={{ scale: 0.95 }}
          animate={{ rotate: isExpanded ? 45 : 0 }}
          transition={{ duration: 0.2 }}
          aria-label={ariaLabel}
          aria-expanded={isExpanded}
        >
          {isExpanded ? <X className="h-6 w-6" /> : icon}
        </motion.button>
      </div>
    </>
  );
}

/**
 * Simple FAB without expandable actions
 */
export function SimpleFAB({
  icon,
  onClick,
  position = 'bottom-right',
  className,
  visible = true,
  ariaLabel,
}: Omit<FloatingActionButtonProps, 'actions'>) {
  if (!visible) return null;

  return (
    <motion.button
      onClick={onClick}
      className={cn(
        'fixed z-50',
        'flex items-center justify-center',
        'w-14 h-14 rounded-full',
        'bg-primary text-primary-foreground',
        'shadow-lg',
        'hover:bg-primary/90 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
        positionClasses[position],
        className
      )}
      style={{ minWidth: 56, minHeight: 56 }}
      whileTap={{ scale: 0.95 }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      aria-label={ariaLabel}
    >
      {icon}
    </motion.button>
  );
}
