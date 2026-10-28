import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSharedAnnotationVisibility } from '../use-shared-annotation-visibility';
import { useSharedAnnotationSystem } from '../use-shared-annotation-system';
import type { AnnotationItem } from '@/types/universal-annotation';

const mine: AnnotationItem = { id: 'mine', author: 'me', createdAt: 1, content: 'Mine', target: { type: 'pdf', page: 1, rects: [{ x1: .1, y1: .1, x2: .3, y2: .15 }] }, style: { type: 'highlight', color: '#ffeb3b' } };
const other: AnnotationItem = { ...mine, id: 'other', author: 'alice', content: 'Other' };
const document = { identity: 'file:version-1', viewScope: 'connection:file', authorId: 'me', canAnnotate: true, annotations: [mine, other], onPersist: vi.fn(async () => undefined) };

describe('shared annotation view preferences', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it('persists the view across mounts and versions while isolating a switched identity immediately', () => {
    const first = renderHook(({ doc }) => useSharedAnnotationVisibility(doc), { initialProps: { doc: document } });
    act(() => first.result.current.setMode('others'));
    act(() => first.result.current.setAuthorVisible('alice', false));
    first.unmount();
    const next = renderHook(({ doc }) => useSharedAnnotationVisibility(doc), { initialProps: { doc: { ...document, identity: 'file:version-2' } } });
    expect(next.result.current.preference).toEqual({ mode: 'others', hiddenAuthors: ['alice'] });
    next.rerender({ doc: { ...document, authorId: 'alice' } });
    expect(next.result.current.preference).toEqual({ mode: 'all', hiddenAuthors: [] });
    next.rerender({ doc: { ...document, viewScope: 'another-connection:file' } });
    expect(next.result.current.preference.mode).toBe('all');
  });

  it('updates another open pane of the same file without any cloud persistence', () => {
    const first = renderHook(() => useSharedAnnotationVisibility(document));
    const second = renderHook(() => useSharedAnnotationVisibility(document));
    act(() => first.result.current.setMode('hidden'));
    expect(second.result.current.preference.mode).toBe('hidden');
    expect(document.onPersist).not.toHaveBeenCalled();
  });

  it('keeps view controls usable when browser storage cannot accept a write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    try {
      const { result } = renderHook(() => useSharedAnnotationVisibility({ ...document, viewScope: 'storage-unavailable:file' }));
      act(() => result.current.setMode('hidden'));
      expect(result.current.preference.mode).toBe('hidden');
    } finally {
      setItem.mockRestore();
    }
  });

  it('keeps hidden annotations available for later edits and writes only the edited delta', async () => {
    const { result } = renderHook(() => ({ visibility: useSharedAnnotationVisibility(document), system: useSharedAnnotationSystem(document) }));
    act(() => result.current.visibility.setMode('hidden'));
    expect(result.current.system.annotations).toEqual([mine, other]);
    await act(async () => { expect(await result.current.system.persistAnnotationChanges([{ ...mine, comment: 'Edited while others are hidden' }])).toBe(true); });
    expect(document.onPersist).toHaveBeenCalledWith([{ ...mine, comment: 'Edited while others are hidden' }], []);
    expect(result.current.system.annotations.find(item => item.id === 'other')).toEqual(other);
  });
});
