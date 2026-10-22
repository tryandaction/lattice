import { describe, expect, it } from 'vitest';
import { getLatticePerformanceSamples, measureLatticePerformanceAsync, recordLatticePerformanceSample } from '../performance-metrics';

describe('performance metrics', () => {
  it('records bounded file and navigation samples without changing operation results', async () => {
    const value = await measureLatticePerformanceAsync('navigation-dispatch', async () => 'ok', { page: 4 });
    expect(value).toBe('ok');
    recordLatticePerformanceSample('file-open', 12, { bytes: 100 });
    expect(getLatticePerformanceSamples().slice(-2).map(item => item.metric)).toEqual(['navigation-dispatch', 'file-open']);
  });
  it('ignores invalid durations', () => {
    const before = getLatticePerformanceSamples().length;
    recordLatticePerformanceSample('ai-submit', Number.NaN);
    expect(getLatticePerformanceSamples()).toHaveLength(before);
  });
});
