"use client";

/**
 * Handwriting Editor - 手写编辑器
 * 完整的手写笔记编辑器，支持平板优化
 */

import React, { useEffect, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { useHandwritingStore } from '@/stores/handwriting-store';
import { useApplePencil } from '@/hooks/use-apple-pencil';
import { useSplitView, useVirtualKeyboard, useDeviceOrientation } from '@/hooks/use-split-view';
import { HandwritingCanvas } from './handwriting-canvas';
import { FloatingToolbar } from './floating-toolbar';
import { LayerPanel } from './layer-panel';
import { BackgroundSelector } from './background-selector';
import type { Layer, BackgroundType, ToolType } from '@/lib/handwriting/types';

interface HandwritingEditorProps {
  initialLayers?: Layer[];
  initialBackground?: BackgroundType;
  onChange?: (layers: Layer[]) => void;
  onSave?: () => void;
  readOnly?: boolean;
  className?: string;
  toolbarPosition?: 'top' | 'bottom' | 'left' | 'right';
  compactToolbar?: boolean;
  hideToolbar?: boolean;
  enablePrediction?: boolean;
}

export function HandwritingEditor({
  initialLayers,
  initialBackground,
  onChange,
  onSave,
  readOnly = false,
  className,
  toolbarPosition = 'bottom',
  compactToolbar: _compactToolbar = false,
  hideToolbar = false,
  enablePrediction = true,
}: HandwritingEditorProps) {
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [showBackgroundSelector, setShowBackgroundSelector] = useState(false);
  const [lastTool, setLastTool] = useState<ToolType>('pen');

  const {
    layers, isDirty, activeTool,
    loadDocument, undo, redo, setActiveTool,
  } = useHandwritingStore();

  // 分屏模式检测
  const { isSplitView, isCompact, isSlideOver } = useSplitView();
  const { isKeyboardVisible, keyboardHeight } = useVirtualKeyboard();
  const orientation = useDeviceOrientation();

  // Apple Pencil 双击切换橡皮擦
  useApplePencil({
    onDoubleTap: useCallback(() => {
      if (activeTool === 'eraser') {
        setActiveTool(lastTool);
      } else {
        setLastTool(activeTool);
        setActiveTool('eraser');
      }
    }, [activeTool, lastTool, setActiveTool]),
    enabled: !readOnly,
  });

  // 加载初始数据
  useEffect(() => {
    if (initialLayers) {
      loadDocument(initialLayers, initialBackground);
    }
  }, [initialLayers, initialBackground, loadDocument]);

  // 监听变化
  useEffect(() => {
    if (onChange && isDirty) {
      onChange(layers);
    }
  }, [layers, isDirty, onChange]);

  // 键盘快捷键
  useEffect(() => {
    if (readOnly) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Z: 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      // Ctrl/Cmd + Shift + Z 或 Ctrl/Cmd + Y: 重做
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y')) {
        e.preventDefault();
        redo();
      }
      // Ctrl/Cmd + S: 保存
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave?.();
      }
      // 工具快捷键
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'p': setActiveTool('pen'); break;
          case 'n': setActiveTool('pencil'); break;
          case 'h': setActiveTool('highlighter'); break;
          case 'e': setActiveTool('eraser'); break;
          case 's': setActiveTool('select'); break;
          case 'v': setActiveTool('pan'); break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readOnly, undo, redo, onSave, setActiveTool]);

  // 根据分屏模式调整工具栏位置
  const effectiveToolbarPosition = isSlideOver ? 'bottom' : 
    (orientation === 'landscape' && !isCompact ? 'right' : toolbarPosition);

  // 根据键盘状态调整布局
  const containerStyle = isKeyboardVisible ? {
    paddingBottom: keyboardHeight,
  } : undefined;

  return (
    <div 
      className={cn('relative w-full h-full', className)}
      style={containerStyle}
    >
      {/* 画布 */}
      <HandwritingCanvas enablePrediction={enablePrediction} />

      {/* 工具栏 */}
      {!hideToolbar && !readOnly && (
        <FloatingToolbar
          initialPosition={effectiveToolbarPosition}
          autoHide={!isCompact}
          autoHideDelay={isCompact ? 5000 : 3000}
        />
      )}

      {/* 图层面板 */}
      <LayerPanel
        isOpen={showLayerPanel}
        onClose={() => setShowLayerPanel(false)}
      />

      {/* 背景选择器 */}
      <BackgroundSelector
        isOpen={showBackgroundSelector}
        onClose={() => setShowBackgroundSelector(false)}
      />

      {/* 分屏模式提示 */}
      {isSplitView && isCompact && (
        <div className="absolute top-2 left-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
          紧凑模式
        </div>
      )}
    </div>
  );
}

export default HandwritingEditor;

