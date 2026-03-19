import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ai key storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
  });

  it('restores obfuscated api keys from localStorage after reload', async () => {
    let storage = await import('../ai/key-storage');
    await storage.setApiKey('deepseek', 'sk-test-deepseek');

    expect(storage.getApiKey('deepseek')).toBe('sk-test-deepseek');

    sessionStorage.clear();
    vi.resetModules();

    storage = await import('../ai/key-storage');
    await storage.initKeyStorage();

    expect(storage.getApiKey('deepseek')).toBe('sk-test-deepseek');
  });
});
