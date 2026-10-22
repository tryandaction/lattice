import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequestLifecycle, generationTimeouts } from '../request-lifecycle';

afterEach(() => vi.useRealTimers());
describe('request deadlines', () => {
  it('waits for actual response bytes, then enforces inactivity independently of total elapsed time', async () => {
    vi.useFakeTimers();
    const timer = createRequestLifecycle({ firstResponseMs: 1000, idleMs: 300, totalMs: 5000 });
    await vi.advanceTimersByTimeAsync(900); expect(timer.signal.aborted).toBe(false);
    timer.activity(); await vi.advanceTimersByTimeAsync(250); expect(timer.signal.aborted).toBe(false);
    timer.activity(); await vi.advanceTimersByTimeAsync(301);
    expect(timer.signal.reason).toMatchObject({ phase: 'idle' }); timer.dispose();
  });
  it('bounds endless heartbeats with a total deadline and disposes cancelled work', async () => {
    vi.useFakeTimers();
    const timer = createRequestLifecycle({ firstResponseMs: 1000, idleMs: 1000, totalMs: 2500 });
    for (let step = 0; step < 3; step++) { timer.activity(); await vi.advanceTimersByTimeAsync(900); }
    expect(timer.signal.reason).toMatchObject({ phase: 'overall' }); timer.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('honors separate first-response and total settings while keeping JSON and SSE idle handling distinct', () => {
    expect(generationTimeouts(30000, true)).toEqual({ firstResponseMs: 120000, idleMs: 30000, totalMs: 600000 });
    expect(generationTimeouts(30000, false)).toEqual({ firstResponseMs: 120000, idleMs: 120000, totalMs: 600000 });
    expect(generationTimeouts(30000, true, { firstResponseMs: 5000, totalMs: 4000 })).toMatchObject({ firstResponseMs: 4000, totalMs: 4000 });
  });
});
