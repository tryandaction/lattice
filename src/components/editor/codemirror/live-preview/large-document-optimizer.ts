/**
 * Large Document Optimizer for Live Preview Editor
 * Optimizations for handling documents with 100k+ lines
 * 
 * Requirements: 13.5 - Profile and optimize for 100k line documents
 * 
 * Key optimizations:
 * 1. Chunked processing - Process visible viewport first, then expand
 * 2. Line-based caching with efficient invalidation
 * 3. Incremental updates - Only re-process changed regions
 * 4. Viewport prioritization - Always prioritize visible content
 * 5. Idle-time processing - Process off-screen content during idle
 */

import { EditorView, ViewUpdate } from '@codemirror/view';
import { EditorState, ChangeSet } from '@codemirror/state';

/**
 * Configuration for large document handling
 */
export interface LargeDocumentConfig {
  /** Threshold for considering a document "large" (in lines) */
  largeDocumentThreshold: number;
  /** Maximum lines to process per frame */
  maxLinesPerFrame: number;
  /** Viewport buffer (lines above/below visible area to pre-process) */
  viewportBuffer: number;
  /** Cache TTL in milliseconds */
  cacheTTL: number;
  /** Enable idle-time processing */
  enableIdleProcessing: boolean;
}

const DEFAULT_CONFIG: LargeDocumentConfig = {
  largeDocumentThreshold: 5000,
  maxLinesPerFrame: 500,
  viewportBuffer: 100,
  cacheTTL: 10000,
  enableIdleProcessing: true,
};

/**
 * Document size metrics
 */
export interface DocumentMetrics {
  lineCount: number;
  charCount: number;
  isLargeDocument: boolean;
  viewportLineCount: number;
  processedLineCount: number;
}

/**
 * Get document metrics
 */
export function getDocumentMetrics(view: EditorView, config = DEFAULT_CONFIG): DocumentMetrics {
  const doc = view.state.doc;
  const lineCount = doc.lines;
  const charCount = doc.length;
  
  // Calculate viewport line count
  let viewportLineCount = 0;
  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;
    viewportLineCount += endLine - startLine + 1;
  }
  
  return {
    lineCount,
    charCount,
    isLargeDocument: lineCount > config.largeDocumentThreshold,
    viewportLineCount,
    processedLineCount: viewportLineCount + config.viewportBuffer * 2,
  };
}

/**
 * Line range for processing
 */
export interface LineRange {
  startLine: number;
  endLine: number;
  priority: 'viewport' | 'buffer' | 'background';
}

/**
 * Get prioritized line ranges for processing
 * Returns ranges in order of priority: viewport first, then buffer, then background
 */
export function getPrioritizedLineRanges(
  view: EditorView,
  config = DEFAULT_CONFIG
): LineRange[] {
  const doc = view.state.doc;
  const totalLines = doc.lines;
  const ranges: LineRange[] = [];
  
  // Collect viewport ranges
  const viewportRanges: Array<{ start: number; end: number }> = [];
  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;
    viewportRanges.push({ start: startLine, end: endLine });
  }
  
  // Add viewport ranges (highest priority)
  for (const { start, end } of viewportRanges) {
    ranges.push({
      startLine: start,
      endLine: end,
      priority: 'viewport',
    });
  }
  
  // Add buffer ranges (medium priority)
  for (const { start, end } of viewportRanges) {
    // Buffer above viewport
    const bufferAboveStart = Math.max(1, start - config.viewportBuffer);
    if (bufferAboveStart < start) {
      ranges.push({
        startLine: bufferAboveStart,
        endLine: start - 1,
        priority: 'buffer',
      });
    }
    
    // Buffer below viewport
    const bufferBelowEnd = Math.min(totalLines, end + config.viewportBuffer);
    if (bufferBelowEnd > end) {
      ranges.push({
        startLine: end + 1,
        endLine: bufferBelowEnd,
        priority: 'buffer',
      });
    }
  }
  
  return ranges;
}

/**
 * Efficient line cache with LRU eviction and change-based invalidation
 */
export class LineCache<T> {
  private cache = new Map<number, { value: T; hash: string; timestamp: number }>();
  private maxSize: number;
  private ttl: number;
  
