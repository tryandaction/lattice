'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { annotationVisibilityStorageKey, parseAnnotationVisibility, type AnnotationVisibilityDocument, type AnnotationVisibilityMode, type AnnotationVisibilityPreference } from '@/lib/shared-library/annotation-visibility';

const changedEvent = 'lattice:cloud-annotation-visibility';
const memoryFallback = new Map<string, string>();
const serverSnapshot = () => null;

function readPreference(key: string | null): string | null {
  if (!key || typeof window === 'undefined') return null;
  if (memoryFallback.has(key)) return memoryFallback.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

/** Local view state is scoped independently of cloud writes and source versions. */
export function useSharedAnnotationVisibility(document: AnnotationVisibilityDocument | null) {
  const key = annotationVisibilityStorageKey(document);
  const subscribe = useCallback((listener: () => void) => {
    const onChange = (event: Event) => {
      if (event.type === 'storage') {
        const storageKey = (event as StorageEvent).key;
        if (storageKey === null || storageKey === key) {
          if (key) memoryFallback.delete(key);
          listener();
        }
      } else if ((event as CustomEvent<string>).detail === key) listener();
    };
    window.addEventListener('storage', onChange);
    window.addEventListener(changedEvent, onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener(changedEvent, onChange);
    };
  }, [key]);
  const getSnapshot = useCallback(() => readPreference(key), [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const preference = useMemo(() => parseAnnotationVisibility(raw), [raw]);
  const update = useCallback((change: (current: AnnotationVisibilityPreference) => AnnotationVisibilityPreference) => {
    if (!key) return;
    const value = JSON.stringify({ version: 1, ...change(parseAnnotationVisibility(readPreference(key))) });
    try {
      window.localStorage.setItem(key, value);
      memoryFallback.delete(key);
    } catch {
      memoryFallback.set(key, value);
    }
    window.dispatchEvent(new CustomEvent(changedEvent, { detail: key }));
  }, [key]);
  const setMode = useCallback((mode: AnnotationVisibilityMode) => update(current => ({ ...current, mode })), [update]);
  const setAuthorVisible = useCallback((authorId: string, visible: boolean) => update(current => ({
    ...current,
    hiddenAuthors: visible ? current.hiddenAuthors.filter(id => id !== authorId) : [...new Set([...current.hiddenAuthors, authorId])],
  })), [update]);
  return {
    preference,
    setMode,
    setAuthorVisible,
  };
}
