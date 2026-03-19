import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalImageUrlCache } from '../local-image-url-cache';

describe('local-image-url-cache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stores and returns cached object urls by path', () => {
    const cache = createLocalImageUrlCache();

    cache.set('images/plot.png', 'blob:plot');

    expect(cache.get('images/plot.png')).toBe('blob:plot');
    expect(cache.size()).toBe(1);
  });

  it('revokes replaced urls for the same path', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const cache = createLocalImageUrlCache();

    cache.set('images/plot.png', 'blob:old');
    cache.set('images/plot.png', 'blob:new');

    expect(revokeSpy).toHaveBeenCalledWith('blob:old');
    expect(cache.get('images/plot.png')).toBe('blob:new');
  });

  it('revokes all urls on cleanup', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const cache = createLocalImageUrlCache();

    cache.set('images/a.png', 'blob:a');
    cache.set('images/b.png', 'blob:b');
    cache.revokeAll();

    expect(revokeSpy).toHaveBeenCalledWith('blob:a');
    expect(revokeSpy).toHaveBeenCalledWith('blob:b');
    expect(cache.size()).toBe(0);
  });
});
