"use client";

/**
 * Background Selector Component
 * 背景选择器 - 选择画布背景类型
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Grid3X3, Minus, Circle, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOUCH_TARGET_MIN } from '@/lib/responsive';
import { useHandwritingStore } from '@/stores/handwriting-store';
import type { BackgroundType } from '@/lib/handwriting/types';

interface BackgroundSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

const BACKGROUNDS: { type: BackgroundType; icon: typeof Grid3X3; label: string }[] = [
  { type: 'blank', icon: Square, label: '空白' },
  { type: 'grid', icon: Grid3X3, label: '网格' },
  { type: 'lines', icon: Minus, label: '横线' },
  { type: 'dots', icon: Circle, label: '点阵' },
];

export function BackgroundSelector({
  isOpen,
  onClose,
  className,
}: BackgroundSelectorProps) {
  const { background, setBackground } = useHandwritingStore();

  const handleSelect = (type: BackgroundType) => {
    setBackground(type);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            className="fixed inset-0 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* 选择器面板 */}
          <motion.div
            className={cn(
              'absolute z-50',
              'bg-card rounded-xl shadow-xl border border-border',
              'p-3',
              className
            )}
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
          >
            <div className="text-xs text-muted-foreground mb-2 px-1">
              背景样式
            </div>
            <div className="grid grid-cols-2 gap-2">
              {BACKGROUNDS.map(({ type, icon: Icon, label }) => (
                <button
                  key={type}
                  onClick={() => handleSelect(type)}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1',
                    'rounded-lg transition-all p-2',
                    background === type
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                  )}
                  style={{
                    minWidth: TOUCH_TARGET_MIN * 1.5,
                    minHeight: TOUCH_TARGET_MIN * 1.5,
                  }}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-xs">{label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default BackgroundSelector;

