/**
 * Lasso Selection - 套索选择工具
 * 支持自由绘制选区和框选
 */

import type { Stroke } from './types';

export interface SelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LassoPath {
  points: { x: number; y: number }[];
  closed: boolean;
}

/**
 * 检查点是否在多边形内 (射线法)
 */
function isPointInPolygon(
  x: number,
  y: number,
  polygon: { x: number; y: number }[]
): boolean {
  if (polygon.length < 3) return false;
  
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * 检查点是否在矩形内
 */
function isPointInRect(
  x: number,
  y: number,
  rect: SelectionBounds
): boolean {
  return x >= rect.x && x <= rect.x + rect.width &&
         y >= rect.y && y <= rect.y + rect.height;
}

/**
 * 检查笔画是否与选区相交
 */
export function isStrokeInSelection(
  stroke: Stroke,
  selection: LassoPath | SelectionBounds,
  threshold: number = 0.3 // 至少 30% 的点在选区内
): boolean {
  if (stroke.points.length === 0) return false;
  
  let pointsInside = 0;
  
  for (const point of stroke.points) {
    const inside = 'points' in selection
      ? isPointInPolygon(point.x, point.y, selection.points)
      : isPointInRect(point.x, point.y, selection);
    
    if (inside) pointsInside++;
  }
  
  return pointsInside / stroke.points.length >= threshold;
}

/**
 * 获取选中笔画的边界框
 */
export function getSelectionBounds(strokes: Stroke[]): SelectionBounds | null {
  if (strokes.length === 0) return null;
  
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  
  // 添加笔画宽度的 padding
  const maxWidth = Math.max(...strokes.map(s => s.width));
  const padding = maxWidth / 2;
  
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + maxWidth,
    height: maxY - minY + maxWidth,
  };
}

/**
 * 变换选中的笔画
 */
export function transformStrokes(
  strokes: Stroke[],
  transform: {
    translateX?: number;
    translateY?: number;
    scale?: number;
    rotate?: number; // 弧度
    originX?: number;
    originY?: number;
  }
): Stroke[] {
  const {
    translateX = 0,
    translateY = 0,
    scale = 1,
    rotate = 0,
    originX = 0,
    originY = 0,
  } = transform;
  
  const cos = Math.cos(rotate);
  const sin = Math.sin(rotate);
  
  return strokes.map(stroke => ({
    ...stroke,
    points: stroke.points.map(point => {
      // 移动到原点
      let x = point.x - originX;
      let y = point.y - originY;
      
      // 缩放
      x *= scale;
      y *= scale;
      
      // 旋转
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      
      // 移回并平移
      return {
        ...point,
        x: rx + originX + translateX,
        y: ry + originY + translateY,
      };
    }),
    width: stroke.width * scale,
  }));
}

/**
 * 复制笔画 (生成新 ID)
 */
export function duplicateStrokes(
  strokes: Stroke[],
  offset: { x: number; y: number } = { x: 20, y: 20 }
): Stroke[] {
  return strokes.map(stroke => ({
    ...stroke,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    points: stroke.points.map(p => ({
      ...p,
      x: p.x + offset.x,
      y: p.y + offset.y,
    })),
    createdAt: Date.now(),
  }));
}