  constructor(maxSize = 10000, ttl = 10000) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }
  
  /**
   * Get cached value for a line
   */
  get(lineNumber: number, lineHash: string): T | undefined {
    const entry = this.cache.get(lineNumber);
    if (!entry) return undefined;
    
    // Check hash match (content changed)
    if (entry.hash !== lineHash) {
      this.cache.delete(lineNumber);
      return undefined;
    }
    
    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(lineNumber);
      return undefined;
    }
    
    return entry.value;
  }
  
  /**
   * Set cached value for a line
   */
  set(lineNumber: number, lineHash: string, value: T): void {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    
    this.cache.set(lineNumber, {
      value,
      hash: lineHash,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Invalidate lines affected by a change
   */
  invalidateRange(startLine: number, endLine: number): void {
    for (let i = startLine; i <= endLine; i++) {
      this.cache.delete(i);
    }
  }
  
  /**
   * Invalidate lines affected by a ChangeSet
   */
  invalidateFromChanges(changes: ChangeSet, doc: { lineAt: (pos: number) => { number: number } }): void {
    changes.iterChangedRanges((fromA, toA) => {
      const startLine = doc.lineAt(fromA).number;
      const endLine = doc.lineAt(toA).number;
      this.invalidateRange(startLine, endLine);
    });
  }
  
  /**
   * Clear all cached values
   */
  clear(): void {
    this.cache.clear();
  }
  
  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
  
  private evictOldest(): void {
    let oldestKey: number | undefined;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
    }
  }
}

/**
 * Simple hash function for line content
 */
export function hashLine(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Chunked processor for large documents
 * Processes lines in chunks to avoid blocking the main thread
 */
export class ChunkedProcessor<T> {
  private pendingRanges: LineRange[] = [];
  private isProcessing = false;
  private idleCallbackId: number | null = null;
  
  constructor(
    private processor: (view: EditorView, startLine: number, endLine: number) => T[],
    private onComplete: (results: T[]) => void,
    private config = DEFAULT_CONFIG
  ) {}
  
  /**
   * Start processing line ranges
   */
  process(view: EditorView, ranges: LineRange[]): void {
    this.pendingRanges = [...ranges];
    this.processNextChunk(view);
  }
  
  /**
   * Cancel pending processing
   */
  cancel(): void {
    this.pendingRanges = [];
    this.isProcessing = false;
    if (this.idleCallbackId !== null) {
      cancelIdleCallback(this.idleCallbackId);
      this.idleCallbackId = null;
    }
  }
  
  private processNextChunk(view: EditorView): void {
    if (this.pendingRanges.length === 0) {
      this.isProcessing = false;
      return;
    }
    
    this.isProcessing = true;
    const range = this.pendingRanges.shift()!;
    
    // Process viewport ranges immediately
    if (range.priority === 'viewport') {
      const results = this.processor(view, range.startLine, range.endLine);
      this.onComplete(results);
      // Continue with next range
      requestAnimationFrame(() => this.processNextChunk(view));
    } else if (this.config.enableIdleProcessing) {
      // Process buffer/background ranges during idle time
      this.idleCallbackId = requestIdleCallback((deadline) => {
        if (deadline.timeRemaining() > 5) {
          const results = this.processor(view, range.startLine, range.endLine);
          this.onComplete(results);
        } else {
          // Not enough time, re-queue
          this.pendingRanges.unshift(range);
        }
        this.idleCallbackId = null;
        this.processNextChunk(view);
      });
    }
  }
}

/**
 * Request idle callback polyfill
 */
const requestIdleCallback = 
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? window.requestIdleCallback
    : (cb: IdleRequestCallback) => setTimeout(() => cb({ 
        didTimeout: false, 
        timeRemaining: () => 50 
      } as IdleDeadline), 1) as unknown as number;

const cancelIdleCallback =
  typeof window !== 'undefined' && 'cancelIdleCallback' in window
    ? window.cancelIdleCallback
    : clearTimeout;

/**
 * Incremental update tracker
 * Tracks which lines need re-processing after document changes
 */
export class IncrementalUpdateTracker {
  private dirtyLines = new Set<number>();
  private lastDocLength = 0;
  
  /**
   * Mark lines as dirty based on document changes
   */
  markDirty(update: ViewUpdate): void {
    if (!update.docChanged) return;
    
    const doc = update.state.doc;
    
    // Track changed ranges
    update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      // Mark old range as dirty
      try {
        const oldStartLine = update.startState.doc.lineAt(fromA).number;
        const oldEndLine = update.startState.doc.lineAt(Math.min(toA, update.startState.doc.length)).number;
        for (let i = oldStartLine; i <= oldEndLine; i++) {
          this.dirtyLines.add(i);
        }
      } catch {
        // Ignore if positions are out of bounds
      }
      
      // Mark new range as dirty
      try {
        const newStartLine = doc.lineAt(fromB).number;
        const newEndLine = doc.lineAt(Math.min(toB, doc.length)).number;
        for (let i = newStartLine; i <= newEndLine; i++) {
          this.dirtyLines.add(i);
        }
      } catch {
        // Ignore if positions are out of bounds
      }
    });
    
    this.lastDocLength = doc.length;
  }
  
  /**
   * Get dirty lines and clear them
   */
  getDirtyLines(): number[] {
    const lines = Array.from(this.dirtyLines);
    this.dirtyLines.clear();
    return lines;
  }
  
  /**
   * Check if a line is dirty
   */
  isLineDirty(lineNumber: number): boolean {
    return this.dirtyLines.has(lineNumber);
  }
  
  /**
   * Clear all dirty markers
   */
  clear(): void {
    this.dirtyLines.clear();
  }
}

