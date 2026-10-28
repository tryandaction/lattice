import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AnnotationItem } from '@/types/universal-annotation';
import { useSharedAnnotationSystem, type SharedAnnotationDocument } from '../use-shared-annotation-system';
import { useAnnotationNavigation } from '../use-annotation-navigation';

const annotation: AnnotationItem = { id: '3a80518f-dc7d-4ea0-ac3d-e418dc9f1a95', author: 'fixture-author', createdAt: 1, content: 'Original quote', target: { type: 'pdf', page: 1, rects: [{ x1: .1, y1: .1, x2: .3, y2: .15 }] }, style: { type: 'highlight', color: '#ffeb3b' } };
const document = (onPersist: SharedAnnotationDocument['onPersist'] = vi.fn(async () => undefined)): SharedAnnotationDocument => ({ identity:'cloud:fixture:pdf:version-1',authorId:'fixture-author',canAnnotate:true,annotations:[annotation],onPersist });

describe('shared PDF annotation persistence',()=>{
  it('navigates a shared annotation through the existing viewer target contract', () => {
    const pages: Array<{ page: number; id: string }> = [];
    const { result } = renderHook(() => {
      useAnnotationNavigation({ handlers: { onPdfNavigate: (page, id) => pages.push({ page, id }) } });
      return useSharedAnnotationSystem(document());
    });
    act(() => result.current.scrollToAnnotation(annotation.id));
    expect(pages).toEqual([{ page: 1, id: annotation.id }]);
  });
  it('saves updates through the cloud delta callback without a filesystem handle',async()=>{
    const onPersistMock = vi.fn((_upserts: AnnotationItem[], _removeIds?: string[]) => Promise.resolve());
    const onPersist = onPersistMock as SharedAnnotationDocument['onPersist'];
    const doc=document(onPersist);
    const {result}=renderHook(()=>useSharedAnnotationSystem(doc));
    act(()=>{expect(result.current.updateAnnotation(annotation.id,{comment:'Shared comment'})).toBe(true);});
    await waitFor(()=>expect(onPersist).toHaveBeenCalledTimes(1));
    expect(onPersistMock.mock.calls[0][0][0]).toMatchObject({id:annotation.id,comment:'Shared comment'});
    expect(result.current.annotations[0].comment).toBe('Shared comment');
  });
  it('rolls back only the failed delta and reports durable storage failure',async()=>{
    const onPersist: SharedAnnotationDocument['onPersist'] = vi.fn(async()=>{throw new Error('fixture quota exhausted');});
    const {result}=renderHook(()=>useSharedAnnotationSystem(document(onPersist)));
    let success=true;
    await act(async()=>{success=await result.current.persistAnnotationChanges([{...annotation,comment:'Unsaved'}]);});
    expect(success).toBe(false);expect(result.current.annotations[0].comment).toBeUndefined();
    expect(result.current.error).toContain('quota exhausted');
  });
  it('blocks every mutation for a read-only member',async()=>{
    const onPersist: SharedAnnotationDocument['onPersist'] = vi.fn(async () => undefined),doc={...document(onPersist),canAnnotate:false};
    const {result}=renderHook(()=>useSharedAnnotationSystem(doc));
    await act(async()=>{
      expect(result.current.addAnnotation({...annotation})).toBeNull();
      expect(result.current.updateAnnotation(annotation.id,{comment:'Denied'})).toBe(false);
      expect(result.current.deleteAnnotation(annotation.id)).toBe(false);
      expect(await result.current.persistAnnotationChanges([annotation])).toBe(false);
    });
    expect(onPersist).not.toHaveBeenCalled();expect(result.current.annotations).toEqual([annotation]);
  });
  it('does not apply an old identity completion to a new PDF version',async()=>{
    let finish!:()=>void;const onPersist: SharedAnnotationDocument['onPersist'] = vi.fn(() => new Promise<void>(resolve=>{finish=resolve;}));
    const {result,rerender}=renderHook(({doc})=>useSharedAnnotationSystem(doc),{initialProps:{doc:document(onPersist)}});
    act(()=>{result.current.updateAnnotation(annotation.id,{comment:'Version one'});});
    await waitFor(()=>expect(onPersist).toHaveBeenCalledTimes(1));
    rerender({doc:{...document(),identity:'cloud:fixture:pdf:version-2',annotations:[{...annotation,content:'New version quote'}]}});
    await act(async()=>{finish();});
    expect(result.current.annotations[0].content).toBe('New version quote');
    expect(result.current.annotations[0].comment).toBeUndefined();
  });
  it('preserves another author remote updates while a local write is pending',async()=>{
    let finish!:()=>void;const onPersist: SharedAnnotationDocument['onPersist'] = vi.fn(() => new Promise<void>(resolve=>{finish=resolve;})),doc=document(onPersist);
    const {result,rerender}=renderHook(({doc})=>useSharedAnnotationSystem(doc),{initialProps:{doc}});
    act(()=>{result.current.updateAnnotation(annotation.id,{comment:'Pending'});});
    await waitFor(()=>expect(onPersist).toHaveBeenCalledTimes(1));
    const other={...annotation,id:'5955c223-b091-44e0-9da4-cab3db84e615',author:'other-author',content:'Remote quote'};
    rerender({doc:{...doc,annotations:[annotation,other]}});
    expect(result.current.annotations).toHaveLength(2);expect(result.current.annotations[0].comment).toBe('Pending');
    await act(async()=>{finish();});
  });
  it('attributes new AI batches to the current member while keeping an existing annotation author', async () => {
    const onPersist = vi.fn(async (_items: AnnotationItem[]) => undefined);
    const remoteAnnotation = { ...annotation, id: 'b3fcb0d6-b653-4bca-8281-df083242a745', author: 'other-member' };
    const doc = { ...document(onPersist), annotations: [annotation, remoteAnnotation] };
    const { result } = renderHook(() => useSharedAnnotationSystem(doc));
    const aiAnnotation = { ...annotation, id: 'c161d113-3a45-4d2a-967f-de78d4e39b74', author: 'ai' };
    await act(async () => { await result.current.persistAnnotationChanges([aiAnnotation]); });
    expect(result.current.annotations.find(item => item.id === aiAnnotation.id)?.author).toBe('fixture-author');
    expect(onPersist.mock.calls[0][0][0].author).toBe('fixture-author');
    await act(async () => { await result.current.persistAnnotationChanges([{ ...remoteAnnotation, author: 'ai', comment: 'Edit' }]); });
    expect(onPersist.mock.calls[1][0][0].author).toBe('other-member');
  });
  it.each(['authorId', 'viewScope'] as const)('isolates pending optimistic edits when the same PDF changes %s', async key => {
    let finish!: () => void;
    const onPersist = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const doc = { ...document(onPersist), viewScope: 'connection-one:file' };
    const observed: AnnotationItem[][] = [];
    const { result, rerender } = renderHook(({ doc }) => {
      const system = useSharedAnnotationSystem(doc);
      observed.push(system.annotations);
      return system;
    }, { initialProps: { doc } });
    act(() => { result.current.updateAnnotation(annotation.id, { comment: 'Old identity edit' }); });
    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1));
    observed.length = 0;
    rerender({ doc: { ...doc, [key]: 'another-identity', onPersist: async () => undefined } });
    expect(observed.every(items => items[0].comment === undefined)).toBe(true);
    expect(result.current.annotations[0].comment).toBeUndefined();
    expect(result.current.pendingSave).toBe(false);
    await act(async () => { finish(); });
    expect(result.current.annotations[0].comment).toBeUndefined();
  });
  it('acknowledges cloud metadata and property order before a later collaborator edit arrives', async () => {
    const doc = { ...document(), annotations: [] as AnnotationItem[], authorNames: { 'fixture-author': 'Member' } };
    const { result, rerender } = renderHook(({ doc }) => useSharedAnnotationSystem(doc), { initialProps: { doc } });
    await act(async () => { await result.current.persistAnnotationChanges([{ ...annotation, author: 'ai' }]); });
    const saved: AnnotationItem = { id: annotation.id, target: annotation.target, style: annotation.style, author: 'fixture-author', authorDisplayName: 'Member', createdAt: annotation.createdAt, content: annotation.content };
    rerender({ doc: { ...doc, annotations: [saved] } });
    rerender({ doc: { ...doc, annotations: [{ ...saved, comment: 'Collaborator edit after acknowledgement' }] } });
    expect(result.current.annotations[0].comment).toBe('Collaborator edit after acknowledgement');
  });
  it('acknowledges a projected save even when its persistence promise settles after projection', async () => {
    let finish!: () => void;
    const doc = document(() => new Promise<void>(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ doc }) => useSharedAnnotationSystem(doc), { initialProps: { doc } });
    act(() => { result.current.updateAnnotation(annotation.id, { comment: 'Saved locally' }); });
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    rerender({ doc: { ...doc, annotations: [{ ...annotation, comment: 'Saved locally' }] } });
    await act(async () => { finish(); });
    rerender({ doc: { ...doc, annotations: [{ ...annotation, comment: 'Later remote edit' }] } });
    expect(result.current.annotations[0].comment).toBe('Later remote edit');
  });
});
