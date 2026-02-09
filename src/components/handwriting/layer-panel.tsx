"use client";

/**
 * Layer Panel Component
 * 图层面板 - 管理手写笔记图层
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Plus,
  Trash2,
  GripVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOUCH_TARGET_MIN } from '@/lib/responsive';
import { useHandwritingStore } from '@/stores/handwriting-store';

interface LayerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

export function LayerPanel({
  isOpen,
  onClose,
  className,
}: LayerPanelProps) {
  const {
    layers,
    activeLayerId,
    setActiveLayer,
    addLayer,
    removeLayer,
    toggleLayerVisibility,
    toggleLayerLock,
  } = useHandwritingStore();

  const handleAddLayer = () => {
    addLayer();
  };

  const handleRemoveLayer = (id: string) => {
    if (layers.length > 1) {
      removeLayer(id);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* 图层面板 */}
          <motion.div
            className={cn(
              'fixed right-4 top-1/2 -translate-y-1/2 z-50',
              'bg-card rounded-xl shadow-xl border border-border',
              'w-64 max-h-96 overflow-hidden',
              'flex flex-col',
              className
            )}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between p-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">图层</span>
              </div>
              <button
                onClick={handleAddLayer}
                className={cn(
                  'flex items-center justify-center',
                  'rounded-lg transition-colors',
                  'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
                style={{
                  minWidth: TOUCH_TARGET_MIN - 8,
                  minHeight: TOUCH_TARGET_MIN - 8,
                }}
                title="添加图层"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* 图层列表 */}
            <div className="flex-1 overflow-y-auto p-2">
              {layers.map((layer) => (
                <div
                  key={layer.id}
                  className={cn(
                    'flex items-center gap-2 p-2 rounded-lg mb-1',
                    'transition-colors cursor-pointer',
                    activeLayerId === layer.id
                      ? 'bg-primary/10 border border-primary/20'
                      : 'hover:bg-muted'
                  )}
                  onClick={() => setActiveLayer(layer.id)}
                >
                  {/* 拖动手柄 */}
                  <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab" />

                  {/* 图层名称 */}
                  <span className="flex-1 text-sm truncate">
                    {layer.name}
                  </span>

                  {/* 笔画数量 */}
                  <span className="text-xs text-muted-foreground">
                    {layer.strokes.length}
                  </span>

                  {/* 可见性切换 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerVisibility(layer.id);
                    }}
                    className={cn(
                      'p-1 rounded transition-colors',
                      layer.visible
                        ? 'text-foreground hover:bg-muted'
                        : 'text-muted-foreground/50 hover:bg-muted'
                    )}
                    title={layer.visible ? '隐藏图层' : '显示图层'}
                  >
                    {layer.visible ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                  </button>

                  {/* 锁定切换 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerLock(layer.id);
                    }}
                    className={cn(
                      'p-1 rounded transition-colors',
                      layer.locked
                        ? 'text-destructive hover:bg-muted'
                        : 'text-muted-foreground/50 hover:bg-muted'
                    )}
                    title={layer.locked ? '解锁图层' : '锁定图层'}
                  >
                    {layer.locked ? (
                      <Lock className="h-4 w-4" />
                    ) : (
                      <Unlock className="h-4 w-4" />
                    )}
                  </button>

                  {/* 删除按钮 */}
                  {layers.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveLayer(layer.id);
                      }}
                      className="p-1 rounded text-muted-foreground/50 hover:text-destructive hover:bg-muted transition-colors"
                      title="删除图层"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default LayerPanel;

