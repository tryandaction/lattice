import { beforeEach, expect, it, vi } from 'vitest';
import { createLatticeHarnessToolRuntime } from '../lattice-source-tools';
import { createAuthorizedSourceIndex } from '../../source-index';
import { SourceTestDirectory, SourceTestFile } from '../../__tests__/fixtures/source-workspace';
import { writeDraftArtifactToTarget } from '../../workbench-actions';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { AiDraftArtifact } from '../../types';
import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
import type { Annotation, Item } from '@/lib/shared-library/domain';
import type { SharedLibraryItemContent } from '@/lib/shared-library/content-store';
import { applyReviewedCloudFileProposal, cloudFileProposalApproval } from '../cloud-file-proposal';
import { LATTICE_HARNESS_DYNAMIC_TOOLS, harnessToolNameToLattice } from '../tool-broker';

vi.mock('@/lib/pdf-js-document-loader', () => ({ loadPdfJsDocument: async () => ({ numPages: 1, destroy: async () => {} }) }));
vi.mock('@/lib/pdf-page-text-cache', () => ({ getPdfPageSearchText: async () => 'Verified PDF quotation.' }));
type Draft = Omit<AiDraftArtifact, 'id' | 'createdAt' | 'status'>;
beforeEach(() => useWorkspaceStore.setState({ rootHandle: null }));
function local(root: SourceTestDirectory, onDraft?: (draft: Draft) => string) {
  return createLatticeHarnessToolRuntime({ kind: 'local', root: root.handle(), workspaceKey: 'A',
    index: createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: '' }] }),
    getActivePath: () => 'note.md', onDraft });
}

it('registers the same 12 concrete Lattice tools under stable Harness-safe names', () => {
  expect(LATTICE_HARNESS_DYNAMIC_TOOLS).toHaveLength(12);
  for (const tool of LATTICE_HARNESS_DYNAMIC_TOOLS) expect(harnessToolNameToLattice(tool.name)).toBe(tool.name.replace(/_/gu, '.'));
  expect(() => harnessToolNameToLattice('lattice_sources_eraseWorkspace')).toThrow(/未声明/u);
});

it('reads the exact captured active source with versions and paged evidence', async () => {
  const root = new SourceTestDirectory('workspace'); root.add(new SourceTestFile('note.md', '# First\nalpha\n# Second\nbeta'));
  root.add(new SourceTestFile('unrelated.md', 'wrong context'));
  const runtime = local(root);
  const read = await runtime.execute('lattice.sources.active', { maxUnits: 1 });
  expect(read).toMatchObject({ snapshot: { path: 'note.md' }, complete: false, pendingUnits: [2] });
  expect(JSON.stringify(read)).toContain('alpha'); expect(JSON.stringify(read)).not.toContain('wrong context');
  const page = await runtime.execute('lattice.sources.list', { limit: 1 });
  expect(page).toMatchObject({ nextCursor: 1, complete: false });
  await expect(runtime.execute('lattice.sources.read', { path: 'note.md', expectedVersion: 'stale' })).rejects.toThrow(/changed|改变/i);
});

it('rejects a source read whose workspace changes while file bytes are loading and allows retry in the original scope', async () => {
  const root = new SourceTestDirectory('workspace');
  const file = root.add(new SourceTestFile('note.md', 'captured private source'));
  let current = true;
  const getFile = file.getFile.bind(file);
  file.getFile = async () => { const value = await getFile(); current = false; return value; };
  const runtime = createLatticeHarnessToolRuntime({ kind: 'local', root: root.handle(), workspaceKey: 'A',
    index: createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'file', path: 'note.md' }] }),
    isCurrent: () => current });
  await expect(runtime.execute('lattice.sources.read', { path: 'note.md' })).rejects.toThrow(/scope changed/);
  current = true; file.getFile = getFile;
  expect(JSON.stringify(await runtime.execute('lattice.sources.read', { path: 'note.md' }))).toContain('captured private source');
  expect(file.writes).toBe(0);
});

