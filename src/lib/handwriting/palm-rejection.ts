/**
 * Palm Rejection System
 * 手掌拒绝系统 - 自动识别并忽略手掌触摸
 */

import type { PointerState } from './types';

export type InputMode = 'auto' | 'pen-only' | 'touch-only' | 'all';

interface PalmRejectionConfig {
  mode: InputMode;
  palmAreaThreshold: number;  // 手掌接触面积阈值
  palmPressureThreshold: number;  // 手掌压力阈值
  penCooldownMs: number;  // 笔抬起后忽略触摸的时间
}

const DEFAULT_CONFIG: PalmRejectionConfig = {
  mode: 'auto',
  palmAreaThreshold: 400,  // 平方像素
  palmPressureThreshold: 0.8,
  penCooldownMs: 100,
};

/**
 * 手掌拒绝系统
 */
export class PalmRejectionSystem {
  private config: PalmRejectionConfig;
  private activePointers: Map<number, PointerState> = new Map();
  private penActive: boolean = false;
  private lastPenUpTime: number = 0;

  constructor(config: Partial<PalmRejectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置输入模式
   */
  setMode(mode: InputMode): void {
    this.config.mode = mode;
  }

  /**
   * 获取当前模式
   */
  getMode(): InputMode {
    return this.config.mode;
  }

  /**
   * 处理指针按下事件
   */
  handlePointerDown(event: PointerEvent): boolean {
    const state: PointerState = {
      pointerId: event.pointerId,
      pointerType: event.pointerType as 'pen' | 'touch' | 'mouse',
      isPrimary: event.isPrimary,
      x: event.clientX,
      y: event.clientY,
      pressure: event.pressure,
      timestamp: Date.now(),
    };

    this.activePointers.set(event.pointerId, state);

    // 如果是笔，标记笔活跃
    if (event.pointerType === 'pen') {
      this.penActive = true;
    }

    return this.shouldAcceptInput(event);
  }


  /**
   * 处理指针移动事件
   */
  handlePointerMove(event: PointerEvent): boolean {
    if (!this.activePointers.has(event.pointerId)) {
      return false;
    }

    const state = this.activePointers.get(event.pointerId)!;
    state.x = event.clientX;
    state.y = event.clientY;
    state.pressure = event.pressure;
    state.timestamp = Date.now();

    return this.shouldAcceptInput(event);
  }

  /**
   * 处理指针抬起事件
   */
  handlePointerUp(event: PointerEvent): void {
    this.activePointers.delete(event.pointerId);

    // 检查是否还有笔活跃
    if (event.pointerType === 'pen') {
      const hasPen = Array.from(this.activePointers.values())
        .some(p => p.pointerType === 'pen');
      
      if (!hasPen) {
        this.penActive = false;
        this.lastPenUpTime = Date.now();
      }
    }
  }

  /**
   * 处理指针取消事件
   */
  handlePointerCancel(event: PointerEvent): void {
    this.handlePointerUp(event);
  }

  /**
   * 判断是否应该接受输入
   */
  shouldAcceptInput(event: PointerEvent): boolean {
    const pointerType = event.pointerType as 'pen' | 'touch' | 'mouse';

    switch (this.config.mode) {
      case 'pen-only':
        return pointerType === 'pen';

      case 'touch-only':
        return pointerType === 'touch';

      case 'all':
        return true;

      case 'auto':
      default:
        return this.autoModeCheck(event);
    }
  }

  /**
   * 自动模式检查
   */
  private autoModeCheck(event: PointerEvent): boolean {
    const pointerType = event.pointerType as 'pen' | 'touch' | 'mouse';

    // 鼠标总是接受
    if (pointerType === 'mouse') {
      return true;
    }

    // 笔总是接受
    if (pointerType === 'pen') {
      return true;
    }

    // 触摸检查
    if (pointerType === 'touch') {
      // 如果笔正在使用，拒绝触摸
      if (this.penActive) {
        return false;
      }

      // 如果笔刚抬起，在冷却期内拒绝触摸
      const timeSincePenUp = Date.now() - this.lastPenUpTime;
      if (timeSincePenUp < this.config.penCooldownMs) {
        return false;
      }

      // 检查是否可能是手掌
      if (this.isPalmTouch(event)) {
        return false;
      }

      return true;
    }

    return true;
  }


  /**
   * 检查是否可能是手掌触摸
   */
  private isPalmTouch(event: PointerEvent): boolean {
    // 检查接触面积（如果可用）
    if (event.width && event.height) {
      const area = event.width * event.height;
      if (area > this.config.palmAreaThreshold) {
        return true;
      }
    }

    // 检查压力（手掌压力通常较大且均匀）
    if (event.pressure > this.config.palmPressureThreshold) {
      return true;
    }

    return false;
  }

  /**
   * 检查是否有笔正在使用
   */
  isPenActive(): boolean {
    return this.penActive;
  }

  /**
   * 获取活跃的指针数量
   */
  getActivePointerCount(): number {
    return this.activePointers.size;
  }

  /**
   * 获取活跃的笔指针
   */
  getActivePenPointer(): PointerState | null {
    for (const pointer of this.activePointers.values()) {
      if (pointer.pointerType === 'pen') {
        return pointer;
      }
    }
    return null;
  }

  /**
   * 清除所有状态
   */
  reset(): void {
    this.activePointers.clear();
    this.penActive = false;
    this.lastPenUpTime = 0;
  }
}

/**
 * 创建手掌拒绝系统实例
 */
export function createPalmRejection(
  config?: Partial<PalmRejectionConfig>
): PalmRejectionSystem {
  return new PalmRejectionSystem(config);
}

