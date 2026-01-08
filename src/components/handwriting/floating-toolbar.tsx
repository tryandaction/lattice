"use client";

/**
 * Floating Toolbar - 浮动工具栏
 * 支持迷你模式、自动隐藏、边缘吸附
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import {
  Pen, Pencil, Highlighter, Eraser, Move,
  Undo2, Redo2, Minus, Plus, GripVertical, Lasso,
  Layers, Grid3X3, MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOUCH_TARGET_MIN } from '@/lib/responsive';
import { useHandwritingStore } from '@/stores/handwriting-store';
import { PRESET_COLORS, PRESET_WIDTHS, type ToolType } from '@/lib/handwriting/types';

type ToolbarMode = 'full' | 'compact' | 'mini';
type ToolbarPosition = 'bottom' | 'top' | 'left' | 'right' | 'float';

interface FloatingToolbarProps {
  className?: string;
  initialPosition?: ToolbarPosition;
  autoHide?: boolean;
  autoHideDelay?: number;
}

const TOOLS: { id: ToolType; icon: typeof Pen; label: string; shortcut?: string }[] = [
  { id: 'pen', icon: Pen, label: '钢笔', shortcut: 'P' },
  { id: 'pencil', icon: Pencil, label: '铅笔', shortcut: 'N' },
  { id: 'highlighter', icon: Highlighter, label: '荧光笔', shortcut: 'H' },
  { id: 'eraser', icon: Eraser, label: '橡皮擦', shortcut: 'E' },
  { id: 'select', icon: Lasso, label: '套索', shortcut: 'S' },
  { id: 'pan', icon: Move, label: '平移', shortcut: 'V' },
];

// 最近使用的颜色存储
const RECENT_COLORS_KEY = 'lattice-recent-colors';
const MAX_RECENT_COLORS = 5;

function getRecentColors(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) || '[]');
  } catch {
    return [];
  }
}

function addRecentColor(color: string) {
  const recent = getRecentColors().filter(c => c !== color);
  recent.unshift(color);
  localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_COLORS)));
}


export function FloatingToolbar({
  className,
  initialPosition = 'bottom',
  autoHide = true,
  autoHideDelay = 3000,
}: FloatingToolbarProps) {
  const [mode, setMode] = useState<ToolbarMode>('full');
  const [position] = useState<ToolbarPosition>(initialPosition);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showWidthPicker, setShowWidthPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragControls = useDragControls();

  const {
    activeTool, brushColor, brushWidth, viewport,
    historyIndex, history,
    setActiveTool, setBrushColor, setBrushWidth,
    undo, redo, zoomIn, zoomOut, resetZoom,
  } = useHandwritingStore();

  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < history.length - 1;
  const isHorizontal = position === 'top' || position === 'bottom';

  // 加载最近使用的颜色
  useEffect(() => {
    setRecentColors(getRecentColors());
  }, []);

  // 自动隐藏逻辑
  const resetHideTimer = useCallback(() => {
    if (!autoHide) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (mode !== 'mini') setMode('mini');
    }, autoHideDelay);
  }, [autoHide, autoHideDelay, mode]);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [resetHideTimer]);

  // 监听绘制活动
  useEffect(() => {
    const handlePointerDown = () => resetHideTimer();
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [resetHideTimer]);

  const handleToolClick = useCallback((tool: ToolType) => {
    setActiveTool(tool);
    setShowColorPicker(false);
    setShowWidthPicker(false);
    resetHideTimer();
  }, [setActiveTool, resetHideTimer]);

  const handleColorClick = useCallback((color: string) => {
    setBrushColor(color);
    addRecentColor(color);
    setRecentColors(getRecentColors());
    setShowColorPicker(false);
    resetHideTimer();
  }, [setBrushColor, resetHideTimer]);

  const handleWidthClick = useCallback((width: number) => {
    setBrushWidth(width);
    setShowWidthPicker(false);
    resetHideTimer();
  }, [setBrushWidth, resetHideTimer]);

  const expandToolbar = useCallback(() => {
    setMode('full');
    resetHideTimer();
  }, [resetHideTimer]);

  // 迷你模式 - 只显示当前工具颜色的小圆点
  if (mode === 'mini') {
    return (
      <motion.button
        className={cn(
          'fixed z-50 rounded-full shadow-lg border border-border',
          'bg-card/90 backdrop-blur-sm',
          position === 'bottom' && 'bottom-4 left-1/2 -translate-x-1/2',
          position === 'top' && 'top-4 left-1/2 -translate-x-1/2',
          position === 'left' && 'left-4 top-1/2 -translate-y-1/2',
          position === 'right' && 'right-4 top-1/2 -translate-y-1/2',
          className
        )}
        style={{ width: 48, height: 48 }}
        onClick={expandToolbar}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <div
          className="w-6 h-6 rounded-full mx-auto border-2 border-white shadow-inner"
          style={{ backgroundColor: brushColor }}
        />
      </motion.button>
    );
  }


  // 紧凑模式 - 只显示工具和颜色
  const renderCompactToolbar = () => (
    <div className={cn('flex items-center gap-1', !isHorizontal && 'flex-col')}>
      {/* 当前工具 */}
      {TOOLS.filter(t => t.id === activeTool).map(tool => {
        const Icon = tool.icon;
        return (
          <button
            key={tool.id}
            onClick={() => setMode('full')}
            className="flex items-center justify-center rounded-xl bg-primary text-primary-foreground"
            style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
          >
            <Icon className="h-5 w-5" />
          </button>
        );
      })}
      
      {/* 颜色 */}
      <button
        onClick={() => setShowColorPicker(!showColorPicker)}
        className="flex items-center justify-center rounded-xl hover:bg-muted"
        style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
      >
        <div
          className="w-6 h-6 rounded-full border-2 border-white shadow-sm"
          style={{ backgroundColor: brushColor }}
        />
      </button>
      
      {/* 展开按钮 */}
      <button
        onClick={() => setMode('full')}
        className="flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted"
        style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
    </div>
  );

  // 完整模式
  return (
    <motion.div
      className={cn(
        'fixed z-50 bg-card/95 backdrop-blur-sm rounded-2xl shadow-xl border border-border p-2',
        position === 'bottom' && 'bottom-4 left-1/2 -translate-x-1/2',
        position === 'top' && 'top-4 left-1/2 -translate-x-1/2',
        position === 'left' && 'left-4 top-1/2 -translate-y-1/2',
        position === 'right' && 'right-4 top-1/2 -translate-y-1/2',
        className
      )}
      drag
      dragControls={dragControls}
      dragMomentum={false}
      dragElastic={0.1}
      onPointerDown={() => resetHideTimer()}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {mode === 'compact' ? renderCompactToolbar() : (
        <div className={cn('flex items-center gap-1', !isHorizontal && 'flex-col')}>
          {/* 拖动手柄 */}
          <div
            className={cn(
              'flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground',
              isHorizontal ? 'h-8 w-4' : 'w-8 h-4'
            )}
            onPointerDown={(e) => dragControls.start(e)}
          >
            <GripVertical className={cn('h-4 w-4', !isHorizontal && 'rotate-90')} />
          </div>

          <div className={cn('bg-border', isHorizontal ? 'w-px h-8' : 'h-px w-8')} />

          {/* 工具按钮 */}
          <div className={cn('flex items-center gap-0.5', !isHorizontal && 'flex-col')}>
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              const isActive = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  onClick={() => handleToolClick(tool.id)}
                  className={cn(
                    'flex items-center justify-center rounded-xl transition-all',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-md'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                  style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
                  title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
                >
                  <Icon className="h-5 w-5" />
                </button>
              );
            })}
          </div>

          <div className={cn('bg-border', isHorizontal ? 'w-px h-8' : 'h-px w-8')} />


          {/* 颜色选择器 */}
          <div className="relative">
            <button
              onClick={() => { setShowColorPicker(!showColorPicker); setShowWidthPicker(false); }}
              className="flex items-center justify-center rounded-xl hover:bg-muted"
              style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
              title="颜色"
            >
              <div
                className="w-6 h-6 rounded-full border-2 border-white shadow-sm"
                style={{ backgroundColor: brushColor }}
              />
            </button>

            <AnimatePresence>
              {showColorPicker && (
                <motion.div
                  className={cn(
                    'absolute z-20 bg-card rounded-xl shadow-xl border border-border p-3',
                    position === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2',
                    'left-1/2 -translate-x-1/2'
                  )}
                  initial={{ opacity: 0, y: position === 'bottom' ? 10 : -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: position === 'bottom' ? 10 : -10 }}
                >
                  {/* 最近使用 */}
                  {recentColors.length > 0 && (
                    <>
                      <div className="text-xs text-muted-foreground mb-1">最近使用</div>
                      <div className="flex gap-1 mb-2">
                        {recentColors.map((color, i) => (
                          <button
                            key={`recent-${i}`}
                            onClick={() => handleColorClick(color)}
                            className={cn(
                              'w-7 h-7 rounded-lg transition-transform hover:scale-110',
                              brushColor === color && 'ring-2 ring-primary ring-offset-1'
                            )}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                  
                  {/* 预设颜色 */}
                  <div className="text-xs text-muted-foreground mb-1">预设颜色</div>
                  <div className="grid grid-cols-5 gap-1">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => handleColorClick(color)}
                        className={cn(
                          'w-7 h-7 rounded-lg transition-transform hover:scale-110',
                          brushColor === color && 'ring-2 ring-primary ring-offset-1'
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 宽度选择器 - 滑动调节 */}
          <div className="relative">
            <button
              onClick={() => { setShowWidthPicker(!showWidthPicker); setShowColorPicker(false); }}
              className="flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
              style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
              title="笔画宽度"
            >
              <div
                className="rounded-full bg-current"
                style={{ width: Math.min(20, Math.max(4, brushWidth)), height: Math.min(20, Math.max(4, brushWidth)) }}
              />
            </button>

            <AnimatePresence>
              {showWidthPicker && (
                <motion.div
                  className={cn(
                    'absolute z-20 bg-card rounded-xl shadow-xl border border-border p-3',
                    position === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2',
                    'left-1/2 -translate-x-1/2'
                  )}
                  initial={{ opacity: 0, y: position === 'bottom' ? 10 : -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: position === 'bottom' ? 10 : -10 }}
                >
                  {/* 滑块 */}
                  <input
                    type="range"
                    min="1"
                    max="32"
                    value={brushWidth}
                    onChange={(e) => setBrushWidth(Number(e.target.value))}
                    className="w-32 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <div className="text-xs text-center text-muted-foreground mt-1">{brushWidth}px</div>
                  
                  {/* 预设 */}
                  <div className="flex items-center gap-1 mt-2">
                    {PRESET_WIDTHS.slice(0, 6).map((width) => (
                      <button
                        key={width}
                        onClick={() => handleWidthClick(width)}
                        className={cn(
                          'flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted',
                          brushWidth === width && 'ring-2 ring-primary'
                        )}
                      >
                        <div
                          className="rounded-full bg-foreground"
                          style={{ width: Math.min(20, width), height: Math.min(20, width) }}
                        />
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className={cn('bg-border', isHorizontal ? 'w-px h-8' : 'h-px w-8')} />


          {/* 撤销/重做 */}
          <div className={cn('flex items-center gap-0.5', !isHorizontal && 'flex-col')}>
            <button
              onClick={undo}
              disabled={!canUndo}
              className={cn(
                'flex items-center justify-center rounded-xl transition-all',
                canUndo ? 'text-muted-foreground hover:bg-muted hover:text-foreground' : 'text-muted-foreground/30'
              )}
              style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
              title="撤销 (Ctrl+Z)"
            >
              <Undo2 className="h-5 w-5" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className={cn(
                'flex items-center justify-center rounded-xl transition-all',
                canRedo ? 'text-muted-foreground hover:bg-muted hover:text-foreground' : 'text-muted-foreground/30'
              )}
              style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
              title="重做 (Ctrl+Y)"
            >
              <Redo2 className="h-5 w-5" />
            </button>
          </div>

          <div className={cn('bg-border', isHorizontal ? 'w-px h-8' : 'h-px w-8')} />

          {/* 缩放 */}
          <div className={cn('flex items-center gap-0.5', !isHorizontal && 'flex-col')}>
            <button
              onClick={zoomOut}
              className="flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
              style={{ minWidth: 36, minHeight: TOUCH_TARGET_MIN }}
              title="缩小"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              onClick={resetZoom}
              className="flex items-center justify-center px-1 rounded-xl text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              style={{ minHeight: TOUCH_TARGET_MIN }}
              title="重置"
            >
              {Math.round(viewport.scale * 100)}%
            </button>
            <button
              onClick={zoomIn}
              className="flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
              style={{ minWidth: 36, minHeight: TOUCH_TARGET_MIN }}
              title="放大"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className={cn('bg-border', isHorizontal ? 'w-px h-8' : 'h-px w-8')} />

          {/* 更多菜单 */}
          <div className="relative">
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
              style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
              title="更多"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>

            <AnimatePresence>
              {showMoreMenu && (
                <motion.div
                  className={cn(
                    'absolute z-20 bg-card rounded-xl shadow-xl border border-border p-2 min-w-[120px]',
                    position === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2',
                    'right-0'
                  )}
                  initial={{ opacity: 0, y: position === 'bottom' ? 10 : -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: position === 'bottom' ? 10 : -10 }}
                >
                  <button
                    onClick={() => { setMode('compact'); setShowMoreMenu(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    紧凑模式
                  </button>
                  <button
                    onClick={() => { setMode('mini'); setShowMoreMenu(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted"
                  >
                    <div className="w-4 h-4 rounded-full bg-current" />
                    迷你模式
                  </button>
                  <div className="h-px bg-border my-1" />
                  <button
                    onClick={() => setShowMoreMenu(false)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted"
                  >
                    <Layers className="h-4 w-4" />
                    图层
                  </button>
                  <button
                    onClick={() => setShowMoreMenu(false)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted"
                  >
                    <Grid3X3 className="h-4 w-4" />
                    背景
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default FloatingToolbar;

