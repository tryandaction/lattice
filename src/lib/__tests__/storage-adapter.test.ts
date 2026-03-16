/**
 * Tests for storage adapter environment detection.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { isTauri, isTauriHost } from '../storage-adapter';

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
  });

  it('treats __TAURI__.core.invoke as tauri-ready runtime', () => {
    setWindowProp('__TAURI__', {
      core: {
        invoke: () => Promise.resolve(null),
      },
    });
    expect(isTauriHost()).toBe(true);
    expect(isTauri()).toBe(true);
  });
});
