export type LatticePerformanceMetric = 'file-open' | 'navigation-dispatch' | 'pdf-raster' | 'folder-open' | 'ai-submit';

export interface LatticePerformanceSample {
  metric: LatticePerformanceMetric;
  durationMs: number;
  at: number;
  metadata?: Record<string, string | number | boolean>;
}

const MAX_SAMPLES = 120;
const samples: LatticePerformanceSample[] = [];

export function measureLatticePerformance<T>(metric: LatticePerformanceMetric, operation: () => T, metadata?: LatticePerformanceSample['metadata']): T {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    return operation();
  } finally {
    recordLatticePerformanceSample(metric, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started, metadata);
  }
}

export async function measureLatticePerformanceAsync<T>(metric: LatticePerformanceMetric, operation: () => Promise<T>, metadata?: LatticePerformanceSample['metadata']): Promise<T> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    return await operation();
  } finally {
    recordLatticePerformanceSample(metric, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started, metadata);
  }
}

export function recordLatticePerformanceSample(metric: LatticePerformanceMetric, durationMs: number, metadata?: LatticePerformanceSample['metadata']): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  samples.push({ metric, durationMs, at: Date.now(), metadata });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lattice-performance-sample', { detail: samples.at(-1) }));
}

export function getLatticePerformanceSamples(): LatticePerformanceSample[] { return samples.slice(); }
