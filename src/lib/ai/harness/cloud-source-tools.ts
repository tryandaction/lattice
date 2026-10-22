import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
import type { Item } from '@/lib/shared-library/domain';
import { captureCloudAgentDocumentSources, type CloudAgentSourceSelection } from '../cloud-source';
import type { AgentSourceRead, AgentSourceChunk } from '../source-index';
import { isAgentDocumentPath } from '../document-source';
import { prepareCloudPdfChildProposal } from '../lattice-skills/cloud-pdf-child-skill';
import { cloudHarnessResourceVersion, prepareCloudFileProposal } from './cloud-file-proposal';
import { appendVerifiedAnnotationDrafts, harnessPage, type HarnessAnnotationIntent } from './pdf-tool-helpers';
import { publishHarnessDraft, type HarnessDraftHandler } from './tool-draft';

export interface CloudHarnessToolInput {
  kind: 'cloud'; getProvider: () => CloudLibrarySourceProvider | null;
  selections: readonly CloudAgentSourceSelection[];
  /** The exact resource captured by request/conversation targeting. */
  getActiveResource?: () => CloudLibraryResource | null | undefined;
  isCurrent?: () => boolean; onDraft?: HarnessDraftHandler;
}
interface Reference { id: string; libraryId: string; itemId: string; name: string; kind: string; parentItemId?: string; versionId?: string }
export function createCloudHarnessSourceTools(input: CloudHarnessToolInput) {
  const provider = input.getProvider(), scope = provider?.scope;
  const selections = input.selections.map(selection => ({ ...selection }));
  const references = new Map<string, Reference>(), entries: Reference[] = [], evidence = new Map<string, AgentSourceRead>();
  let iterator: AsyncGenerator<Reference> | undefined, exhausted = false, listing = Promise.resolve(), discoverySignal: AbortSignal | undefined;
  async function assertCurrent(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!provider || input.getProvider() !== provider || provider.scope !== scope || input.isCurrent && !input.isCurrent()) throw new Error('Cloud provider account or permission scope changed.');
  }
  async function resource(ref: Pick<Reference, 'id' | 'libraryId' | 'itemId'>, signal?: AbortSignal) {
    await assertCurrent(signal);
    const current = await provider!.read(ref.libraryId, ref.itemId, signal); await assertCurrent(signal);
    if (current.id !== ref.id || current.libraryId !== ref.libraryId || current.itemId !== ref.itemId) throw new Error('Cloud resource identity or account scope changed.');
    return current;
  }
  async function reference(libraryId: string, itemId: string, item?: Item, signal?: AbortSignal): Promise<Reference> {
    await assertCurrent(signal);
    const identity = provider!.resourceIdentity?.(libraryId, itemId);
    const current = identity && item ? null : await provider!.read(libraryId, itemId, signal); await assertCurrent(signal);
    if (current && (current.libraryId !== libraryId || current.itemId !== itemId)) throw new Error('Cloud resource identity changed.');
    const ref = { id: identity ?? current!.id, libraryId, itemId, name: item?.canonicalName ?? current!.name,
      kind: item?.kind ?? current!.kind, versionId: item?.currentVersionId ?? current?.versionId,
      ...(typeof item?.metadata.parentItemId === 'string' ? { parentItemId: item.metadata.parentItemId } : {}) };
    references.set(ref.id, ref); return ref;
  }
  async function* discover(): AsyncGenerator<Reference> {
    const visited = new Set<string>(); let count = 0;
    async function* walk(libraryId: string, folderId: string): AsyncGenerator<Reference> {
      await assertCurrent(discoverySignal); const key = JSON.stringify([libraryId, folderId]);
      if (visited.has(key)) return;
      if (visited.size >= 1000) throw new Error('Cloud folder discovery budget exceeded; select a smaller source.');
      visited.add(key);
      const children = await provider!.list(libraryId, folderId, discoverySignal); await assertCurrent(discoverySignal);
      for (const item of children) {
        if (++count > 5000) throw new Error('Cloud entry discovery budget exceeded; select a smaller source.');
        if (item.libraryId !== libraryId || item.status !== 'active' || item.metadata.parentItemId !== folderId) continue;
        const ref = await reference(libraryId, item.id, item, discoverySignal); yield ref;
        if (item.kind === 'folder') yield* walk(libraryId, item.id);
      }
    }
    for (const selection of selections) {
      const ref = await reference(selection.libraryId, selection.itemId, undefined, discoverySignal);
      yield ref;
      if (selection.kind === 'folder') {
        if (ref.kind !== 'folder') throw new Error('Cloud folder selection is no longer a folder.');
        yield* walk(selection.libraryId, selection.itemId);
      }
    }
  }
  async function list(args: Record<string, unknown>, signal?: AbortSignal) {
    await assertCurrent(signal);
    const cursor = Number(args.cursor ?? 0), limit = Math.min(Number(args.limit ?? 100), 500);
    const work = listing.then(async () => {
      discoverySignal = signal;
      try {
        iterator ??= discover();
        while (!exhausted && entries.length < cursor + limit) {
          const next = await iterator.next(); await assertCurrent(signal);
          if (next.done) { exhausted = true; break; }
          if (!entries.some(entry => entry.id === next.value.id)) entries.push(next.value);
        }
      } catch (error) { iterator = undefined; throw error; }
      finally { discoverySignal = undefined; }
    });
    listing = work.catch(() => undefined); await work;
    const page = entries.slice(cursor, cursor + limit), complete = exhausted && cursor + page.length >= entries.length;
    return { entries: page.map(ref => ({ path: ref.id, sourceId: ref.id, name: ref.name, kind: ref.kind, libraryId: ref.libraryId, itemId: ref.itemId,
      versionId: ref.versionId, supported: ref.kind !== 'folder' && isAgentDocumentPath(ref.name) })), complete, ...(!complete ? { nextCursor: cursor + page.length } : {}) };
  }
  async function find(path: string, signal?: AbortSignal): Promise<Reference> {
    await assertCurrent(signal);
    if (references.has(path)) return references.get(path)!;
    // Direct file selections and the captured active source need no full-library scan.
    const active = input.getActiveResource?.();
    if (active?.id === path && selections.some(selection => selection.libraryId === active.libraryId && selection.itemId === active.itemId)) {
      const ref = await reference(active.libraryId, active.itemId, undefined, signal);
      if (ref.id === path) return ref;
    }
    let cursor = 0;
    while (cursor <= 5000) {
      const page = await list({ cursor, limit: 100 }, signal);
      if (references.has(path)) return references.get(path)!;
      if (page.complete || page.nextCursor === cursor) break;
      cursor = page.nextCursor!;
    }
    throw new Error('Cloud source resource ID is outside the authorized selection. Display paths are not filesystem paths.');
  }
  async function read(path: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<AgentSourceRead> {
    const ref = await find(path, signal), current = await resource(ref, signal);
    if (current.kind === 'folder') throw new Error('Cloud folders contain metadata, not document quotation evidence.');
    const captured = await captureCloudAgentDocumentSources({ provider: provider!, resource: current, signal,
      isCurrent: () => input.getProvider() === provider && provider!.scope === scope && (!input.isCurrent || input.isCurrent()) });
    const opened = captured.sources[0], snapshot = captured.snapshots[0];
    try {
      if (args.expectedVersion && snapshot.version !== args.expectedVersion) throw new Error('Cloud source revision changed; read the current version.');
      const maxChars = Math.min(Number(args.maxChars ?? 60_000), 1_000_000), maxUnits = Math.min(Number(args.maxUnits ?? 512), 4096);
      const units = [...new Set(args.units as number[] | undefined ?? Array.from({ length: opened.totalUnits }, (_, i) => i + 1))];
      const chunks: AgentSourceChunk[] = [], readUnits: number[] = [], unreadableUnits: Array<{ unit: number; reason: string }> = [];
      let scannedChars = 0;
      for (const unit of units) {
        if (scannedChars >= maxChars || readUnits.length + unreadableUnits.length + chunks.filter(chunk => !chunk.completeUnit).length >= maxUnits) break;
        await assertCurrent(signal); const value = await opened.readUnit(unit, signal); await assertCurrent(signal);
        if (value.status === 'unreadable') { unreadableUnits.push({ unit, reason: value.reason ?? 'unreadable' }); continue; }
        const startOffset = (args.offsets as Record<string, number> | undefined)?.[String(unit)] ?? 0;
        if (startOffset > value.text.length) throw new Error('Invalid cloud unit offset.');
        const text = value.text.slice(startOffset, startOffset + maxChars - scannedChars), completeUnit = startOffset === 0 && text.length === value.text.length;
        scannedChars += text.length;
        if (completeUnit) readUnits.push(unit);
        if (text) chunks.push({ sourceId: snapshot.sourceId, path: snapshot.path, version: snapshot.version, unit, text, startOffset, endOffset: startOffset + text.length, completeUnit,
          locator: value.locator ?? `${snapshot.path}#${snapshot.unitLabel}=${unit}` });
        if (startOffset + text.length < value.text.length) break;
      }
      const pendingUnits = Array.from({ length: snapshot.totalUnits }, (_, i) => i + 1).filter(unit => !readUnits.includes(unit));
      const result = { snapshot, chunks, readUnits, pendingUnits, unreadableUnits, complete: pendingUnits.length === 0, scannedChars };
      const prior = evidence.get(snapshot.path); evidence.set(snapshot.path, prior?.snapshot.version === snapshot.version ? { ...result, chunks: [...prior.chunks, ...chunks] } : result);
      await assertCurrent(signal); return result;
    } finally { await opened.close(); }
  }
  async function parent(args: Record<string, unknown>, signal?: AbortSignal) {
    const ref = await find(args.parentPath as string, signal), current = await resource(ref, signal);
    if (current.kind !== 'pdf' || args.expectedVersion && await cloudHarnessResourceVersion(current, signal) !== args.expectedVersion) throw new Error('Cloud parent must be the authorized current PDF revision.');
    return current;
  }
  async function pdfProposal(current: CloudLibraryResource, args: Record<string, unknown>, signal?: AbortSignal, expectedChild?: { itemId: string; versionId: string }) {
    const prior = evidence.get(current.id);
    if (!prior?.chunks.some(chunk => chunk.text.trim()) || prior.snapshot.version !== await cloudHarnessResourceVersion(current, signal)) throw new Error('Read the actual cloud PDF before proposing its child.');
    const children = await provider!.list(current.libraryId, current.itemId, signal); await assertCurrent(signal);
    const matches = children.filter(item => item.libraryId === current.libraryId && item.status === 'active' && item.canonicalName === args.fileName);
    if (matches.length > 1) throw new Error('Cloud child name is ambiguous; select a unique child.');
    const proposal = await prepareCloudPdfChildProposal({ provider: provider!, parent: current, fileName: args.fileName as string, content: args.content as string,
      mode: args.mode as 'create' | 'update', childItemId: args.mode === 'update' ? matches[0]?.id : undefined, signal,
      isCurrent: () => input.getProvider() === provider && (!input.isCurrent || input.isCurrent()) });
    if (expectedChild && (proposal.child?.itemId !== expectedChild.itemId || proposal.child.versionId !== expectedChild.versionId)) throw new Error('云批注文件在读取后已改变，请重新读取并审查。');
    await assertCurrent(signal);
    return publishHarnessDraft(input.onDraft, { type: 'paper_note', title: proposal.fileName, content: args.content as string, contentFormat: 'raw',
      targetPath: proposal.targetPath, writeMode: proposal.mode, sourceRefs: [{ kind: 'file', label: current.name, locator: current.id, cloudIdentity: prior.snapshot.cloudIdentity }], cloudPdfChildProposal: proposal }, signal);
  }
  return { assertCurrent, async execute(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (name === 'lattice.sources.list') return list(args, signal);
    if (name === 'lattice.sources.active') {
      const active = input.getActiveResource?.(); if (!active) throw new Error('No captured active cloud source.'); return read(active.id, args, signal);
    }
    if (name === 'lattice.sources.read') return read(args.path as string, args, signal);
    if (name === 'lattice.sources.search') {
      const query = (args.query as string).trim().toLocaleLowerCase(); if (!query) throw new Error('Source search requires a query.');
      const page = await list({ cursor: args.cursor, limit: Math.min(Number(args.maxFiles ?? 32), 500) }, signal);
      let chars = Math.min(Number(args.maxChars ?? 180_000), 1_000_000), units = Math.min(Number(args.maxUnits ?? 512), 4096), cursor = Number(args.cursor ?? 0);
      const reads: AgentSourceRead[] = [], invalid: Array<{ path: string; reason: string }> = [];
      for (const entry of page.entries) {
        if (chars < 1 || units < 1) break;
        cursor++; if (!entry.supported) continue;
        try { const value = await read(entry.path, { maxChars: chars, maxUnits: units }, signal); reads.push(value); chars -= value.scannedChars;
          units -= value.readUnits.length + value.unreadableUnits.length + value.chunks.filter(chunk => !chunk.completeUnit).length; }
        catch (error) { signal?.throwIfAborted(); await assertCurrent(signal); invalid.push({ path: entry.path, reason: error instanceof Error ? error.message : String(error) }); }
      }
      const complete = page.complete && cursor >= Number(args.cursor ?? 0) + page.entries.length && reads.every(value => value.complete) && !invalid.length;
      return { reads, hits: reads.flatMap(value => value.chunks.filter(chunk => chunk.text.toLocaleLowerCase().includes(query))), invalid, complete,
        ...(!complete ? { nextCursor: cursor } : {}), scannedFiles: reads.length, scannedChars: reads.reduce((sum, value) => sum + value.scannedChars, 0) };
    }
    if (name === 'lattice.pdf.listChildren') {
      const current = await parent(args, signal), items = await provider!.list(current.libraryId, current.itemId, signal); await assertCurrent(signal);
      const allowed = items.filter(item => item.libraryId === current.libraryId && item.status === 'active' && item.metadata.parentItemId === current.itemId);
      const page = harnessPage(allowed, args), refs: Reference[] = [];
      for (const item of page.entries) refs.push(await reference(current.libraryId, item.id, item, signal));
      return { parent: { path: current.id, version: await cloudHarnessResourceVersion(current, signal) }, ...page, entries: refs.map(ref => ({ ...ref, path: ref.id })) };
    }
    if (name === 'lattice.pdf.readAnnotations') {
      const current = await parent(args, signal);
      const parentVersion = await cloudHarnessResourceVersion(current, signal);
      const invalid = provider!.annotations ? [] : [{ path: current.id, reason: 'cloud_annotation_read_bridge_unavailable' }];
      const annotations = provider!.annotations ? await provider!.annotations(current.libraryId, current.itemId, signal) : []; await assertCurrent(signal);
      const page = harnessPage(annotations.filter(annotation => annotation.itemId === current.itemId && annotation.status !== 'deleted'), args);
      const maxChars = Math.min(Number(args.maxChars ?? 60_000), 400_000), result: unknown[] = []; let chars = 0;
      for (const annotation of page.entries) {
        const size = JSON.stringify(annotation).length; if (chars + size > maxChars) break; chars += size;
        result.push({ annotation, version: annotation.revision, versionId: annotation.versionId, locator: `${current.id}#annotation=${encodeURIComponent(annotation.id)}` });
      }
      const children = await provider!.list(current.libraryId, current.itemId, signal); await assertCurrent(signal);
      const matches = children.filter(item => item.libraryId === current.libraryId && item.status === 'active' && item.metadata.parentItemId === current.itemId && item.canonicalName === '_annotations.md');
      if (matches.length > 1) throw new Error('Cloud annotation-note name is ambiguous.');
      let annotationNote: { path: string; locator: string; versionId?: string; version: string; text: string; complete: boolean } | undefined;
      if (matches[0]) {
        const ref = await reference(current.libraryId, matches[0].id, matches[0], signal), note = await resource(ref, signal);
        if (note.content?.kind !== 'text' || note.content.text.length > 1_000_000) invalid.push({ path: note.id, reason: 'cloud_annotation_note_unreadable' });
        else annotationNote = { path: note.id, locator: note.id, versionId: note.versionId, version: await cloudHarnessResourceVersion(note, signal),
          text: note.content.text.slice(0, Math.max(0, maxChars - chars)), complete: note.content.text.length <= maxChars - chars };
      }
      const fresh = await resource({ id: current.id, libraryId: current.libraryId, itemId: current.itemId }, signal);
      if (fresh.role !== current.role || await cloudHarnessResourceVersion(fresh, signal) !== parentVersion) throw new Error('Cloud PDF revision or permission changed during annotation read.');
      const complete = page.complete && result.length === page.entries.length && !invalid.length && (!annotationNote || annotationNote.complete);
      return { parent: { path: current.id, version: parentVersion }, entries: result, complete, invalid, scannedChars: chars + (annotationNote?.text.length ?? 0),
        ...(annotationNote ? { annotationNote } : {}),
        ...(!complete ? { nextCursor: Number(args.cursor ?? 0) + result.length } : {}) };
    }
    if (name === 'lattice.pdf.proposeChild') return pdfProposal(await parent(args, signal), args, signal);
    if (name === 'lattice.pdf.proposeAnnotations') {
      const current = await parent(args, signal), prior = evidence.get(current.id);
      if (!prior || prior.snapshot.version !== await cloudHarnessResourceVersion(current, signal)) throw new Error('Read the actual cloud PDF pages before proposing annotations.');
      const children = await provider!.list(current.libraryId, current.itemId, signal); await assertCurrent(signal);
      const candidates = children.filter(item => item.libraryId === current.libraryId && item.metadata.parentItemId === current.itemId
        && item.status === 'active' && item.canonicalName === '_annotations.md');
      if (candidates.length > 1) throw new Error('Cloud annotation-note name is ambiguous.');
      let previous = '', expectedChild: { itemId: string; versionId: string } | undefined;
      if (candidates[0]) {
        const ref = await reference(current.libraryId, candidates[0].id, candidates[0], signal), note = await resource(ref, signal);
        if (note.content?.kind !== 'text' || note.content.text.length > 400_000) throw new Error('Cloud annotation-note content is not readable within budget.');
        previous = note.content.text;
        if (!note.versionId) throw new Error('Cloud annotation-note has no stable version.');
        expectedChild = { itemId: note.itemId, versionId: note.versionId };
      }
      return pdfProposal(current, { fileName: '_annotations.md', mode: candidates[0] ? 'update' : 'create', content: appendVerifiedAnnotationDrafts(previous, args.annotations as HarnessAnnotationIntent[], prior) }, signal, expectedChild);
    }
    if (name === 'lattice.workspace.proposeWrite') {
      const current = await resource(await find(args.targetPath as string, signal), signal);
      if (current.content?.kind === 'text' && current.content.text.length > 400_000) throw new Error('Cloud review content exceeds budget.');
      const proposal = await prepareCloudFileProposal({ provider: provider!, resource: current, content: args.content as string, mode: args.mode as 'create' | 'update',
        fileName: args.fileName as string | undefined, expectedVersion: args.expectedVersion as string | undefined, signal,
        isCurrent: () => input.getProvider() === provider && (!input.isCurrent || input.isCurrent()) });
      await assertCurrent(signal);
      return publishHarnessDraft(input.onDraft, { type: 'code_explainer', title: proposal.fileName, content: proposal.content, contentFormat: 'raw', targetPath: proposal.targetPath,
        writeMode: proposal.mode, cloudFileProposal: proposal, sourceRefs: [{ kind: 'file', label: current.name, locator: current.id, cloudIdentity: proposal.resource }],
        fileChange: { targetPath: proposal.targetPath, expectedContent: current.content?.kind === 'text' ? current.content.text : undefined, workspaceKey: proposal.workspaceKey } }, signal);
    }
    throw new Error('Unknown cloud Lattice tool.');
  } };
}
