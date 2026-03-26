/**
 * Tests for storage adapter environment detection.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTauriInvoke, isTauri, isTauriHost } from '../storage-adapter';

function setWindowProp(key: string, value: unknown) {
  Object.defineProperty(window, key, {
    value,
    configurable: true,
    writable: true,
  });
}

function clearTauriGlobals() {
  const tauriWindow = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  delete tauriWindow.__TAURI__;
  delete tauriWindow.__TAURI_INTERNALS__;
}

describe('storage-adapter environment detection', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    clearTauriGlobals();
  });

  it('detects no tauri runtime by default', () => {
    clearTauriGlobals();
    expect(isTauri()).toBe(false);
    expect(isTauriHost()).toBe(false);
  });

  it('treats __TAURI_INTERNALS__ as tauri host only', () => {
    setWindowProp('__TAURI_INTERNALS__', {});
    expect(isTauriHost()).toBe(true);
    expect(isTauri()).toBe(false);
    expect(getTauriInvoke()).toBeNull();
  });

  it('treats __TAURI_INTERNALS__.invoke as tauri-ready runtime', () => {
    const invoke = () => Promise.resolve(null);
    setWindowProp('__TAURI_INTERNALS__', { invoke });
    expect(isTauriHost()).toBe(true);
    expect(isTauri()).toBe(true);
    expect(getTauriInvoke()).toBe(invoke);
  });

  it('treats __TAURI__.core.invoke as tauri-ready runtime', () => {
    const invoke = () => Promise.resolve(null);
    setWindowProp('__TAURI__', {
      core: {
        invoke,
      },
    });
    expect(isTauriHost()).toBe(true);
    expect(isTauri()).toBe(true);
    expect(getTauriInvoke()).toBe(invoke);
  });

  it('migrates localStorage values into the Tauri store on first read', async () => {
    const persistedValue = { lastWorkspacePath: 'C:/workspace' };
    localStorage.setItem('lattice-settings', JSON.stringify(persistedValue));

    const tauriStore = new Map<string, unknown>();
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_setting') {
        return (tauriStore.get(String(args?.key)) ?? null) as unknown;
      }

      if (command === 'set_setting') {
        tauriStore.set(String(args?.key), args?.value);
        return null;
      }

      if (command === 'remove_setting') {
        tauriStore.delete(String(args?.key));
        return null;
      }

      if (command === 'clear_settings') {
        tauriStore.clear();
        return null;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    setWindowProp('__TAURI_INTERNALS__', { invoke });
    const mod = await import('../storage-adapter');
    const adapter = mod.getStorageAdapter();
    const value = await adapter.get<typeof persistedValue>('lattice-settings');

    expect(value).toEqual(persistedValue);
    expect(tauriStore.get('lattice-settings')).toEqual(persistedValue);
    expect(localStorage.getItem('lattice-settings')).toBeNull();
  });

  it('writes directly to the Tauri store when the runtime is ready', async () => {
    const tauriStore = new Map<string, unknown>();
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_setting') {
        return (tauriStore.get(String(args?.key)) ?? null) as unknown;
      }

      if (command === 'set_setting') {
        tauriStore.set(String(args?.key), args?.value);
        return null;
      }

      if (command === 'remove_setting') {
        tauriStore.delete(String(args?.key));
        return null;
      }

      if (command === 'clear_settings') {
        tauriStore.clear();
        return null;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    setWindowProp('__TAURI_INTERNALS__', { invoke });
    const mod = await import('../storage-adapter');
    const adapter = mod.getStorageAdapter();

    await adapter.set('example', { ok: true });
    expect(tauriStore.get('example')).toEqual({ ok: true });

    await adapter.remove('example');
    expect(tauriStore.has('example')).toBe(false);

    await adapter.set('another', 123);
    await adapter.clear();
    expect(tauriStore.size).toBe(0);
  });
});
