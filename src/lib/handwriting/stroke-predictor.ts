/**
 * Stroke Predictor - 笔迹预测算法
 * 减少绘制延迟，提升书写流畅度
 */

import type { StrokePoint } from './types';

interface PredictionConfig {
  lookAhead: number;      // 预测帧数
  smoothing: number;      // 平滑系数 0-1
  minPoints: number;      // 最少需要的点数
  maxPredictDistance: number; // 最大预测距离
}

const DEFAULT_CONFIG: PredictionConfig = {
  lookAhead: 2,
  smoothing: 0.3,
  minPoints: 3,
  maxPredictDistance: 50,
};

/**
 * 基于速度和加速度预测下一个点
 */
export function predictNextPoint(
  points: StrokePoint[],
  config: Partial<PredictionConfig> = {}
): StrokePoint | null {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  if (points.length < cfg.minPoints) return null;
  
  const len = points.length;
  const p1 = points[len - 3];
  const p2 = points[len - 2];
  const p3 = points[len - 1];
  
  // 时间差
  const dt1 = Math.max(1, p2.timestamp - p1.timestamp);
  const dt2 = Math.max(1, p3.timestamp - p2.timestamp);
  
  // 速度
  const v1x = (p2.x - p1.x) / dt1;
  const v1y = (p2.y - p1.y) / dt1;
  const v2x = (p3.x - p2.x) / dt2;
  const v2y = (p3.y - p2.y) / dt2;
  
  // 加速度
  const ax = (v2x - v1x) / ((dt1 + dt2) / 2);
  const ay = (v2y - v1y) / ((dt1 + dt2) / 2);
  
  // 预测时间 (假设 16ms 一帧)
  const predictTime = 16 * cfg.lookAhead;
  
  // 预测位置
  let predictedX = p3.x + v2x * predictTime + 0.5 * ax * predictTime * predictTime;
  let predictedY = p3.y + v2y * predictTime + 0.5 * ay * predictTime * predictTime;
  
  // 限制预测距离
  const dx = predictedX - p3.x;
  const dy = predictedY - p3.y;
  const dist = Math.hypot(dx, dy);
  
  if (dist > cfg.maxPredictDistance) {
    const scale = cfg.maxPredictDistance / dist;
    predictedX = p3.x + dx * scale;
    predictedY = p3.y + dy * scale;
  }
  
  // 平滑处理
  predictedX = p3.x + (predictedX - p3.x) * cfg.smoothing;
  predictedY = p3.y + (predictedY - p3.y) * cfg.smoothing;
  
  // 压力预测 (简单线性)
  const pressureDelta = p3.pressure - p2.pressure;
  const predictedPressure = Math.max(0, Math.min(1, p3.pressure + pressureDelta * 0.5));
  
  return {
    x: predictedX,
    y: predictedY,
    pressure: predictedPressure,
    tiltX: p3.tiltX,
    tiltY: p3.tiltY,
    timestamp: p3.timestamp + predictTime,
  };
}

/**
 * 生成预测点序列
 */
export function generatePredictedPoints(
  points: StrokePoint[],
  count: number = 2
): StrokePoint[] {
  const predicted: StrokePoint[] = [];
  let currentPoints = [...points];
  
  for (let i = 0; i < count; i++) {
    const next = predictNextPoint(currentPoints);
    if (next) {
      predicted.push(next);
      currentPoints = [...currentPoints, next];
    } else {
      break;
    }
  }
  
  return predicted;
}

