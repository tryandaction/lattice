import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('desktop window capabilities', () => {
  it('disables native interception so Windows HTML5 drops reach the Explorer DataTransfer handlers', async () => {
    const config = JSON.parse(await readFile(path.resolve('src-tauri/tauri.conf.json'), 'utf8')) as {
      app?: { windows?: Array<{ dragDropEnabled?: boolean }> };
    };
    // Tauri's installed schema says this must be disabled to use frontend
    // HTML5 drag-and-drop on Windows. Explorer consumes DataTransfer files
    // and its internal move/copy MIME, rather than the native interception.
    expect(config.app?.windows?.[0]?.dragDropEnabled).toBe(false);
  });
});
