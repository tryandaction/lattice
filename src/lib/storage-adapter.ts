/**
 * Storage Adapter
 * 
 * Provides a unified interface for persistent storage across
 * Web (localStorage) and Desktop (Tauri store) environments.
 */

// Check if running in Tauri environment
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI__' in window;
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
 * Tauri Storage Adapter using Tauri invoke commands
 * Falls back to localStorage if Tauri commands fail
 * @internal Reserved for future Tauri backend integration
 */
class _TauriStorageAdapter implements StorageAdapter {
  private webFallback = new WebStorageAdapter();

  async get<T>(key: string): Promise<T | null> {
    try {
      // Use Tauri invoke to get settings
      const value = await window.__TAURI__!.core.invoke<string | null>('get_setting', { key });
      return value ? JSON.parse(value) : null;
    } catch {
      // Fallback to localStorage
      return this.webFallback.get<T>(key);
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await window.__TAURI__!.core.invoke('set_setting', { 
        key, 
        value: JSON.stringify(value) 
      });
    } catch {
      // Fallback to localStorage
      await this.webFallback.set(key, value);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await window.__TAURI__!.core.invoke('remove_setting', { key });
    } catch {
      await this.webFallback.remove(key);
    }
  }

  async clear(): Promise<void> {
    try {
      await window.__TAURI__!.core.invoke('clear_settings');
    } catch {
      await this.webFallback.clear();
    }
  }
}

// Singleton instance
let storageAdapter: StorageAdapter | null = null;

/**
 * Get the appropriate storage adapter for the current environment
 * Note: Always uses WebStorageAdapter for now since Tauri commands
 * need to be implemented in the Rust backend
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
  
  if (!storageAdapter) {
    // For now, always use WebStorageAdapter as it works in both environments
    // Tauri-specific storage can be added later when backend commands are ready
    storageAdapter = new WebStorageAdapter();
  }
  return storageAdapter;
}