it('makes concrete code and Notebook review drafts without any writes, then reuses Workbench apply', async () => {
  const root = new SourceTestDirectory('workspace'), old = root.add(new SourceTestFile('note.md', '# Original'));
  const drafts: Draft[] = []; const runtime = local(root, draft => { drafts.push(draft); return 'review-1'; });
  const result = await runtime.execute('lattice.workspace.proposeWrite', { targetPath: 'note.md', content: '# Revised', mode: 'update' });
  expect(result).toMatchObject({ status: 'pending-review', artifactId: 'review-1' });
  expect(drafts[0]).toMatchObject({ contentFormat: 'raw', content: '# Revised', fileChange: { expectedContent: '# Original', workspaceKey: 'A' } });
  expect(old.content).toBe('# Original'); expect(old.writes).toBe(0);
  await runtime.execute('lattice.workspace.proposeWrite', { targetPath: 'analysis.py', content: 'print(2 + 2)\n', mode: 'create' });
  await runtime.execute('lattice.workspace.proposeWrite', { targetPath: 'lab.ipynb', content: '{"nbformat":4,"nbformat_minor":5,"metadata":{},"cells":[]}', mode: 'create' });
  expect(root.entries.has('analysis.py')).toBe(false); expect(root.entries.has('lab.ipynb')).toBe(false);
  await writeDraftArtifactToTarget(root.handle(), { ...drafts[0], createdAt: 1 }, { workspaceKey: 'A', writeMode: 'update' });
  expect(old.content).toBe('# Revised'); expect(old.writes).toBe(1);
});

it('propagates a failed review handoff, retries, and preserves an external edit until the proposal is regenerated', async () => {
  const root = new SourceTestDirectory('workspace');
  const original = root.add(new SourceTestFile('note.md', '# Original'));
  const drafts: Draft[] = []; let rejectHandoff = true;
  const runtime = local(root, draft => {
    if (rejectHandoff) { rejectHandoff = false; throw new Error('review persistence unavailable'); }
    drafts.push(draft); return 'retry-review';
  });
  const args = { targetPath: 'note.md', content: '# Revised', mode: 'update' };
  await expect(runtime.execute('lattice.workspace.proposeWrite', args)).rejects.toThrow('review persistence unavailable');
  expect(original.content).toBe('# Original'); expect(drafts).toHaveLength(0);
  expect(await runtime.execute('lattice.workspace.proposeWrite', args)).toMatchObject({ status: 'pending-review', artifactId: 'retry-review' });
  original.content = '# External edit';
  await expect(writeDraftArtifactToTarget(root.handle(), { ...drafts[0], createdAt: 1 }, { workspaceKey: 'A', writeMode: 'update' })).rejects.toThrow();
  expect(original.content).toBe('# External edit'); expect(original.writes).toBe(0);
  await runtime.execute('lattice.workspace.proposeWrite', args);
  expect(drafts[1].fileChange?.expectedContent).toBe('# External edit');
  await writeDraftArtifactToTarget(root.handle(), { ...drafts[1], createdAt: 2 }, { workspaceKey: 'A', writeMode: 'update' });
  expect(original.content).toBe('# Revised'); expect(original.writes).toBe(1);
});

