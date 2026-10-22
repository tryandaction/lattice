/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __pluginRuntimeTest } from '@/lib/plugins/runtime';

describe('plugin file export adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true, writable: true });
  });

  it('passes a bare MIME type to the File System Access picker', async () => {
    const write = vi.fn(async (value: Blob) => {
      expect(value.text).toBeTypeOf('function');
      expect(value.type).toBe('text/markdown;charset=utf-8');
      expect(await value.text()).toBe('# corrected');
    });
    const close = vi.fn(async () => undefined);
    const picker = vi.fn(async () => ({ createWritable: async () => ({ write, close }) }));
    Object.defineProperty(window, 'showSaveFilePicker', { value: picker, configurable: true, writable: true });

    await expect(__pluginRuntimeTest.exportPluginFile({
      suggestedName: 'formula.md',
      content: '# corrected',
      mimeType: 'text/markdown;charset=utf-8',
    }, ['export-file'])).resolves.toBe(true);

    expect(picker).toHaveBeenCalledWith({
      suggestedName: 'formula.md',
      types: [{ description: 'Export file', accept: { 'text/markdown': ['.md'] } }],
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('denies export before touching the browser picker without permission', async () => {
    const picker = vi.fn();
    Object.defineProperty(window, 'showSaveFilePicker', { value: picker, configurable: true, writable: true });

    await expect(__pluginRuntimeTest.exportPluginFile({
      suggestedName: 'formula.md',
      content: '# corrected',
    }, [])).rejects.toThrow('Permission denied');
    expect(picker).not.toHaveBeenCalled();
  });
});
