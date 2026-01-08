/**
 * Stroke Renderer
 * 笔画渲染器 - 使用 perfect-freehand 算法
 */

import getStroke from 'perfect-freehand';
import type { Stroke, StrokePoint, BrushType } from './types';

// 笔刷配置
interface BrushOptions {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  simulatePressure: boolean;
  start: { taper: number; cap: boolean };
  end: { taper: number; cap: boolean };
}

// 不同笔刷类型的配置
const BRUSH_CONFIGS: Record<BrushType, Partial<BrushOptions>> = {
  pen: {
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
  },
  pencil: {
    thinning: 0.6,
    smoothing: 0.3,
    streamline: 0.3,
    start: { taper: 10, cap: false },
    end: { taper: 10, cap: false },
  },
  highlighter: {
    thinning: 0,
    smoothing: 0.8,
    streamline: 0.8,
    start: { taper: 0, cap: false },
    end: { taper: 0, cap: false },
  },
  brush: {
    thinning: 0.7,
    smoothing: 0.6,
    streamline: 0.4,
    start: { taper: 20, cap: true },
    end: { taper: 20, cap: true },
  },
};


/**
 * 将 perfect-freehand 输出转换为 SVG 路径
 */
function getSvgPathFromStroke(points: number[][]): string {
  if (!points.length) return '';

  const d: string[] = [];
  const [first, ...rest] = points;

  d.push(`M ${first[0].toFixed(2)} ${first[1].toFixed(2)}`);

  if (rest.length === 0) {
    // 单点，画一个小圆
    d.push(`L ${first[0].toFixed(2)} ${first[1].toFixed(2)}`);
  } else if (rest.length === 1) {
    // 两点，直线
    d.push(`L ${rest[0][0].toFixed(2)} ${rest[0][1].toFixed(2)}`);
  } else {
    // 多点，使用二次贝塞尔曲线
    for (let i = 0; i < rest.length - 1; i++) {
      const [x0, y0] = rest[i];
      const [x1, y1] = rest[i + 1];
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      d.push(`Q ${x0.toFixed(2)} ${y0.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`);
    }
    // 最后一个点
    const last = rest[rest.length - 1];
    d.push(`L ${last[0].toFixed(2)} ${last[1].toFixed(2)}`);
  }

  d.push('Z');
  return d.join(' ');
}

/**
 * 获取笔画的轮廓点
 */
export function getStrokeOutline(
  points: StrokePoint[],
  width: number,
  brushType: BrushType
): number[][] {
  const inputPoints = points.map(p => [p.x, p.y, p.pressure]);
  const config = BRUSH_CONFIGS[brushType];

  return getStroke(inputPoints, {
    size: width,
    thinning: config.thinning ?? 0.5,
    smoothing: config.smoothing ?? 0.5,
    streamline: config.streamline ?? 0.5,
    simulatePressure: false,
    start: config.start ?? { taper: 0, cap: true },
    end: config.end ?? { taper: 0, cap: true },
  });
}

/**
 * 获取笔画的 SVG 路径
 */
export function getStrokePath(stroke: Stroke): string {
  const outline = getStrokeOutline(stroke.points, stroke.width, stroke.brushType);
  return getSvgPathFromStroke(outline);
}


/**
 * 在 Canvas 上渲染单个笔画
 */
export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke
): void {
  if (stroke.points.length === 0) return;

  const path = getStrokePath(stroke);
  const path2d = new Path2D(path);

  ctx.save();
  ctx.fillStyle = stroke.color;
  ctx.globalAlpha = stroke.opacity;

  // 荧光笔使用混合模式
  if (stroke.brushType === 'highlighter') {
    ctx.globalCompositeOperation = 'multiply';
  }

  ctx.fill(path2d);
  ctx.restore();
}

/**
 * 在 Canvas 上渲染多个笔画
 */
export function renderStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[]
): void {
  strokes.forEach(stroke => renderStroke(ctx, stroke));
}

/**
 * 渲染正在绘制的笔画（实时预览）
 */
export function renderActiveStroke(
  ctx: CanvasRenderingContext2D,
  points: StrokePoint[],
  color: string,
  width: number,
  opacity: number,
  brushType: BrushType
): void {
  if (points.length === 0) return;

  const outline = getStrokeOutline(points, width, brushType);
  const path = getSvgPathFromStroke(outline);
  const path2d = new Path2D(path);

  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;

  if (brushType === 'highlighter') {
    ctx.globalCompositeOperation = 'multiply';
  }

  ctx.fill(path2d);
  ctx.restore();
}

/**
 * 获取笔画的边界框
 */
export function getStrokeBounds(stroke: Stroke): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (stroke.points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  stroke.points.forEach(point => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  // 考虑笔画宽度
  const padding = stroke.width / 2;
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + stroke.width,
    height: maxY - minY + stroke.width,
  };
}

/**
 * 检查点是否在笔画上
 */
export function isPointOnStroke(
  stroke: Stroke,
  x: number,
  y: number,
  tolerance: number = 10
): boolean {
  const threshold = stroke.width / 2 + tolerance;

  for (const point of stroke.points) {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= threshold) {
      return true;
    }
  }

  return false;
}

