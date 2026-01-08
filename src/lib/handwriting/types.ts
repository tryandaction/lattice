/**
 * Handwriting Engine Types
 * 手写引擎类型定义
 */

// 单个点的数据
export interface StrokePoint {
  x: number;           // X 坐标
  y: number;           // Y 坐标
  pressure: number;    // 压力值 (0-1)
  tiltX?: number;      // X 轴倾斜角度
  tiltY?: number;      // Y 轴倾斜角度
  timestamp: number;   // 时间戳
}

// 笔刷类型
export type BrushType = 'pen' | 'pencil' | 'highlighter' | 'brush';

// 完整笔画
export interface Stroke {
  id: string;                    // 唯一标识
  points: StrokePoint[];         // 点集合
  color: string;                 // 颜色 (hex)
  width: number;                 // 基础宽度
  opacity: number;               // 透明度 (0-1)
  brushType: BrushType;          // 笔刷类型
  createdAt: number;             // 创建时间
  layerId: string;               // 所属图层
}

// 图层
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  strokes: Stroke[];
}

// 背景类型
export type BackgroundType = 'blank' | 'grid' | 'lines' | 'dots';

// 页面尺寸
export interface PageSize {
  width: number;
  height: number;
  infinite?: boolean;
}

// 手写笔记文档
export interface HandwritingDocument {
  id: string;
  version: number;
  layers: Layer[];
  background: BackgroundType;
  pageSize: PageSize;
  createdAt: number;
  updatedAt: number;
}


// 视口状态
export interface Viewport {
  x: number;      // 视口 X 偏移
  y: number;      // 视口 Y 偏移
  scale: number;  // 缩放比例
}

// 工具类型
export type ToolType = 'pen' | 'pencil' | 'highlighter' | 'eraser' | 'select' | 'pan';

// 橡皮擦模式
export type EraserMode = 'stroke' | 'point';

// 选择状态
export interface SelectionState {
  selectedIds: string[];
  bounds: { x: number; y: number; width: number; height: number } | null;
  isTransforming: boolean;
}

// 历史记录项
export interface HistoryEntry {
  type: 'add' | 'remove' | 'update' | 'batch';
  strokes: Stroke[];
  previousStrokes?: Stroke[];
  timestamp: number;
}

// 手势类型
export type GestureType = 
  | 'tap'           // 单击
  | 'double-tap'    // 双击
  | 'long-press'    // 长按
  | 'pan'           // 单指拖动
  | 'pinch'         // 双指缩放
  | 'rotate'        // 双指旋转
  | 'two-finger-pan'; // 双指平移

// 手势事件
export interface GestureEvent {
  type: GestureType;
  center: { x: number; y: number };
  scale?: number;      // 缩放比例
  rotation?: number;   // 旋转角度
  velocity?: { x: number; y: number };
  pointerCount: number;
}

// 指针状态
export interface PointerState {
  pointerId: number;
  pointerType: 'pen' | 'touch' | 'mouse';
  isPrimary: boolean;
  x: number;
  y: number;
  pressure: number;
  timestamp: number;
}

// 笔刷预设
export interface BrushPreset {
  id: string;
  name: string;
  type: BrushType;
  color: string;
  width: number;
  opacity: number;
}

// 预设颜色
export const PRESET_COLORS = [
  '#000000', // 黑色
  '#FFFFFF', // 白色
  '#FF0000', // 红色
  '#FF9800', // 橙色
  '#FFEB3B', // 黄色
  '#4CAF50', // 绿色
  '#2196F3', // 蓝色
  '#9C27B0', // 紫色
  '#E91E63', // 粉色
  '#795548', // 棕色
] as const;

// 预设宽度
export const PRESET_WIDTHS = [1, 2, 4, 8, 12, 16, 24, 32] as const;

// 默认笔刷设置
export const DEFAULT_BRUSH_SETTINGS = {
  pen: { width: 4, opacity: 1 },
  pencil: { width: 2, opacity: 0.8 },
  highlighter: { width: 24, opacity: 0.4 },
  brush: { width: 8, opacity: 1 },
} as const;

