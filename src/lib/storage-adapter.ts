/**
 * Storage Adapter
 * 
 * Provides a unified interface for persistent storage across
 * Web (localStorage) and Desktop (Tauri store) environments.
 */

export type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>, options?: unknown) => Promise<T>;

const TAURI_INVOKE_READY_TIMEOUT_MS = 5000;
const TAURI_INVOKE_READY_POLL_MS = 25;

function resolveTauriInvoke(
  win: Window & {
    __TAURI__?: { core?: { invoke?: unknown } };
    __TAURI_INTERNALS__?: { invoke?: unknown };
  },
): TauriInvoke | null {
  if (typeof win.__TAURI__?.core?.invoke === "function") {
    return win.__TAURI__.core.invoke as TauriInvoke;
  }

  if (typeof win.__TAURI_INTERNALS__?.invoke === "function") {
    return win.__TAURI_INTERNALS__.invoke as TauriInvoke;
  }

  return null;
}

function hasTauriCore(win: Window & { __TAURI__?: { core?: { invoke?: unknown } }; __TAURI_INTERNALS__?: { invoke?: unknown } }): boolean {
  return resolveTauriInvoke(win) !== null;
}

export function getTauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") {
    return null;
  }

  return resolveTauriInvoke(window as Window & {
    __TAURI__?: { core?: { invoke?: unknown } };
    __TAURI_INTERNALS__?: { invoke?: unknown };
  });
}

export async function waitForTauriInvokeReady(options?: {
  timeoutMs?: number;
  pollMs?: number;
}): Promise<TauriInvoke | null> {
  const invoke = getTauriInvoke();
  if (invoke) {
    return invoke;
  }

  if (!isTauriHost()) {
    return null;
  }

  const timeoutMs = options?.timeoutMs ?? TAURI_INVOKE_READY_TIMEOUT_MS;
  const pollMs = options?.pollMs ?? TAURI_INVOKE_READY_POLL_MS;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      const nextInvoke = getTauriInvoke();
      if (nextInvoke) {
        resolve(nextInvoke);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }

      window.setTimeout(check, pollMs);
    };

    check();
  });
}

/**
 * Detect whether current runtime is hosted by a Tauri shell.
 * This check is intentionally broad and should be used for UI gating only.
 */
export function isTauriHost(): boolean {
  if (typeof window === 'undefined') return false;

  const win = window as Window & {
    __TAURI__?: { core?: { invoke?: unknown } };
    __TAURI_INTERNALS__?: unknown;
  };

  if (hasTauriCore(win)) return true;
  if ('__TAURI_INTERNALS__' in win) return true;
  if (typeof navigator !== 'undefined' && /tauri/i.test(navigator.userAgent)) return true;
  return typeof location !== 'undefined' && location.protocol === 'tauri:';
}

/**
 * Detect whether Tauri invoke bridge is ready.
 * Use this before any `window.__TAURI__.core.invoke(...)` call paths.
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return hasTauriCore(window as Window & {
    __TAURI__?: { core?: { invoke?: unknown } };
    __TAURI_INTERNALS__?: { invoke?: unknown };
  });
}

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Web Storage Adapter using localStorage
 */
class WebStorageAdapter implements StorageAdapter {
  async get<T>(key: string): Promise<T | null> {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch {
      console.error(`Failed to get ${key} from localStorage`);
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Failed to set ${key} in localStorage`, error);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove ${key} from localStorage`, error);
    }
  }

  async clear(): Promise<void> {
    try {
      localStorage.clear();
    } catch (error) {
      console.error('Failed to clear localStorage', error);
    }
  }
}

/**
 * Tauri Storage Adapter backed by the Rust-side Tauri store.
 * When a key only exists in localStorage, it is migrated on first read.
 */
class TauriStorageAdapter implements StorageAdapter {
  private webFallback = new WebStorageAdapter();

  async get<T>(key: string): Promise<T | null> {
    try {
      const invoke = await waitForTauriInvokeReady();
      if (!invoke) {
        throw new Error("Tauri invoke bridge unavailable");
      }
      const value = await invoke<T | null>("get_setting", { key });
      if (value !== null && value !== undefined) {
        return value;
      }

      const fallbackValue = await this.webFallback.get<T>(key);
      if (fallbackValue !== null) {
        await invoke("set_setting", { key, value: fallbackValue });
        await this.webFallback.remove(key);
      }
      return fallbackValue;
    } catch (error) {
      console.error(`Failed to get ${key} from Tauri store`, error);
      return this.webFallback.get<T>(key);
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      const invoke = await waitForTauriInvokeReady();
      if (!invoke) {
        throw new Error("Tauri invoke bridge unavailable");
      }
      await invoke("set_setting", { key, value });
      await this.webFallback.remove(key);
    } catch (error) {
      console.error(`Failed to set ${key} in Tauri store`, error);
      await this.webFallback.set(key, value);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const invoke = await waitForTauriInvokeReady();
      if (!invoke) {
        throw new Error("Tauri invoke bridge unavailable");
      }
      await invoke("remove_setting", { key });
      await this.webFallback.remove(key);
    } catch (error) {
      console.error(`Failed to remove ${key} from Tauri store`, error);
      await this.webFallback.remove(key);
    }
  }

  async clear(): Promise<void> {
    try {
      const invoke = await waitForTauriInvokeReady();
      if (!invoke) {
        throw new Error("Tauri invoke bridge unavailable");
      }
      await invoke("clear_settings");
      await this.webFallback.clear();
    } catch (error) {
      console.error("Failed to clear Tauri store", error);
      await this.webFallback.clear();
    }
  }
}

// Singleton instance
let storageAdapter: StorageAdapter | null = null;

/**
 * Get the appropriate storage adapter for the current environment
 */
export function getStorageAdapter(): StorageAdapter {
  // Return a no-op adapter during SSR
  if (typeof window === 'undefined') {
    return {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
      clear: async () => {},
    };
  }
  
  const shouldUseTauri = isTauriHost();
  if (
    !storageAdapter ||
    (shouldUseTauri && !(storageAdapter instanceof TauriStorageAdapter))
  ) {
    storageAdapter = shouldUseTauri ? new TauriStorageAdapter() : new WebStorageAdapter();
  }
  return storageAdapter;
}