it('rejects traversal, private state, invalid Notebook and stale or unselected edits before review', async () => {
  const root = new SourceTestDirectory('workspace'); root.add(new SourceTestFile('note.md', '# Original')); root.add(new SourceTestFile('private.md', 'secret'));
  const onDraft = vi.fn(() => 'draft'); const runtime = createLatticeHarnessToolRuntime({ kind: 'local', root: root.handle(), workspaceKey: 'A',
    index: createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'file', path: 'note.md' }] }), onDraft });
  for (const targetPath of ['../escape.md', '.lattice/config.json', 'private.md']) {
    await expect(runtime.execute('lattice.workspace.proposeWrite', { targetPath, content: 'change', mode: 'update' })).rejects.toThrow();
  }
  await expect(runtime.execute('lattice.workspace.proposeWrite', { targetPath: 'lab.ipynb', content: '{}', mode: 'create' })).rejects.toThrow(/Notebook/);
  await expect(runtime.execute('lattice.workspace.proposeWrite', { targetPath: 'note.md', expectedVersion: 'old', content: 'new', mode: 'update' })).rejects.toThrow(/changed|改变/i);
  expect(onDraft).not.toHaveBeenCalled();
  root.permission = 'denied'; await expect(runtime.execute('lattice.workspace.proposeWrite', { targetPath: 'new.md', content: 'new', mode: 'create' })).rejects.toThrow(/permission|权限/i);
});

it('reads stable PDF children and existing sidecar evidence without creating or migrating files', async () => {
  const root = new SourceTestDirectory('workspace'); root.add(new SourceTestFile('paper.pdf', '%PDF'));
  const lattice = root.add(new SourceTestDirectory('.lattice')), item = lattice.add(new SourceTestDirectory('items')).add(new SourceTestDirectory('stable-item'));
  item.add(new SourceTestFile('manifest.json', JSON.stringify({ version: 4, itemId: 'stable-id', pdfPath: 'paper.pdf', itemFolderPath: '.lattice/items/stable-item', annotationIndexPath: '.lattice/items/stable-item/_annotations.md', knownPdfPaths: ['paper.pdf'], createdAt: 1, updatedAt: 1 })));
  const note = item.add(new SourceTestFile('child.md', '# Child evidence'));
  const annotations = lattice.add(new SourceTestDirectory('annotations'));
  const sidecar = annotations.add(new SourceTestFile('stable-id.json', JSON.stringify({ version: 3, documentId: 'stable-id', fileId: 'stable-id', fileType: 'pdf', lastModified: 1, annotations: [{ id: 'ann-1', target: { type: 'pdf', page: 1, rects: [{ x1: .1, y1: .1, x2: .2, y2: .2 }] }, style: { color: '#FFD400', type: 'highlight' }, author: 'user', createdAt: 1 }] })));
  const runtime = local(root);
  const children = await runtime.execute('lattice.pdf.listChildren', { parentPath: 'paper.pdf', limit: 1 });
  expect(children).toMatchObject({ parentItemId: 'stable-id', entries: [{ path: '.lattice/items/stable-item/child.md' }] });
  expect(JSON.stringify(await runtime.execute('lattice.sources.read', { path: '.lattice/items/stable-item/child.md' }))).toContain('Child evidence');
  const read = await runtime.execute('lattice.pdf.readAnnotations', { parentPath: 'paper.pdf' });
  expect(JSON.stringify(read)).toContain('ann-1'); expect(JSON.stringify(read)).toContain('stable-id.json');
  expect(note.writes).toBe(0); expect(sidecar.writes).toBe(0);
  const bounded = await runtime.execute('lattice.pdf.readAnnotations', { parentPath: 'paper.pdf', maxChars: 1 });
  expect(bounded).toMatchObject({ complete: false });
});

