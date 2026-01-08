/**
 * Gesture Recognizer
 * 手势识别器 - 识别双指缩放、平移等手势
 */

import type { GestureEvent, GestureType } from './types';

interface GestureConfig {
  doubleTapDelay: number;
  longPressDelay: number;
  pinchThreshold: number;
  panThreshold: number;
}

const DEFAULT_CONFIG: GestureConfig = {
  doubleTapDelay: 300,
  longPressDelay: 500,
  pinchThreshold: 10,
  panThreshold: 5,
};

interface PointerData {
  id: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  timestamp: number;
}

type GestureCallback = (event: GestureEvent) => void;

/**
 * 手势识别器
 */
export class GestureRecognizer {
  private config: GestureConfig;
  private pointers: Map<number, PointerData> = new Map();
  private lastTapTime: number = 0;
  private lastTapPosition: { x: number; y: number } | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private initialDistance: number = 0;
  private initialAngle: number = 0;
  private callbacks: Map<GestureType, GestureCallback[]> = new Map();

  constructor(config: Partial<GestureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注册手势回调
   */
  on(type: GestureType, callback: GestureCallback): void {
    if (!this.callbacks.has(type)) {
      this.callbacks.set(type, []);
    }
    this.callbacks.get(type)!.push(callback);
  }

  /**
   * 移除手势回调
   */
  off(type: GestureType, callback: GestureCallback): void {
    const callbacks = this.callbacks.get(type);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * 触发手势事件
   */
  private emit(event: GestureEvent): void {
    const callbacks = this.callbacks.get(event.type);
    if (callbacks) {
      callbacks.forEach(cb => cb(event));
    }
  }


  /**
   * 处理指针按下
   */
  handlePointerDown(event: PointerEvent): void {
    const data: PointerData = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      timestamp: Date.now(),
    };

    this.pointers.set(event.pointerId, data);

    // 单指时检测长按
    if (this.pointers.size === 1) {
      this.longPressTimer = setTimeout(() => {
        if (this.pointers.size === 1) {
          const pointer = Array.from(this.pointers.values())[0];
          // 检查是否移动过
          const moved = Math.hypot(
            pointer.currentX - pointer.startX,
            pointer.currentY - pointer.startY
          );
          if (moved < this.config.panThreshold) {
            this.emit({
              type: 'long-press',
              center: { x: pointer.currentX, y: pointer.currentY },
              pointerCount: 1,
            });
          }
        }
      }, this.config.longPressDelay);
    }

    // 双指时记录初始距离和角度
    if (this.pointers.size === 2) {
      this.cancelLongPress();
      const points = Array.from(this.pointers.values());
      this.initialDistance = this.getDistance(points[0], points[1]);
      this.initialAngle = this.getAngle(points[0], points[1]);
    }
  }

  /**
   * 处理指针移动
   */
  handlePointerMove(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;

    pointer.currentX = event.clientX;
    pointer.currentY = event.clientY;

    // 移动时取消长按检测
    const moved = Math.hypot(
      pointer.currentX - pointer.startX,
      pointer.currentY - pointer.startY
    );
    if (moved > this.config.panThreshold) {
      this.cancelLongPress();
    }

    // 双指手势
    if (this.pointers.size === 2) {
      this.detectPinchAndPan();
    } else if (this.pointers.size === 1) {
      // 单指平移
      this.emit({
        type: 'pan',
        center: { x: pointer.currentX, y: pointer.currentY },
        velocity: {
          x: pointer.currentX - pointer.startX,
          y: pointer.currentY - pointer.startY,
        },
        pointerCount: 1,
      });
    }
  }

  /**
   * 处理指针抬起
   */
  handlePointerUp(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    this.cancelLongPress();

    if (!pointer) return;

    // 检测点击和双击
    if (this.pointers.size === 0) {
      const moved = Math.hypot(
        pointer.currentX - pointer.startX,
        pointer.currentY - pointer.startY
      );

      if (moved < this.config.panThreshold) {
        const now = Date.now();
        const position = { x: pointer.currentX, y: pointer.currentY };

        // 检测双击
        if (
          this.lastTapPosition &&
          now - this.lastTapTime < this.config.doubleTapDelay &&
          Math.hypot(
            position.x - this.lastTapPosition.x,
            position.y - this.lastTapPosition.y
          ) < 30
        ) {
          this.emit({
            type: 'double-tap',
            center: position,
            pointerCount: 1,
          });
          this.lastTapTime = 0;
          this.lastTapPosition = null;
        } else {
          // 单击
          this.emit({
            type: 'tap',
            center: position,
            pointerCount: 1,
          });
          this.lastTapTime = now;
          this.lastTapPosition = position;
        }
      }
    }
  }


  /**
   * 检测双指缩放和平移
   */
  private detectPinchAndPan(): void {
    const points = Array.from(this.pointers.values());
    if (points.length !== 2) return;

    const [p1, p2] = points;
    const currentDistance = this.getDistance(p1, p2);
    const currentAngle = this.getAngle(p1, p2);
    const center = this.getCenter(p1, p2);

    const scale = currentDistance / this.initialDistance;
    const rotation = currentAngle - this.initialAngle;

    // 缩放手势
    if (Math.abs(scale - 1) > 0.01) {
      this.emit({
        type: 'pinch',
        center,
        scale,
        rotation,
        pointerCount: 2,
      });
    }

    // 双指平移
    const avgDeltaX = (p1.currentX - p1.startX + p2.currentX - p2.startX) / 2;
    const avgDeltaY = (p1.currentY - p1.startY + p2.currentY - p2.startY) / 2;

    if (Math.hypot(avgDeltaX, avgDeltaY) > this.config.panThreshold) {
      this.emit({
        type: 'two-finger-pan',
        center,
        velocity: { x: avgDeltaX, y: avgDeltaY },
        pointerCount: 2,
      });
    }
  }

  /**
   * 计算两点之间的距离
   */
  private getDistance(p1: PointerData, p2: PointerData): number {
    return Math.hypot(p2.currentX - p1.currentX, p2.currentY - p1.currentY);
  }

  /**
   * 计算两点之间的角度
   */
  private getAngle(p1: PointerData, p2: PointerData): number {
    return Math.atan2(p2.currentY - p1.currentY, p2.currentX - p1.currentX);
  }

  /**
   * 计算两点的中心
   */
  private getCenter(p1: PointerData, p2: PointerData): { x: number; y: number } {
    return {
      x: (p1.currentX + p2.currentX) / 2,
      y: (p1.currentY + p2.currentY) / 2,
    };
  }

  /**
   * 取消长按检测
   */
  private cancelLongPress(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.pointers.clear();
    this.cancelLongPress();
    this.lastTapTime = 0;
    this.lastTapPosition = null;
    this.initialDistance = 0;
    this.initialAngle = 0;
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.reset();
    this.callbacks.clear();
  }
}

/**
 * 创建手势识别器实例
 */
export function createGestureRecognizer(
  config?: Partial<GestureConfig>
): GestureRecognizer {
  return new GestureRecognizer(config);
}

