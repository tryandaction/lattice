import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationItem, AnnotationTarget } from '@/types/universal-annotation';
import { validateAnnotationItem } from '@/types/universal-annotation';
import type { AnnotationUpdates, UseAnnotationSystemReturn } from './use-annotation-system';
import { triggerAnnotationNavigation } from './use-annotation-navigation';
import { annotationItemsEqual } from '@/lib/shared-library/annotation-equality';

export interface SharedAnnotationDocument {
  identity: string;
  viewScope?: string;
  sourceVersion?: string;
  authorId: string;
  authorNames?: Record<string, string>;
  canAnnotate: boolean;
  annotations: AnnotationItem[];
  onPersist: (upserts: AnnotationItem[], removeIds?: string[]) => Promise<void>;
}
type Overlay = { value: AnnotationItem | null; sequence: number; committed: boolean };
const keyOf = (doc: SharedAnnotationDocument | null) => doc ? JSON.stringify([doc.authorId, doc.viewScope ?? '', doc.identity, doc.sourceVersion ?? '']) : '';
const overlayEntries = (map: Map<string, Overlay> | undefined): Array<[string, Overlay]> => map ? [...map.entries()] : [];
const withCurrentAuthorName = (annotation: AnnotationItem, doc: SharedAnnotationDocument): AnnotationItem => {
  const name = doc.authorNames?.[annotation.author];
  return name ? { ...annotation, authorDisplayName: name } : annotation;
};

/** The existing PDF interaction code receives the same action contract, while
 * cloud writes remain delta-based, permission checked and source scoped. */
