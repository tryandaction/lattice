/**
 * Handwriting Engine
 * 手写引擎模块导出
 */

// 类型导出
export * from './types';

// 笔画渲染
export {
  getStrokeOutline,
  getStrokePath,
  renderStroke,
  renderStrokes,
  renderActiveStroke,
  getStrokeBounds,
  isPointOnStroke,
} from './stroke-renderer';

// 手掌拒绝
export {
  PalmRejectionSystem,
  createPalmRejection,
  type InputMode,
} from './palm-rejection';

// 手势识别
export {
  GestureRecognizer,
  createGestureRecognizer,
} from './gesture-recognizer';

// 笔迹预测
export {
  predictNextPoint,
  generatePredictedPoints,
} from './stroke-predictor';

// 套索选择
export {
  isStrokeInSelection,
  getSelectionBounds,
  transformStrokes,
  duplicateStrokes,
  type SelectionBounds,
  type LassoPath,
} from './lasso-selection';

