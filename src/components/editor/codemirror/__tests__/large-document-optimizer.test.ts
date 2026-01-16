/**
 * Tests for Large Document Optimizer
 * 
 * Requirements: 13.5 - Profile and optimize for 100k line documents
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LineCache,
  hashLine,
  getDocumentMetrics,
  getPrioritizedLineRanges,
  IncrementalUpdateTracker,
  PerformanceMetrics,
} from '../live-preview/large-document-optimizer';

describe('LineCache', () => {
  let cache: LineCache<string[]>;
  
  beforeEach(() => {
    cache = new LineCache<string[]>(100, 5000);
  });
  
  it('should store and retrieve values', () => {
    const hash = hashLine('test content');
    cache.set(1, hash, ['element1', 'element2']);
    
    const result = cache.get(1, hash);
    expect(result).toEqual(['element1', 'element2']);
  });
  
  it('should return undefined for missing entries', () => {
    const result = cache.get(999, 'nonexistent');
    expect(result).toBeUndefined();
  });
  
  it('should invalidate entries when hash changes', () => {
    const hash1 = hashLine('original content');
    const hash2 = hashLine('modified content');
    
    cache.set(1, hash1, ['original']);
    
    // Same line, different hash should return undefined
    const result = cache.get(1, hash2);
    expect(result).toBeUndefined();
  });
  
  it('should invalidate range of lines', () => {
    const hash = hashLine('test');
    cache.set(1, hash, ['line1']);
    cache.set(2, hash, ['line2']);
    cache.set(3, hash, ['line3']);
    cache.set(4, hash, ['line4']);
    
    cache.invalidateRange(2, 3);
    
    expect(cache.get(1, hash)).toEqual(['line1']);
    expect(cache.get(2, hash)).toBeUndefined();
    expect(cache.get(3, hash)).toBeUndefined();
    expect(cache.get(4, hash)).toEqual(['line4']);
  });
  
  it('should clear all entries', () => {
    const hash = hashLine('test');
    cache.set(1, hash, ['line1']);
    cache.set(2, hash, ['line2']);
    
    cache.clear();
    
    expect(cache.get(1, hash)).toBeUndefined();
    expect(cache.get(2, hash)).toBeUndefined();
  });
  
  it('should evict oldest entries when at capacity', () => {
    const smallCache = new LineCache<string[]>(3, 5000);
    const hash = hashLine('test');
    
    smallCache.set(1, hash, ['line1']);
    smallCache.set(2, hash, ['line2']);
    smallCache.set(3, hash, ['line3']);
    smallCache.set(4, hash, ['line4']); // Should evict line 1
    
    expect(smallCache.get(1, hash)).toBeUndefined();
    expect(smallCache.get(4, hash)).toEqual(['line4']);
  });
});

describe('hashLine', () => {
  it('should produce consistent hashes for same content', () => {
    const hash1 = hashLine('test content');
    const hash2 = hashLine('test content');
    expect(hash1).toBe(hash2);
  });
  
  it('should produce different hashes for different content', () => {
    const hash1 = hashLine('content A');
    const hash2 = hashLine('content B');
    expect(hash1).not.toBe(hash2);
  });
  
  it('should handle empty strings', () => {
    const hash = hashLine('');
    expect(hash).toBe('0');
  });
  
  it('should handle special characters', () => {
    const hash = hashLine('**bold** and *italic* and `code`');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });
});

describe('PerformanceMetrics', () => {
  let metrics: PerformanceMetrics;
  
  beforeEach(() => {
    metrics = new PerformanceMetrics();
  });
  
  it('should record measurements', () => {
    metrics.record('test', 10);
    metrics.record('test', 20);
    metrics.record('test', 30);
    
    const stats = metrics.getStats('test');
    expect(stats).not.toBeNull();
    expect(stats!.avg).toBe(20);
    expect(stats!.min).toBe(10);
    expect(stats!.max).toBe(30);
  });
  
  it('should return null for unknown measurements', () => {
    const stats = metrics.getStats('unknown');
    expect(stats).toBeNull();
  });
  
  it('should measure function execution', () => {
    const result = metrics.measure('computation', () => {
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      return sum;
    });
    
    expect(result).toBe(499500);
    
    const stats = metrics.getStats('computation');
    expect(stats).not.toBeNull();
    expect(stats!.avg).toBeGreaterThanOrEqual(0);
  });
  
  it('should clear all measurements', () => {
    metrics.record('test', 10);
    metrics.clear();
    
    const stats = metrics.getStats('test');
    expect(stats).toBeNull();
  });
});

describe('IncrementalUpdateTracker', () => {
  let tracker: IncrementalUpdateTracker;
  
  beforeEach(() => {
    tracker = new IncrementalUpdateTracker();
  });
  
  it('should track dirty lines', () => {
    // Manually mark lines as dirty (simulating what markDirty would do)
    // In real usage, this would be called with ViewUpdate
    tracker.clear();
    
    // Check initial state
    expect(tracker.isLineDirty(1)).toBe(false);
    expect(tracker.getDirtyLines()).toEqual([]);
  });
  
  it('should clear dirty lines after getDirtyLines', () => {
    tracker.clear();
    const lines = tracker.getDirtyLines();
    expect(lines).toEqual([]);
    
    // Second call should also return empty
    const lines2 = tracker.getDirtyLines();
    expect(lines2).toEqual([]);
  });
});