export function useSharedAnnotationSystem(document: SharedAnnotationDocument | null): UseAnnotationSystemReturn {
  const latest = useRef(document);
  const scope = keyOf(document);
  const overlays = useRef(new Map<string, Map<string, Overlay>>());
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const sequence = useRef(0);
  const pending = useRef(new Map<string, number>());
  const mounted = useRef(true);
  const [status, setStatus] = useState({ scope, error: null as string | null });
  const [pendingSnapshot, setPendingSnapshot] = useState({ scope, count: 0 });
  const [overlaySnapshot, setOverlaySnapshot] = useState({ scope, entries: [] as Array<[string, Overlay]> });
  useEffect(() => { mounted.current = true;return () => { mounted.current = false; }; }, []);
  useEffect(() => { latest.current = document; }, [document]);

  useEffect(() => {
    setOverlaySnapshot({ scope, entries: overlayEntries(overlays.current.get(scope)) });
  }, [scope]);
  useEffect(() => {
    if (!document) return;
    const entries = overlays.current.get(scope);
    if (!entries) return;
    let acknowledged = false;
    for (const [id, entry] of entries) {
      const incoming = document.annotations.find(annotation => annotation.id === id);
      if (entry.committed && (entry.value === null ? !incoming : incoming && annotationItemsEqual(withCurrentAuthorName(incoming, document), withCurrentAuthorName(entry.value, document)))) {
        entries.delete(id);acknowledged = true;
      }
    }
    if (acknowledged) setOverlaySnapshot({ scope, entries: [...entries.entries()] });
  }, [document, scope, overlaySnapshot]);

  const visible = useCallback((doc: SharedAnnotationDocument | null, entries: Array<[string, Overlay]>) => {
    const items = new Map((doc?.annotations ?? []).map(annotation => [annotation.id, annotation]));
    for (const [id, entry] of entries) {
      if (entry.value) items.set(id, entry.value);else items.delete(id);
    }
    return [...items.values()];
  }, []);
  const annotations = useMemo(() => visible(document, overlaySnapshot.scope === scope ? overlaySnapshot.entries : []), [document, overlaySnapshot, scope, visible]);

  const enqueue = useCallback((upserts: AnnotationItem[], removals: string[] = []): Promise<boolean> | null => {
    const doc = latest.current;
    if (!doc || keyOf(doc) !== scope || !doc.canAnnotate) {
      setStatus({ scope, error: '当前共享库没有批注写入权限。' });return null;
    }
    for (const item of upserts) {
      const validation = validateAnnotationItem(item);
      if (!validation.valid) { setStatus({ scope, error: `Invalid annotation: ${validation.errors.join(', ')}` });return null; }
    }
    const existingItems = new Map(visible(doc, overlayEntries(overlays.current.get(scope))).map(item => [item.id, item]));
    const items = upserts.map(item => ({ ...structuredClone(item), author: existingItems.get(item.id)?.author ?? doc.authorId }));
    const ids = [...new Set(removals)];
    const number = ++sequence.current;
    const entries = overlays.current.get(scope) ?? new Map<string, Overlay>();
    overlays.current.set(scope, entries);
    for (const item of items) entries.set(item.id, { value: item, sequence: number, committed: false });
    for (const id of ids) entries.set(id, { value: null, sequence: number, committed: false });
    const nextPending = (pending.current.get(scope) ?? 0) + 1;
    pending.current.set(scope, nextPending); setPendingSnapshot({ scope, count: nextPending }); setOverlaySnapshot({ scope, entries: [...entries.entries()] });
    const affected = [...items.map(item => item.id), ...ids];
    const operation = tail.current.then(async () => {
      let error: string | null = null;
      try {
        if (keyOf(latest.current) !== scope || !latest.current?.canAnnotate) throw new Error('共享 PDF 的版本或权限已变化，请重新打开来源后再保存。');
        await doc.onPersist(items, ids);
        for (const id of affected) { const entry=entries.get(id);if(entry?.sequence===number)entry.committed=true; }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : 'Failed to persist shared PDF annotations';
        for (const id of affected) if (entries.get(id)?.sequence === number) entries.delete(id);
      }
      const remaining = Math.max(0, (pending.current.get(scope) ?? 1) - 1);
      pending.current.set(scope, remaining);
      if (mounted.current && keyOf(latest.current) === scope) {
        setOverlaySnapshot({ scope, entries: [...entries.entries()] });
        setPendingSnapshot({ scope, count: remaining });
        setStatus({ scope, error });
      }
      return error === null;
    });
    tail.current = operation.catch(() => undefined);
    return operation;
  }, [scope, visible]);
  const addAnnotation = useCallback((input: Omit<AnnotationItem, 'id' | 'createdAt'>): string | null => {
    const annotation = { ...input, id: crypto.randomUUID(), author: latest.current?.authorId ?? input.author, createdAt: Date.now() };
    return enqueue([annotation]) ? annotation.id : null;
  }, [enqueue]);
  const upsertAnnotation = useCallback((annotation: AnnotationItem) => Boolean(enqueue([annotation])), [enqueue]);
  const upsertAnnotations = useCallback((items: AnnotationItem[]) => enqueue(items) ? items.length : 0, [enqueue]);
  const persistAnnotationChanges = useCallback(async (items: AnnotationItem[], removals: string[] = []) => await (enqueue(items, removals) ?? Promise.resolve(false)), [enqueue]);
  const updateAnnotation = useCallback((id: string, updates: AnnotationUpdates): boolean => {
    const existing = visible(latest.current, overlayEntries(overlays.current.get(keyOf(latest.current)))).find(item => item.id === id);if (!existing) return false;
    const next: AnnotationItem = { ...existing, ...updates, target: { ...existing.target, ...updates.target } as AnnotationItem['target'], style: { ...existing.style, ...updates.style } as AnnotationItem['style'] };
    return Boolean(enqueue([next]));
  }, [enqueue, visible]);
  const deleteAnnotation = useCallback((id: string) => visible(latest.current, overlayEntries(overlays.current.get(keyOf(latest.current)))).some(item => item.id === id) && Boolean(enqueue([], [id])), [enqueue, visible]);
  return {
    annotations, isLoading: false, error: status.scope === scope ? status.error : null,
    pendingSave: pendingSnapshot.scope === scope && pendingSnapshot.count > 0, fileId: document?.identity ?? null,
    addAnnotation, upsertAnnotation, upsertAnnotations, persistAnnotationChanges, updateAnnotation, deleteAnnotation,
    scrollToAnnotation: id => { const annotation=visible(latest.current, overlayEntries(overlays.current.get(keyOf(latest.current)))).find(item=>item.id===id);if(annotation)triggerAnnotationNavigation(annotation.id, annotation.target); },
    getAnnotationById: id => visible(latest.current, overlayEntries(overlays.current.get(keyOf(latest.current)))).find(item => item.id === id),
    getAnnotationsByTarget: <T extends AnnotationTarget['type']>(type: T) => visible(latest.current, overlayEntries(overlays.current.get(keyOf(latest.current)))).filter(item => item.target.type === type),
  };
}
