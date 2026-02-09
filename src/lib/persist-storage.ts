import { createJSONStorage, type PersistStorage, type StateStorage } from 'zustand/middleware';

const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(name);
      if (!raw) return null;
      // Validate JSON to avoid crashes during hydration
      JSON.parse(raw);
      return raw;
    } catch (error) {
      console.warn('[persist] invalid storage entry, clearing', name, error);
      try {
        window.localStorage.removeItem(name);
      } catch {}
      return null;
    }
  },
  setItem: (name, value) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(name, value);
    } catch (error) {
      console.warn('[persist] failed to write storage', name, error);
    }
  },
  removeItem: (name) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(name);
    } catch (error) {
      console.warn('[persist] failed to remove storage', name, error);
    }
  },
};

export function createSafeJSONStorage<S>(): PersistStorage<S> | undefined {
  if (typeof window === 'undefined') return undefined;
  return createJSONStorage<S>(() => safeLocalStorage);
}