/**
 * Performance metrics collector
 */
export class PerformanceMetrics {
  private measurements: Map<string, number[]> = new Map();
  private maxSamples = 100;
  
  /**
   * Record a measurement
   */
  record(name: string, duration: number): void {
    const samples = this.measurements.get(name) || [];
    samples.push(duration);
    
    if (samples.length > this.maxSamples) {
      samples.shift();
    }
    
    this.measurements.set(name, samples);
  }
  
  /**
   * Measure a function execution
   */
  measure<T>(name: string, fn: () => T): T {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    this.record(name, duration);
    return result;
  }
  
  /**
   * Get statistics for a measurement
   */
  getStats(name: string): { avg: number; min: number; max: number; p95: number } | null {
    const samples = this.measurements.get(name);
    if (!samples || samples.length === 0) return null;
    
    const sorted = [...samples].sort((a, b) => a - b);
    const sum = samples.reduce((a, b) => a + b, 0);
    const p95Index = Math.floor(sorted.length * 0.95);
    
    return {
      avg: sum / samples.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p95: sorted[p95Index],
    };
  }
  
  /**
   * Get all statistics
   */
  getAllStats(): Record<string, { avg: number; min: number; max: number; p95: number }> {
    const result: Record<string, { avg: number; min: number; max: number; p95: number }> = {};
    for (const name of this.measurements.keys()) {
      const stats = this.getStats(name);
      if (stats) result[name] = stats;
    }
    return result;
  }
  
  /**
   * Clear all measurements
   */
  clear(): void {
    this.measurements.clear();
  }
}

// Global performance metrics instance
export const performanceMetrics = new PerformanceMetrics();

/**
 * Check if we should use optimized processing for this document
 */
export function shouldUseOptimizedProcessing(view: EditorView, config = DEFAULT_CONFIG): boolean {
  const metrics = getDocumentMetrics(view, config);
  return metrics.isLargeDocument;
}

/**
 * Viewport-aware line iterator
 * Yields lines in priority order: viewport first, then buffer
 */
export function* iterateLinesByPriority(
  view: EditorView,
  config = DEFAULT_CONFIG
): Generator<{ lineNumber: number; line: { from: number; to: number; text: string }; priority: string }> {
  const doc = view.state.doc;
  const ranges = getPrioritizedLineRanges(view, config);
  const yielded = new Set<number>();
  
  for (const range of ranges) {
    for (let lineNum = range.startLine; lineNum <= range.endLine; lineNum++) {
      if (!yielded.has(lineNum) && lineNum >= 1 && lineNum <= doc.lines) {
        yielded.add(lineNum);
        const line = doc.line(lineNum);
        yield {
          lineNumber: lineNum,
          line: { from: line.from, to: line.to, text: line.text },
          priority: range.priority,
        };
      }
    }
  }
}