it('proposes exact-quote PDF annotation drafts preserving existing content and does not invent geometry', async () => {
  const root = new SourceTestDirectory('workspace'); root.add(new SourceTestFile('paper.pdf', '%PDF'));
  const drafts: Draft[] = [], runtime = local(root, draft => { drafts.push(draft); return 'pdf-review'; });
  await runtime.execute('lattice.sources.read', { path: 'paper.pdf' });
  await runtime.execute('lattice.pdf.proposeAnnotations', { parentPath: 'paper.pdf', annotations: [{ page: 1, quote: 'Verified PDF quotation.', type: 'highlight', comment: 'Check this argument' }] });
  expect(drafts[0].content).toContain('Quote: Verified PDF quotation.'); expect(drafts[0].content).toContain('AI批注');
  expect(drafts[0].pdfChildTarget?.parentItemId).toBeTruthy(); expect(root.entries.has('.lattice')).toBe(false);
  await expect(runtime.execute('lattice.pdf.proposeAnnotations', { parentPath: 'paper.pdf', annotations: [{ page: 1, quote: 'invented quotation', type: 'highlight' }] })).rejects.toThrow(/quote|引文|正文/i);
});
it('proposes a PDF research code child for review through the same stable child service', async () => {
  const root = new SourceTestDirectory('workspace'); root.add(new SourceTestFile('paper.pdf', '%PDF'));
  const drafts: Draft[] = [], runtime = local(root, draft => { drafts.push(draft); return 'code-child'; });
  await runtime.execute('lattice.sources.read', { path: 'paper.pdf' });
  await runtime.execute('lattice.pdf.proposeChild', { parentPath: 'paper.pdf', fileName: 'analysis.py', content: 'values = [1, 2, 3]\nprint(sum(values))\n', mode: 'create' });
  expect(drafts[0]).toMatchObject({ title: 'analysis.py', writeMode: 'create' });
  expect(drafts[0].pdfChildTarget?.parentItemId).toBeTruthy(); expect(root.entries.has('.lattice')).toBe(false);
});

it('provides executable skill contracts and bounded numeric computation without arbitrary code', async () => {
  const runtime = local(new SourceTestDirectory('workspace'));
  const skill = await runtime.execute('lattice.skills.get', { id: 'pdf-annotation' });
  expect(JSON.stringify(skill)).toContain('pdf-annotation-sidecar'); expect(JSON.stringify(skill)).toContain('lattice.pdf.proposeAnnotations');
  expect((skill as { tools: Array<{ name: string; parameters: unknown }> }).tools.find(tool => tool.name === 'lattice.pdf.proposeAnnotations')?.parameters).toBeTruthy();
  expect(await runtime.execute('lattice.compute.evaluate', { expression: 'sqrt(9) + 2 * (3 + 4)' })).toMatchObject({ value: 17, engine: 'bounded-math' });
  for (const expression of ['globalThis.process.exit()', 'fetch("https://host")', '2 ** 999999', '1 / 0', '('.repeat(80) + '1' + ')'.repeat(80)]) {
    await expect(runtime.execute('lattice.compute.evaluate', { expression })).rejects.toThrow();
  }
  await expect(runtime.execute('lattice.workspace.apply', {})).rejects.toThrow();
});

function cloud() {
  const values = new Map<string, CloudLibraryResource>();
  values.set('note', { id: 'cloud:real:note', libraryId: 'lib', itemId: 'note', name: 'note.md', path: 'cloud://display', kind: 'markdown', role: 'editor', versionId: 'v1', content: { kind: 'text', text: '# Real cloud text', mimeType: 'text/markdown', updatedAt: 'now' } });
  const save = vi.fn(async (_library: string, item: string, content: CloudLibraryResource['content']) => { values.set(item, { ...values.get(item)!, content, versionId: 'v2' }); });
  const provider: CloudLibrarySourceProvider = { scope: 'account-A', list: async () => [], read: async (_library, item) => { if (!values.has(item)) throw new Error('missing'); return values.get(item)!; }, search: async () => ({ results: [] }), save };
  return { values, provider, save };
}
it('uses real cloud resource IDs for active reads and review-only versioned edits', async () => {
  const { values, provider, save } = cloud(); const drafts: Draft[] = [];
  const runtime = createLatticeHarnessToolRuntime({ kind: 'cloud', getProvider: () => provider, selections: [{ kind: 'file', libraryId: 'lib', itemId: 'note' }],
    getActiveResource: () => values.get('note')!, onDraft: draft => { drafts.push(draft); return 'cloud-review'; } });
  const read = await runtime.execute('lattice.sources.active', {});
  expect(read).toMatchObject({ snapshot: { path: 'cloud:real:note', cloudIdentity: { itemId: 'note', versionId: 'v1' } }, chunks: [{ text: '# Real cloud text' }] });
  await runtime.execute('lattice.workspace.proposeWrite', { targetPath: 'cloud:real:note', content: '# Updated', mode: 'update' });
  expect(drafts[0].cloudFileProposal).toMatchObject({ resource: { resourceId: 'cloud:real:note', versionId: 'v1' } });
  expect(save).not.toHaveBeenCalled();
  const proposal = drafts[0].cloudFileProposal!;
  await applyReviewedCloudFileProposal({ provider, proposal, approval: cloudFileProposalApproval(proposal) });
  expect(values.get('note')!.content).toMatchObject({ text: '# Updated' });
});

