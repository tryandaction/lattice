/**
 * Handwriting Store
 * 手写编辑器状态管理
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  Stroke,
  StrokePoint,
  Layer,
  ToolType,
  BrushType,
  Viewport,
  BackgroundType,
  HistoryEntry,
  EraserMode,
} from '@/lib/handwriting/types';
import { DEFAULT_BRUSH_SETTINGS } from '@/lib/handwriting/types';

// 生成唯一 ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

interface HandwritingState {
  // 当前工具
  activeTool: ToolType;
  
  // 笔刷设置
  brushType: BrushType;
  brushColor: string;
  brushWidth: number;
  brushOpacity: number;
  
  // 橡皮擦设置
  eraserMode: EraserMode;
  eraserWidth: number;
  
  // 图层
  layers: Layer[];
  activeLayerId: string;
  
  // 视口
  viewport: Viewport;
  
  // 背景
  background: BackgroundType;
  
  // 历史记录
  history: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;
  
  // 选择状态
  selectedStrokeIds: string[];
  
  // 正在绘制的笔画
  activePoints: StrokePoint[];
  
  // 文档状态
  isDirty: boolean;
  lastSavedAt: number | null;
}


interface HandwritingActions {
  // 工具操作
  setActiveTool: (tool: ToolType) => void;
  setBrushType: (type: BrushType) => void;
  setBrushColor: (color: string) => void;
  setBrushWidth: (width: number) => void;
  setBrushOpacity: (opacity: number) => void;
  setEraserMode: (mode: EraserMode) => void;
  setEraserWidth: (width: number) => void;
  
  // 笔画操作
  startStroke: (point: StrokePoint) => void;
  addPoint: (point: StrokePoint) => void;
  endStroke: () => Stroke | null;
  cancelStroke: () => void;
  
  // 图层操作
  addLayer: (name?: string) => string;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;
  toggleLayerVisibility: (id: string) => void;
  toggleLayerLock: (id: string) => void;
  
  // 笔画管理
  addStroke: (stroke: Stroke) => void;
  removeStroke: (id: string) => void;
  removeStrokes: (ids: string[]) => void;
  updateStroke: (id: string, updates: Partial<Stroke>) => void;
  
  // 选择操作
  selectStrokes: (ids: string[]) => void;
  clearSelection: () => void;
  deleteSelected: () => void;
  
  // 视口操作
  setViewport: (viewport: Viewport) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  panBy: (dx: number, dy: number) => void;
  
  // 背景
  setBackground: (bg: BackgroundType) => void;
  
  // 历史记录
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  
  // 文档操作
  loadDocument: (layers: Layer[], background?: BackgroundType) => void;
  clearDocument: () => void;
  markSaved: () => void;
  
  // 获取所有笔画
  getAllStrokes: () => Stroke[];
}

type HandwritingStore = HandwritingState & HandwritingActions;


// 初始状态
const initialState: HandwritingState = {
  activeTool: 'pen',
  brushType: 'pen',
  brushColor: '#000000',
  brushWidth: DEFAULT_BRUSH_SETTINGS.pen.width,
  brushOpacity: DEFAULT_BRUSH_SETTINGS.pen.opacity,
  eraserMode: 'stroke',
  eraserWidth: 20,
  layers: [
    {
      id: 'default',
      name: '图层 1',
      visible: true,
      locked: false,
      strokes: [],
    },
  ],
  activeLayerId: 'default',
  viewport: { x: 0, y: 0, scale: 1 },
  background: 'grid',
  history: [],
  historyIndex: -1,
  maxHistorySize: 100,
  selectedStrokeIds: [],
  activePoints: [],
  isDirty: false,
  lastSavedAt: null,
};

export const useHandwritingStore = create<HandwritingStore>()(
  immer((set, get) => ({
    ...initialState,

    // 工具操作
    setActiveTool: (tool) => set((state) => {
      state.activeTool = tool;
      // 切换到笔刷工具时，应用对应的默认设置
      if (tool === 'pen' || tool === 'pencil' || tool === 'highlighter') {
        const brushType = tool as BrushType;
        state.brushType = brushType;
        state.brushWidth = DEFAULT_BRUSH_SETTINGS[brushType].width;
        state.brushOpacity = DEFAULT_BRUSH_SETTINGS[brushType].opacity;
      }
    }),

    setBrushType: (type) => set((state) => {
      state.brushType = type;
      state.brushWidth = DEFAULT_BRUSH_SETTINGS[type].width;
      state.brushOpacity = DEFAULT_BRUSH_SETTINGS[type].opacity;
    }),

    setBrushColor: (color) => set((state) => {
      state.brushColor = color;
    }),

    setBrushWidth: (width) => set((state) => {
      state.brushWidth = width;
    }),

    setBrushOpacity: (opacity) => set((state) => {
      state.brushOpacity = opacity;
    }),

    setEraserMode: (mode) => set((state) => {
      state.eraserMode = mode;
    }),

    setEraserWidth: (width) => set((state) => {
      state.eraserWidth = width;
    }),


    // 笔画操作
    startStroke: (point) => set((state) => {
      state.activePoints = [point];
    }),

    addPoint: (point) => set((state) => {
      state.activePoints.push(point);
    }),

    endStroke: () => {
      const state = get();
      if (state.activePoints.length < 2) {
        set((s) => { s.activePoints = []; });
        return null;
      }

      const stroke: Stroke = {
        id: generateId(),
        points: [...state.activePoints],
        color: state.brushColor,
        width: state.brushWidth,
        opacity: state.brushOpacity,
        brushType: state.brushType,
        createdAt: Date.now(),
        layerId: state.activeLayerId,
      };

      set((s) => {
        // 添加到当前图层
        const layer = s.layers.find(l => l.id === s.activeLayerId);
        if (layer && !layer.locked) {
          layer.strokes.push(stroke);
          
          // 添加到历史记录
          const entry: HistoryEntry = {
            type: 'add',
            strokes: [stroke],
            timestamp: Date.now(),
          };
          
          // 截断历史记录
          s.history = s.history.slice(0, s.historyIndex + 1);
          s.history.push(entry);
          
          // 限制历史记录大小
          if (s.history.length > s.maxHistorySize) {
            s.history.shift();
          } else {
            s.historyIndex++;
          }
          
          s.isDirty = true;
        }
        
        s.activePoints = [];
      });

      return stroke;
    },

    cancelStroke: () => set((state) => {
      state.activePoints = [];
    }),

    // 图层操作
    addLayer: (name) => {
      const id = generateId();
      set((state) => {
        state.layers.push({
          id,
          name: name || `图层 ${state.layers.length + 1}`,
          visible: true,
          locked: false,
          strokes: [],
        });
        state.activeLayerId = id;
        state.isDirty = true;
      });
      return id;
    },

    removeLayer: (id) => set((state) => {
      if (state.layers.length <= 1) return;
      
      const index = state.layers.findIndex(l => l.id === id);
      if (index !== -1) {
        state.layers.splice(index, 1);
        if (state.activeLayerId === id) {
          state.activeLayerId = state.layers[0].id;
        }
        state.isDirty = true;
      }
    }),

    setActiveLayer: (id) => set((state) => {
      if (state.layers.some(l => l.id === id)) {
        state.activeLayerId = id;
      }
    }),

    toggleLayerVisibility: (id) => set((state) => {
      const layer = state.layers.find(l => l.id === id);
      if (layer) {
        layer.visible = !layer.visible;
      }
    }),

    toggleLayerLock: (id) => set((state) => {
      const layer = state.layers.find(l => l.id === id);
      if (layer) {
        layer.locked = !layer.locked;
      }
    }),


    // 笔画管理
    addStroke: (stroke) => set((state) => {
      const layer = state.layers.find(l => l.id === stroke.layerId);
      if (layer && !layer.locked) {
        layer.strokes.push(stroke);
        state.isDirty = true;
      }
    }),

    removeStroke: (id) => set((state) => {
      for (const layer of state.layers) {
        const index = layer.strokes.findIndex(s => s.id === id);
        if (index !== -1) {
          const removed = layer.strokes.splice(index, 1);
          
          // 添加到历史记录
          const entry: HistoryEntry = {
            type: 'remove',
            strokes: removed,
            timestamp: Date.now(),
          };
          state.history = state.history.slice(0, state.historyIndex + 1);
          state.history.push(entry);
          if (state.history.length > state.maxHistorySize) {
            state.history.shift();
          } else {
            state.historyIndex++;
          }
          
          state.isDirty = true;
          break;
        }
      }
    }),

    removeStrokes: (ids) => set((state) => {
      const removed: Stroke[] = [];
      
      for (const layer of state.layers) {
        layer.strokes = layer.strokes.filter(s => {
          if (ids.includes(s.id)) {
            removed.push(s);
            return false;
          }
          return true;
        });
      }
      
      if (removed.length > 0) {
        const entry: HistoryEntry = {
          type: 'remove',
          strokes: removed,
          timestamp: Date.now(),
        };
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(entry);
        if (state.history.length > state.maxHistorySize) {
          state.history.shift();
        } else {
          state.historyIndex++;
        }
        
        state.isDirty = true;
      }
    }),

    updateStroke: (id, updates) => set((state) => {
      for (const layer of state.layers) {
        const stroke = layer.strokes.find(s => s.id === id);
        if (stroke) {
          Object.assign(stroke, updates);
          state.isDirty = true;
          break;
        }
      }
    }),

    // 选择操作
    selectStrokes: (ids) => set((state) => {
      state.selectedStrokeIds = ids;
    }),

    clearSelection: () => set((state) => {
      state.selectedStrokeIds = [];
    }),

    deleteSelected: () => {
      const ids = get().selectedStrokeIds;
      if (ids.length > 0) {
        get().removeStrokes(ids);
        set((state) => {
          state.selectedStrokeIds = [];
        });
      }
    },


    // 视口操作
    setViewport: (viewport) => set((state) => {
      state.viewport = viewport;
    }),

    zoomIn: () => set((state) => {
      state.viewport.scale = Math.min(4, state.viewport.scale * 1.25);
    }),

    zoomOut: () => set((state) => {
      state.viewport.scale = Math.max(0.25, state.viewport.scale / 1.25);
    }),

    resetZoom: () => set((state) => {
      state.viewport = { x: 0, y: 0, scale: 1 };
    }),

    panBy: (dx, dy) => set((state) => {
      state.viewport.x += dx;
      state.viewport.y += dy;
    }),

    // 背景
    setBackground: (bg) => set((state) => {
      state.background = bg;
      state.isDirty = true;
    }),

    // 历史记录
    undo: () => set((state) => {
      if (state.historyIndex < 0) return;
      
      const entry = state.history[state.historyIndex];
      
      if (entry.type === 'add') {
        // 撤销添加 = 删除
        for (const stroke of entry.strokes) {
          for (const layer of state.layers) {
            const index = layer.strokes.findIndex(s => s.id === stroke.id);
            if (index !== -1) {
              layer.strokes.splice(index, 1);
              break;
            }
          }
        }
      } else if (entry.type === 'remove') {
        // 撤销删除 = 添加回来
        for (const stroke of entry.strokes) {
          const layer = state.layers.find(l => l.id === stroke.layerId);
          if (layer) {
            layer.strokes.push(stroke);
          }
        }
      }
      
      state.historyIndex--;
      state.isDirty = true;
    }),

    redo: () => set((state) => {
      if (state.historyIndex >= state.history.length - 1) return;
      
      state.historyIndex++;
      const entry = state.history[state.historyIndex];
      
      if (entry.type === 'add') {
        // 重做添加
        for (const stroke of entry.strokes) {
          const layer = state.layers.find(l => l.id === stroke.layerId);
          if (layer) {
            layer.strokes.push(stroke);
          }
        }
      } else if (entry.type === 'remove') {
        // 重做删除
        for (const stroke of entry.strokes) {
          for (const layer of state.layers) {
            const index = layer.strokes.findIndex(s => s.id === stroke.id);
            if (index !== -1) {
              layer.strokes.splice(index, 1);
              break;
            }
          }
        }
      }
      
      state.isDirty = true;
    }),

    clearHistory: () => set((state) => {
      state.history = [];
      state.historyIndex = -1;
    }),

    // 文档操作
    loadDocument: (layers, background) => set((state) => {
      state.layers = layers;
      state.activeLayerId = layers[0]?.id || 'default';
      if (background) {
        state.background = background;
      }
      state.history = [];
      state.historyIndex = -1;
      state.isDirty = false;
      state.selectedStrokeIds = [];
    }),

    clearDocument: () => set((state) => {
      state.layers = [{
        id: 'default',
        name: '图层 1',
        visible: true,
        locked: false,
        strokes: [],
      }];
      state.activeLayerId = 'default';
      state.history = [];
      state.historyIndex = -1;
      state.isDirty = false;
      state.selectedStrokeIds = [];
    }),

    markSaved: () => set((state) => {
      state.isDirty = false;
      state.lastSavedAt = Date.now();
    }),

    // 获取所有笔画
    getAllStrokes: () => {
      const state = get();
      return state.layers
        .filter(l => l.visible)
        .flatMap(l => l.strokes);
    },
  }))
);

