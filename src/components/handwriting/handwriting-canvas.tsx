"use client";

/**
 * Handwriting Canvas - 手写画布
 * 支持笔迹预测、套索选择、高性能渲染
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useHandwritingStore } from '@/stores/handwriting-store';
import {
  renderStrokes,
  renderActiveStroke,
  isPointOnStroke,
  createPalmRejection,
  createGestureRecognizer,
  type StrokePoint,
  type Viewport,
  type BackgroundType,
} from '@/lib/handwriting';
import { generatePredictedPoints } from '@/lib/handwriting/stroke-predictor';
import {
  isStrokeInSelection,
  getSelectionBounds,
  type SelectionBounds,
  type LassoPath,
} from '@/lib/handwriting/lasso-selection';

interface HandwritingCanvasProps {
  className?: string;
  width?: number;
  height?: number;
  enablePrediction?: boolean;
}

// 背景渲染
function renderBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: BackgroundType,
  viewport: Viewport
) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  if (background === 'blank') {
    ctx.restore();
    return;
  }

  const gridSize = 20 * viewport.scale;
  const offsetX = viewport.x % gridSize;
  const offsetY = viewport.y % gridSize;

  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;

  if (background === 'grid') {
    ctx.beginPath();
    for (let x = offsetX; x < width; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = offsetY; y < height; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  } else if (background === 'lines') {
    ctx.beginPath();
    for (let y = offsetY; y < height; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  } else if (background === 'dots') {
    ctx.fillStyle = '#d1d5db';
    for (let x = offsetX; x < width; x += gridSize) {
      for (let y = offsetY; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.restore();
}

// 渲染选择框
function renderSelection(
  ctx: CanvasRenderingContext2D,
  bounds: SelectionBounds | null,
  lassoPath: LassoPath | null,
  viewport: Viewport
) {
  ctx.save();
  ctx.translate(viewport.x, viewport.y);
  ctx.scale(viewport.scale, viewport.scale);

  // 套索路径
  if (lassoPath && lassoPath.points.length > 1) {
    ctx.beginPath();
    ctx.moveTo(lassoPath.points[0].x, lassoPath.points[0].y);
    for (let i = 1; i < lassoPath.points.length; i++) {
      ctx.lineTo(lassoPath.points[i].x, lassoPath.points[i].y);
    }
    if (lassoPath.closed) ctx.closePath();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2 / viewport.scale;
    ctx.setLineDash([5 / viewport.scale, 5 / viewport.scale]);
    ctx.stroke();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.fill();
  }

  // 选择边界框
  if (bounds) {
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2 / viewport.scale;
    ctx.setLineDash([]);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

    // 控制点
    const handleSize = 8 / viewport.scale;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5 / viewport.scale;

    const handles = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width / 2, y: bounds.y },
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height / 2 },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
    ];

    handles.forEach(h => {
      ctx.beginPath();
      ctx.arc(h.x, h.y, handleSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  ctx.restore();
}


export function HandwritingCanvas({
  className,
  width: propWidth,
  height: propHeight,
  enablePrediction = true,
}: HandwritingCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const contentCanvasRef = useRef<HTMLCanvasElement>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const palmRejectionRef = useRef(createPalmRejection());
  const gestureRecognizerRef = useRef(createGestureRecognizer());
  const rafRef = useRef<number | null>(null);
  
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [lassoPath, setLassoPath] = useState<LassoPath | null>(null);
  const [isLassoDrawing, setIsLassoDrawing] = useState(false);
  const [selectionBounds, setSelectionBounds] = useState<SelectionBounds | null>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const dragBoundsRef = useRef<SelectionBounds | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const {
    activeTool, brushColor, brushWidth, brushOpacity, brushType,
    eraserMode, eraserWidth, viewport, background, layers,
    activePoints, selectedStrokeIds,
    startStroke, addPoint, endStroke, cancelStroke,
    removeStroke, removeStrokes, updateStroke, setViewport, selectStrokes, clearSelection,
    getAllStrokes,
  } = useHandwritingStore();

  // 获取选中的笔画
  const selectedStrokes = useMemo(() => {
    const allStrokes = getAllStrokes();
    return allStrokes.filter(s => selectedStrokeIds.includes(s.id));
  }, [getAllStrokes, selectedStrokeIds]);

  // 更新选择边界
  useEffect(() => {
    if (selectedStrokes.length > 0) {
      setSelectionBounds(getSelectionBounds(selectedStrokes));
    } else {
      setSelectionBounds(null);
    }
  }, [selectedStrokes]);

  // 更新尺寸
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: propWidth || rect.width,
          height: propHeight || rect.height,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [propWidth, propHeight]);

  // 设置画布尺寸
  useEffect(() => {
    const canvases = [backgroundCanvasRef, contentCanvasRef, activeCanvasRef, selectionCanvasRef];
    canvases.forEach(ref => {
      if (ref.current) {
        ref.current.width = dimensions.width * dpr;
        ref.current.height = dimensions.height * dpr;
        ref.current.style.width = `${dimensions.width}px`;
        ref.current.style.height = `${dimensions.height}px`;
        const ctx = ref.current.getContext('2d');
        if (ctx) ctx.scale(dpr, dpr);
      }
    });
  }, [dimensions, dpr]);

  // 渲染背景
  useEffect(() => {
    const ctx = backgroundCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    renderBackground(ctx, dimensions.width, dimensions.height, background, viewport);
  }, [dimensions, background, viewport]);

  // 渲染内容 (使用 RAF 优化)
  useEffect(() => {
    const ctx = contentCanvasRef.current?.getContext('2d');
    if (!ctx) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    
    rafRef.current = requestAnimationFrame(() => {
      ctx.clearRect(0, 0, dimensions.width, dimensions.height);
      ctx.save();
      ctx.translate(viewport.x, viewport.y);
      ctx.scale(viewport.scale, viewport.scale);

      const strokes = getAllStrokes();
      
      // 高亮选中的笔画
      strokes.forEach(stroke => {
        if (selectedStrokeIds.includes(stroke.id)) {
          // 绘制高亮背景
          ctx.save();
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = '#3b82f6';
          stroke.points.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, stroke.width, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.restore();
        }
      });

      renderStrokes(ctx, strokes);
      ctx.restore();
    });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [dimensions, viewport, layers, selectedStrokeIds, getAllStrokes]);


  // 渲染活动笔画 (带预测)
  useEffect(() => {
    const ctx = activeCanvasRef.current?.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    if (activePoints.length > 0) {
      ctx.save();
      ctx.translate(viewport.x, viewport.y);
      ctx.scale(viewport.scale, viewport.scale);

      // 渲染实际笔画
      renderActiveStroke(ctx, activePoints, brushColor, brushWidth, brushOpacity, brushType);

      // 渲染预测笔画 (半透明)
      if (enablePrediction && activePoints.length >= 3) {
        const predicted = generatePredictedPoints(activePoints, 2);
        if (predicted.length > 0) {
          const allPoints = [...activePoints, ...predicted];
          ctx.globalAlpha = 0.4;
          renderActiveStroke(ctx, allPoints, brushColor, brushWidth, brushOpacity, brushType);
        }
      }

      ctx.restore();
    }
  }, [activePoints, viewport, brushColor, brushWidth, brushOpacity, brushType, enablePrediction, dimensions]);

  // 渲染选择层
  useEffect(() => {
    const ctx = selectionCanvasRef.current?.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, dimensions.width, dimensions.height);
    renderSelection(ctx, selectionBounds, lassoPath, viewport);
  }, [dimensions, viewport, selectionBounds, lassoPath]);

  // 屏幕坐标转画布坐标
  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (screenX - rect.left - viewport.x) / viewport.scale,
      y: (screenY - rect.top - viewport.y) / viewport.scale,
    };
  }, [viewport]);

  // 处理指针按下
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    
    const palmRejection = palmRejectionRef.current;
    if (!palmRejection.handlePointerDown(e.nativeEvent)) return;

    if (e.pointerType === 'touch') {
      gestureRecognizerRef.current.handlePointerDown(e.nativeEvent);
      return;
    }

    const { x, y } = screenToCanvas(e.clientX, e.clientY);

    // 绘制工具
    if (activeTool === 'pen' || activeTool === 'pencil' || activeTool === 'highlighter') {
      clearSelection();
      const point: StrokePoint = {
        x, y,
        pressure: e.pressure || 0.5,
        tiltX: e.tiltX,
        tiltY: e.tiltY,
        timestamp: Date.now(),
      };
      startStroke(point);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
    // 橡皮擦
    else if (activeTool === 'eraser') {
      clearSelection();
      if (eraserMode === 'stroke') {
        const strokes = getAllStrokes();
        for (const stroke of strokes) {
          if (isPointOnStroke(stroke, x, y, eraserWidth / 2)) {
            removeStroke(stroke.id);
            break;
          }
        }
      }
    }
    // 套索选择
    else if (activeTool === 'select') {
      // 检查是否点击了选择框内
      if (selectionBounds && 
          x >= selectionBounds.x && x <= selectionBounds.x + selectionBounds.width &&
          y >= selectionBounds.y && y <= selectionBounds.y + selectionBounds.height) {
        setIsDraggingSelection(true);
        dragOriginRef.current = { x, y };
        dragBoundsRef.current = selectionBounds;
        dragOffsetRef.current = { x: 0, y: 0 };
      } else {
        // 开始新的套索选择
        clearSelection();
        setIsLassoDrawing(true);
        setLassoPath({ points: [{ x, y }], closed: false });
      }
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
    // 平移
    else if (activeTool === 'pan') {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }, [activeTool, eraserMode, eraserWidth, selectionBounds, screenToCanvas, startStroke, clearSelection, getAllStrokes, removeStroke]);


  // 处理指针移动
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const palmRejection = palmRejectionRef.current;
    if (!palmRejection.handlePointerMove(e.nativeEvent)) return;

    if (e.pointerType === 'touch') {
      gestureRecognizerRef.current.handlePointerMove(e.nativeEvent);
      return;
    }

    const { x, y } = screenToCanvas(e.clientX, e.clientY);

    // 绘制
    if ((activeTool === 'pen' || activeTool === 'pencil' || activeTool === 'highlighter') && activePoints.length > 0) {
      const point: StrokePoint = {
        x, y,
        pressure: e.pressure || 0.5,
        tiltX: e.tiltX,
        tiltY: e.tiltY,
        timestamp: Date.now(),
      };
      addPoint(point);
    }
    // 橡皮擦拖动
    else if (activeTool === 'eraser' && e.buttons > 0) {
      if (eraserMode === 'stroke') {
        const strokes = getAllStrokes();
        for (const stroke of strokes) {
          if (isPointOnStroke(stroke, x, y, eraserWidth / 2)) {
            removeStroke(stroke.id);
          }
        }
      }
    }
    // 套索绘制
    else if (activeTool === 'select' && isLassoDrawing && lassoPath) {
      setLassoPath({
        ...lassoPath,
        points: [...lassoPath.points, { x, y }],
      });
    }
    // 拖动选择
    else if (activeTool === 'select' && isDraggingSelection && dragOriginRef.current && selectedStrokes.length > 0) {
      const dx = x - dragOriginRef.current.x;
      const dy = y - dragOriginRef.current.y;
      dragOffsetRef.current = { x: dx, y: dy };
      
      // 更新选择边界预览
      if (dragBoundsRef.current) {
        setSelectionBounds({
          ...dragBoundsRef.current,
          x: dragBoundsRef.current.x + dx,
          y: dragBoundsRef.current.y + dy,
        });
      }
    }
    // 平移
    else if (activeTool === 'pan' && e.buttons > 0) {
      setViewport({
        ...viewport,
        x: viewport.x + e.movementX,
        y: viewport.y + e.movementY,
      });
    }
  }, [activeTool, activePoints, eraserMode, eraserWidth, isLassoDrawing, lassoPath, isDraggingSelection, selectedStrokes, viewport, screenToCanvas, addPoint, getAllStrokes, removeStroke, setViewport]);

  // 处理指针抬起
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    palmRejectionRef.current.handlePointerUp(e.nativeEvent);

    if (e.pointerType === 'touch') {
      gestureRecognizerRef.current.handlePointerUp(e.nativeEvent);
      return;
    }

    // 完成绘制
    if ((activeTool === 'pen' || activeTool === 'pencil' || activeTool === 'highlighter') && activePoints.length > 0) {
      endStroke();
    }
    // 完成套索选择
    else if (activeTool === 'select' && isLassoDrawing && lassoPath) {
      const closedPath: LassoPath = { ...lassoPath, closed: true };
      
      // 找出选中的笔画
      const strokes = getAllStrokes();
      const selected = strokes.filter(s => isStrokeInSelection(s, closedPath));
      
      if (selected.length > 0) {
        selectStrokes(selected.map(s => s.id));
      }
      
      setIsLassoDrawing(false);
      setLassoPath(null);
    }
    // 完成拖动
    else if (activeTool === 'select' && isDraggingSelection) {
      setIsDraggingSelection(false);
      const dx = dragOffsetRef.current.x;
      const dy = dragOffsetRef.current.y;

      if (selectedStrokes.length > 0 && (dx !== 0 || dy !== 0)) {
        selectedStrokes.forEach((stroke) => {
          const movedPoints = stroke.points.map((point) => ({
            ...point,
            x: point.x + dx,
            y: point.y + dy,
          }));
          updateStroke(stroke.id, { points: movedPoints });
        });
      }

      if (dragBoundsRef.current) {
        setSelectionBounds({
          ...dragBoundsRef.current,
          x: dragBoundsRef.current.x + dx,
          y: dragBoundsRef.current.y + dy,
        });
      }

      dragOriginRef.current = null;
      dragBoundsRef.current = null;
      dragOffsetRef.current = { x: 0, y: 0 };
    }

    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, [activeTool, activePoints, isLassoDrawing, lassoPath, isDraggingSelection, endStroke, getAllStrokes, selectStrokes, selectedStrokes, updateStroke]);

  // 处理指针取消
  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    palmRejectionRef.current.handlePointerCancel(e.nativeEvent);
    cancelStroke();
    setIsLassoDrawing(false);
    setLassoPath(null);
    setIsDraggingSelection(false);
    dragOriginRef.current = null;
    dragBoundsRef.current = null;
    dragOffsetRef.current = { x: 0, y: 0 };
  }, [cancelStroke]);


  // 手势回调
  useEffect(() => {
    const gestureRecognizer = gestureRecognizerRef.current;

    gestureRecognizer.on('pinch', (event) => {
      if (event.scale) {
        const newScale = Math.max(0.25, Math.min(4, viewport.scale * event.scale));
        const scaleRatio = newScale / viewport.scale;
        setViewport({
          x: event.center.x - (event.center.x - viewport.x) * scaleRatio,
          y: event.center.y - (event.center.y - viewport.y) * scaleRatio,
          scale: newScale,
        });
      }
    });

    gestureRecognizer.on('two-finger-pan', (event) => {
      if (event.velocity) {
        setViewport({
          ...viewport,
          x: viewport.x + event.velocity.x,
          y: viewport.y + event.velocity.y,
        });
      }
    });

    gestureRecognizer.on('double-tap', () => {
      setViewport({ x: 0, y: 0, scale: 1 });
    });

    return () => gestureRecognizer.destroy();
  }, [viewport, setViewport]);

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      const newScale = Math.max(0.25, Math.min(4, viewport.scale * (1 + delta)));
      const scaleRatio = newScale / viewport.scale;

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const centerX = e.clientX - rect.left;
        const centerY = e.clientY - rect.top;
        setViewport({
          x: centerX - (centerX - viewport.x) * scaleRatio,
          y: centerY - (centerY - viewport.y) * scaleRatio,
          scale: newScale,
        });
      }
    }
  }, [viewport, setViewport]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete 删除选中
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedStrokeIds.length > 0) {
        e.preventDefault();
        removeStrokes(selectedStrokeIds);
        clearSelection();
      }
      // Escape 取消选择
      if (e.key === 'Escape') {
        clearSelection();
        setLassoPath(null);
        setIsLassoDrawing(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedStrokeIds, removeStrokes, clearSelection]);

  // 光标样式
  const cursorStyle = useMemo(() => {
    switch (activeTool) {
      case 'pen':
      case 'pencil':
      case 'highlighter':
        return 'crosshair';
      case 'eraser':
        return 'cell';
      case 'select':
        return isDraggingSelection ? 'grabbing' : 'default';
      case 'pan':
        return 'grab';
      default:
        return 'default';
    }
  }, [activeTool, isDraggingSelection]);

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full h-full overflow-hidden touch-none select-none', className)}
      style={{ cursor: cursorStyle }}
      onWheel={handleWheel}
    >
      <canvas ref={backgroundCanvasRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }} />
      <canvas ref={contentCanvasRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }} />
      <canvas ref={activeCanvasRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 3 }} />
      <canvas ref={selectionCanvasRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 4 }} />
      
      {/* 输入层 */}
      <div
        className="absolute inset-0"
        style={{ zIndex: 5, touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerUp}
      />
    </div>
  );
}

export default HandwritingCanvas;