it('rejects cloud provider/account drift, revoked role, stale review and local display paths', async () => {
  const { values, provider, save } = cloud(); let selectedProvider: CloudLibrarySourceProvider | null = provider;
  const drafts: Draft[] = [], runtime = createLatticeHarnessToolRuntime({ kind: 'cloud', getProvider: () => selectedProvider,
    selections: [{ kind: 'file', libraryId: 'lib', itemId: 'note' }], getActiveResource: () => values.get('note')!, onDraft: draft => { drafts.push(draft); return 'review'; } });
  await runtime.execute('lattice.sources.active', {});
  await expect(runtime.execute('lattice.sources.read', { path: 'cloud://display' })).rejects.toThrow();
  await runtime.execute('lattice.workspace.proposeWrite', { targetPath: 'cloud:real:note', content: 'new', mode: 'update' });
  const proposal = drafts[0].cloudFileProposal!; values.set('note', { ...values.get('note')!, versionId: 'external' });
  await expect(applyReviewedCloudFileProposal({ provider, proposal, approval: cloudFileProposalApproval(proposal) })).rejects.toThrow(/版本|revision|改变/i);
  values.set('note', { ...values.get('note')!, role: 'viewer' });
  await expect(runtime.execute('lattice.workspace.proposeWrite', { targetPath: 'cloud:real:note', content: 'new', mode: 'update' })).rejects.toThrow();
  selectedProvider = { ...provider, scope: 'account-B' }; await expect(runtime.execute('lattice.sources.active', {})).rejects.toThrow(/scope|账号|范围/i);
  expect(save).not.toHaveBeenCalled();
});

it('creates ordinary cloud files only as authorized folder review drafts and rejects altered proposals', async () => {
  const folder: CloudLibraryResource = { id: 'cloud:real:folder', libraryId: 'lib', itemId: 'folder', name: 'Research', kind: 'folder', path: 'cloud://folder-display', role: 'editor', versionId: 'folder-v1', content: null };
  const values = new Map<string, CloudLibraryResource>([['folder', folder]]);
  let createdAgainst: string | undefined;
  const createItem = vi.fn(async (input: { libraryId: string; parentItemId: string; name: string; kind: Item['kind'] }, content: SharedLibraryItemContent,
    _signal?: AbortSignal, expectedParentVersion?: string) => {
    createdAgainst = expectedParentVersion;
    const item: Item = { id: 'created', libraryId: input.libraryId, title: input.name, canonicalName: input.name, kind: input.kind, status: 'active',
      metadata: { parentItemId: input.parentItemId }, createdBy: 'test-user', createdAt: 'now', updatedAt: 'now' };
    values.set(item.id, { ...folder, id: 'cloud:real:created', itemId: item.id, name: input.name, kind: input.kind, content, versionId: 'v1' });
    return item;
  });
  const provider: CloudLibrarySourceProvider = { scope: 'account', read: async (_lib: string, id: string) => {
    const value = values.get(id); if (!value) throw new Error('missing'); return value;
  }, list: async (): Promise<Item[]> => [], search: async () => ({ results: [] }), save: async () => {}, createItem };
  const drafts: Draft[] = [], runtime = createLatticeHarnessToolRuntime({ kind: 'cloud', getProvider: () => provider, selections: [{ kind: 'folder', libraryId: 'lib', itemId: 'folder' }],
    getActiveResource: () => folder, onDraft: draft => { drafts.push(draft); return 'create-review'; } });
  await runtime.execute('lattice.workspace.proposeWrite', { targetPath: folder.id, fileName: 'study.py', content: 'print(17)\n', mode: 'create' });
  expect(createItem).not.toHaveBeenCalled();
  const proposal = drafts[0].cloudFileProposal!;
  await expect(applyReviewedCloudFileProposal({ provider, proposal: { ...proposal, content: 'malicious replacement' }, approval: cloudFileProposalApproval(proposal) })).rejects.toThrow(/审查/);
  await expect(writeDraftArtifactToTarget(new SourceTestDirectory('local').handle(), { ...drafts[0], createdAt: 1 }, { workspaceKey: 'A' })).rejects.toThrow(/云/);
  await applyReviewedCloudFileProposal({ provider, proposal, approval: cloudFileProposalApproval(proposal) });
  expect(createdAgainst).toBe('folder-v1');
  expect(values.get('created')?.content).toMatchObject({ text: 'print(17)\n' });
});

