/**
 * Performance Utilities for Live Preview Editor
 * Caching, debouncing, and optimization helpers
 * 
 * Requirements: 13.1-13.5
 */

import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Extension } from '@codemirror/state';

/**
 * Simple LRU cache for decoration results
 */
export class DecorationCache<K, V> {
  private cache = new Map<K, { value: V; timestamp: number }>();
  private maxSize: number;
  private maxAge: number;
  
  constructor(maxSize: number = 100, maxAgeMs: number = 5000) {
    this.maxSize = maxSize;
    this.maxAge = maxAgeMs;
  }
  
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    // Check if expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key);
      return undefined;
    }
    
    return entry.value;
  }
  
  set(key: K, value: V): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.findOldest();
      if (oldest) this.cache.delete(oldest);
    }
    
    this.cache.set(key, { value, timestamp: Date.now() });
  }
  
  private findOldest(): K | undefined {
    let oldestKey: K | undefined;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    
    return oldestKey;
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  get size(): number {
    return this.cache.size;
  }
}

/**
 * Debounce function with immediate option
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number,
  immediate: boolean = false
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return function (this: unknown, ...args: Parameters<T>) {
    const callNow = immediate && !timeoutId;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (!immediate) {
        fn.apply(this, args);
      }
    }, delay);
    
    if (callNow) {
      fn.apply(this, args);
    }
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  let lastArgs: Parameters<T> | null = null;
  
  return function (this: unknown, ...args: Parameters<T>) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      
      setTimeout(() => {
        inThrottle = false;
        if (lastArgs) {
          fn.apply(this, lastArgs);
          lastArgs = null;
        }
      }, limit);
    } else {
      lastArgs = args;
    }
  };
}

/**
 * Request idle callback polyfill
 */
export const requestIdleCallback = 
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? window.requestIdleCallback
    : (cb: IdleRequestCallback) => setTimeout(() => cb({ 
        didTimeout: false, 
        timeRemaining: () => 50 
      }), 1);

export const cancelIdleCallback =
  typeof window !== 'undefined' && 'cancelIdleCallback' in window
    ? window.cancelIdleCallback
    : clearTimeout;

/**
 * Batch updates for better performance
 */
export class UpdateBatcher {
  private pending: (() => void)[] = [];
  private scheduled = false;
  
  add(update: () => void): void {
    this.pending.push(update);
    this.schedule();
  }
  
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    
    requestIdleCallback(() => {
      this.flush();
    });
  }
  
  private flush(): void {
    const updates = this.pending;
    this.pending = [];
    this.scheduled = false;
    
    for (const update of updates) {
      update();
    }
  }
}

/**
 * Viewport-aware rendering helper
 * Only processes visible content
 */
export function processVisibleRanges<T>(
  view: EditorView,
  processor: (from: number, to: number) => T[]
): T[] {
  const results: T[] = [];
  
  for (const { from, to } of view.visibleRanges) {
    results.push(...processor(from, to));
  }
  
  return results;
}

/**
 * Check if a range is in the viewport
 */
export function isInViewport(view: EditorView, from: number, to: number): boolean {
  for (const range of view.visibleRanges) {
    if (from <= range.to && to >= range.from) {
      return true;
    }
  }
  return false;
}

/**
 * Lazy initialization helper
 */
export function lazy<T>(factory: () => T): () => T {
  let value: T | undefined;
  let initialized = false;
  
  return () => {
    if (!initialized) {
      value = factory();
      initialized = true;
    }
    return value!;
  };
}

/**
 * Performance measurement helper
 */
export class PerformanceMonitor {
  private measurements: Map<string, number[]> = new Map();
  private maxSamples = 100;
  
  measure<T>(name: string, fn: () => T): T {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    
    const samples = this.measurements.get(name) || [];
    samples.push(duration);
    
    // Keep only recent samples
    if (samples.length > this.maxSamples) {
      samples.shift();
    }
    
    this.measurements.set(name, samples);
    
    return result;
  }
  
  getStats(name: string): { avg: number; min: number; max: number; count: number } | null {
    const samples = this.measurements.get(name);
    if (!samples || samples.length === 0) return null;
    
    const sum = samples.reduce((a, b) => a + b, 0);
    return {
      avg: sum / samples.length,
      min: Math.min(...samples),
      max: Math.max(...samples),
      count: samples.length,
    };
  }
  
  clear(): void {
    this.measurements.clear();
  }
}

export const perfMonitor = new PerformanceMonitor();

/**
 * Create a debounced update extension
 */
export function createDebouncedUpdateExtension(
  onUpdate: (view: EditorView) => void,
  delay: number = 100
): Extension {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.scheduleUpdate(view);
      }
      
      scheduleUpdate(view: EditorView) {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          onUpdate(view);
          timeoutId = null;
        }, delay);
      }
      
      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.scheduleUpdate(update.view);
        }
      }
      
      destroy() {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  );
}