it('reads cloud PDF children and annotations with real identities and preserves existing annotation drafts', async () => {
  const parent: CloudLibraryResource = { id: 'cloud:real:pdf', libraryId: 'lib', itemId: 'pdf', name: 'paper.pdf', kind: 'pdf', role: 'editor', versionId: 'pdf-v1', path: 'cloud://paper', content: { kind: 'binary', data: new TextEncoder().encode('%PDF').buffer, mimeType: 'application/pdf', updatedAt: 'now' } };
  const previous = '# Human notes\nKeep this paragraph.\n\n<!-- lattice-pdf-annotation-drafts:begin -->\n<!-- lattice-pdf-annotation id="ann-existing" page="1" type="underline" color="#FFD400" -->\n- Quote: Old exact quote\n- Tags: Human\n\n<!-- lattice-pdf-annotation-drafts:end -->';
  const child: CloudLibraryResource = { ...parent, id: 'cloud:real:annotations', itemId: 'annotations', name: '_annotations.md', kind: 'markdown', versionId: 'child-v1', content: { kind: 'text', text: previous, mimeType: 'text/markdown', updatedAt: 'now' } };
  const save = vi.fn<CloudLibrarySourceProvider['save']>(async () => {}), createChild = vi.fn<NonNullable<CloudLibrarySourceProvider['createChild']>>(async () => ({ id: 'unused' } as Item));
  const onDraft = vi.fn((draft: Draft) => { void draft; return 'annotation-review'; });
  const childItem: Item = { id: 'annotations', libraryId: 'lib', title: '_annotations.md', canonicalName: '_annotations.md', kind: 'markdown', currentVersionId: 'child-v1',
    status: 'active', metadata: { parentItemId: 'pdf' }, createdBy: 'test-user', createdAt: 'now', updatedAt: 'now' };
  const annotation: Annotation = { id: 'ann-cloud', itemId: 'pdf', versionId: 'pdf-v1', authorId: 'test-user', kind: 'comment',
    target: { locatorType: 'pdf-page', locator: { page: 1 } }, style: {}, body: { text: 'Existing cloud comment' }, status: 'active', revision: 4, createdAt: 'now', updatedAt: 'now' };
  const provider: CloudLibrarySourceProvider = { scope: 'account', resourceIdentity: (_lib, id) => id === 'pdf' ? parent.id : child.id, read: async (_lib, id) => id === 'pdf' ? parent : child,
    list: async (_lib, id) => id === 'pdf' ? [childItem] : [],
    search: async () => ({ results: [] }), save, createChild,
    annotations: async (): Promise<Annotation[]> => [annotation] };
  const runtime = createLatticeHarnessToolRuntime({ kind: 'cloud', getProvider: () => provider, selections: [{ kind: 'file', libraryId: 'lib', itemId: 'pdf' }], getActiveResource: () => parent, onDraft });
  const children = await runtime.execute('lattice.pdf.listChildren', { parentPath: parent.id });
  expect(children).toMatchObject({ entries: [{ path: child.id }] });
  expect(JSON.stringify(await runtime.execute('lattice.sources.read', { path: child.id }))).toContain('Keep this paragraph.');
  const annotations = await runtime.execute('lattice.pdf.readAnnotations', { parentPath: parent.id });
  expect(JSON.stringify(annotations)).toContain('ann-cloud'); expect(JSON.stringify(annotations)).toContain('child-v1');
  expect(JSON.stringify(annotations)).toContain('ann-existing');
  await runtime.execute('lattice.sources.active', {});
  await runtime.execute('lattice.pdf.proposeAnnotations', { parentPath: parent.id, annotations: [{ page: 1, quote: 'Verified PDF quotation.', type: 'highlight' }] });
  expect(onDraft.mock.calls[0][0].content).toContain('Keep this paragraph.'); expect(onDraft.mock.calls[0][0].content).toContain('ann-existing');
  expect(onDraft.mock.calls[0][0].cloudPdfChildProposal).toMatchObject({ mode: 'update', child: { versionId: 'child-v1', resourceId: child.id } });
  expect(save).not.toHaveBeenCalled(); expect(createChild).not.toHaveBeenCalled();
});

it('fails closed on cancellation or unavailable review and does not create local PDF sidecars during reads', async () => {
  const root = new SourceTestDirectory('workspace'); root.add(new SourceTestFile('paper.pdf', '%PDF'));
  const onDraft = vi.fn(() => 'draft'), runtime = local(root, onDraft), controller = new AbortController();
  await runtime.execute('lattice.pdf.readAnnotations', { parentPath: 'paper.pdf' });
  expect(root.entries.has('.lattice')).toBe(false);
  controller.abort(); await expect(runtime.execute('lattice.workspace.proposeWrite', { targetPath: 'new.md', content: 'new', mode: 'create' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(local(root).execute('lattice.workspace.proposeWrite', { targetPath: 'new.md', content: 'new', mode: 'create' })).rejects.toThrow(/review|审查/i);
  expect(onDraft).not.toHaveBeenCalled(); expect(root.entries.has('new.md')).toBe(false);
});
it('rejects annotation-note edits between preserving the original text and capturing the proposal', async () => {
  const root = new SourceTestDirectory('workspace'); root.add(new SourceTestFile('paper.pdf', '%PDF'));
  const item = root.add(new SourceTestDirectory('.lattice')).add(new SourceTestDirectory('items')).add(new SourceTestDirectory('stable-item'));
  item.add(new SourceTestFile('manifest.json', JSON.stringify({ version: 4, itemId: 'stable-id', pdfPath: 'paper.pdf', itemFolderPath: '.lattice/items/stable-item', annotationIndexPath: '.lattice/items/stable-item/_annotations.md', fileFingerprint: null, versionFingerprint: null, knownPdfPaths: ['paper.pdf'], createdAt: 1, updatedAt: 1 })));
  const note = item.add(new SourceTestFile('_annotations.md', '# Original annotations'));
  const getFile = note.getFile.bind(note); note.getFile = async () => { const file = await getFile(); if (note.reads === 1) note.content = '# Collaborator changes'; return file; };
  const onDraft = vi.fn(() => 'review'), runtime = local(root, onDraft);
  await runtime.execute('lattice.sources.read', { path: 'paper.pdf' });
  await expect(runtime.execute('lattice.pdf.proposeAnnotations', { parentPath: 'paper.pdf', annotations: [{ page: 1, quote: 'Verified PDF quotation.', type: 'highlight' }] })).rejects.toThrow(/改变|changed/i);
  expect(onDraft).not.toHaveBeenCalled(); expect(note.writes).toBe(0);
});
