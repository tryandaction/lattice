import { createLatticeSourcePdfToolRuntime } from '../lattice-skills/source-pdf-tool-runtime';
import { LATTICE_SKILL_REGISTRY } from '../lattice-skills/skill-registry';
import { listLatticeOperationContracts } from '../lattice-skills/operation-contract';
import { createAuthorizedSourceIndex, type AuthorizedSourceIndex, type AgentSourceRead, type AgentSourceReadOptions } from '../source-index';
import { preparePdfChildProposal } from '../lattice-skills/pdf-child-skill';
import { listPdfItemNotes, loadPdfItemManifest } from '@/lib/pdf-item';
import { generateFileId, getAnnotationFilePath, deserializeAnnotationFile, resolveAnnotationFileCandidates } from '@/lib/universal-annotation-storage';
import { normalizeWorkspaceWritePath } from '../workbench-actions';
import { LATTICE_HARNESS_TOOLS, validateLatticeHarnessArgs } from './lattice-tool-definitions';
import { evaluateBoundedMath } from './bounded-math';
import { publishHarnessDraft, validateHarnessTextContent, type HarnessDraftHandler } from './tool-draft';
import { appendVerifiedAnnotationDrafts, harnessPage, readExistingHarnessText, type HarnessAnnotationIntent } from './pdf-tool-helpers';
import { createCloudHarnessSourceTools, type CloudHarnessToolInput } from './cloud-source-tools';
import type { PdfChildProposal } from '../lattice-skills/pdf-child-skill';
export { LATTICE_HARNESS_TOOLS } from './lattice-tool-definitions';
export type { HarnessReviewDraft, HarnessDraftHandler } from './tool-draft';
export interface LocalHarnessToolInput {
  kind: 'local'; index: AuthorizedSourceIndex; root: FileSystemDirectoryHandle; workspaceKey: string;
  /** The source captured by request/conversation targeting, not the later active pane. */
  getActivePath?: () => string | null | undefined;
  isCurrent?: () => boolean;
  onDraft?: HarnessDraftHandler;
  onProposal?: (proposal: PdfChildProposal) => void | Promise<void>;
}
export type LatticeHarnessToolInput = LocalHarnessToolInput | CloudHarnessToolInput;
const skillTools: Record<string, string[]> = {
  'path-identity': ['lattice.sources.active', 'lattice.sources.list', 'lattice.pdf.listChildren'],
  'note-taking': ['lattice.sources.read', 'lattice.workspace.proposeWrite'],
  'notebook-analysis': ['lattice.sources.read', 'lattice.compute.evaluate', 'lattice.workspace.proposeWrite'],
  'coding-change-review': ['lattice.sources.read', 'lattice.workspace.proposeWrite'],
  'knowledge-organization': ['lattice.sources.search', 'lattice.sources.read', 'lattice.workspace.proposeWrite'],
  'pdf-item-workspace': ['lattice.pdf.listChildren', 'lattice.sources.read', 'lattice.pdf.proposeChild'],
  'pdf-annotation': ['lattice.pdf.readAnnotations', 'lattice.sources.read', 'lattice.pdf.proposeAnnotations'],
};
function skill(id: string) {
  const descriptor = LATTICE_SKILL_REGISTRY.find(skill => skill.id === id);
  if (!descriptor) throw new Error('Unknown Lattice skill.');
  const executableTools = skillTools[id] ?? [];
  const contracts = listLatticeOperationContracts(descriptor.operationContractIds).map(({ requiredTools, ...contract }) => ({ ...contract, sourceApiTools: requiredTools }));
  return { descriptor: { ...descriptor, allowedTools: executableTools }, executableTools,
    tools: LATTICE_HARNESS_TOOLS.filter(tool => executableTools.includes(tool.name)), contracts,
    boundary: 'Read actual units and preserve returned versions/locators. All writes are pending Workbench user review. No Harness approval/apply tool exists. Notebook scripts use the separate approved runner; bounded math is numeric arithmetic only.' };
}
export function createLatticeHarnessToolRuntime(input: LatticeHarnessToolInput) {
  const source = input.kind === 'cloud' ? createCloudHarnessSourceTools(input) : createLocalTools(input);
  return { tools: LATTICE_HARNESS_TOOLS, async execute(name: string, value: unknown, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const args = validateLatticeHarnessArgs(name, value);
    await source.assertCurrent(signal);
    if (name === 'lattice.skills.list') return { storage: input.kind, skills: LATTICE_SKILL_REGISTRY.map(descriptor => ({ id: descriptor.id, title: descriptor.title, executableTools: skillTools[descriptor.id] ?? [], writesRequireReview: descriptor.writesWorkspace })), tools: LATTICE_HARNESS_TOOLS.map(tool => tool.name) };
    if (name === 'lattice.skills.get') return skill(args.id as string);
    if (name === 'lattice.compute.evaluate') return evaluateBoundedMath(args.expression as string);
    const result = await source.execute(name, args, signal);
    await source.assertCurrent(signal);
    return result;
  } };
}
function createLocalTools(input: LocalHarnessToolInput) {
  const remembered = new Map<string, AgentSourceRead>(), children = new Map<string, { parentPath: string; parentVersion: string; index: AuthorizedSourceIndex }>();
  async function assertCurrent(signal?: AbortSignal) {
    signal?.throwIfAborted(); input.index.assertScope(input.root, input.workspaceKey);
    if (input.isCurrent && !input.isCurrent()) throw new Error('Workspace source scope changed.');
    const query = (input.root as FileSystemDirectoryHandle & { queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState> }).queryPermission;
    if (query && await query.call(input.root, { mode: 'read' }) !== 'granted') throw new Error('Workspace source permission revoked.');
    signal?.throwIfAborted();
  }
  const base = createLatticeSourcePdfToolRuntime({ ...input, onProposal: undefined });
  function remember(read: AgentSourceRead) { const prior = remembered.get(read.snapshot.path); remembered.set(read.snapshot.path, prior?.snapshot.version === read.snapshot.version
    ? { ...read, chunks: [...prior.chunks, ...read.chunks] } : read); return read; }
  async function read(path: string, args: Record<string, unknown>, signal?: AbortSignal) {
    args = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
    const child = children.get(path);
    if (child) {
      await input.index.read({ path: child.parentPath, expectedVersion: child.parentVersion, maxChars: 1, maxUnits: 1, signal });
      return remember(await child.index.read({ ...args, path, signal } as AgentSourceReadOptions));
    }
    return remember(await base.execute('lattice.sources.read', { ...args, path }, signal) as AgentSourceRead);
  }
  async function parent(args: Record<string, unknown>, signal?: AbortSignal) {
    const read = await input.index.read({ path: args.parentPath as string, expectedVersion: args.expectedVersion as string | undefined, maxChars: 1, maxUnits: 1, signal });
    if (read.snapshot.kind !== 'pdf') throw new Error('Parent must be an authorized PDF.');
    const manifest = await loadPdfItemManifest(input.root, generateFileId(read.snapshot.path), read.snapshot.path);
    await assertCurrent(signal); return { snapshot: read.snapshot, manifest };
  }
  async function publishPdf(proposal: PdfChildProposal, signal?: AbortSignal) {
    await assertCurrent(signal);
    if (input.onDraft) return publishHarnessDraft(input.onDraft, { type: 'paper_note', title: proposal.fileName, content: proposal.content, contentFormat: 'raw', sourceRefs: proposal.sourceRefs,
      targetPath: proposal.targetPath, writeMode: proposal.mode, fileChange: { targetPath: proposal.targetPath, expectedContent: proposal.expectedContent, workspaceKey: input.workspaceKey },
      pdfChildTarget: { sourcePath: proposal.parentPath, suggestedTargetPath: proposal.targetPath, workspaceKey: input.workspaceKey, parentItemId: proposal.parentItemId, parentVersion: proposal.parentVersion } }, signal);
    if (!input.onProposal) throw new Error('Workbench review surface is unavailable.');
    await input.onProposal(proposal); return { status: 'pending-review', proposal };
  }
  return { assertCurrent, async execute(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (name === 'lattice.sources.active') {
      const path = input.getActivePath?.(); if (!path) throw new Error('No captured active source; select a source explicitly.'); return read(path, args, signal);
    }
    if (name === 'lattice.sources.read') { const { path, ...options } = args; return read(path as string, options, signal); }
    if (name === 'lattice.sources.search') {
      const result = await base.execute(name, args, signal) as Awaited<ReturnType<AuthorizedSourceIndex['search']>>;
      result.reads.forEach(remember); return result;
    }
    if (name === 'lattice.sources.list') return base.execute(name, args, signal);
    if (name === 'lattice.pdf.listChildren') {
      const { snapshot, manifest } = await parent(args, signal), notes = await listPdfItemNotes(input.root, manifest);
      if (notes.length > 2000) throw new Error('PDF child discovery exceeds entry budget.');
      const entries = notes.map(note => ({ path: note.path, name: note.fileName, kind: note.type, parentItemId: manifest.itemId, supported: note.type !== 'directory' }));
      const page = harnessPage(entries, args);
      for (const note of page.entries) if (note.kind !== 'directory') children.set(note.path, { parentPath: snapshot.path, parentVersion: snapshot.version,
        index: createAuthorizedSourceIndex({ rootHandle: input.root, workspaceKey: input.workspaceKey, selections: [{ kind: 'file', path: note.path }] }) });
      await assertCurrent(signal); return { parentItemId: manifest.itemId, parent: snapshot, ...page };
    }
    if (name === 'lattice.pdf.readAnnotations') {
      const { snapshot, manifest } = await parent(args, signal);
      const candidates = resolveAnnotationFileCandidates(snapshot.path.split('/').at(-1)!, snapshot.path, manifest.itemId);
      const records: unknown[] = [], invalid: Array<{ path: string; reason: string }> = [];
      let chars = 0; const budget = Math.min(Number(args.maxChars ?? 60_000), 400_000);
      for (const id of candidates) {
        const path = getAnnotationFilePath(id), sidecar = await readExistingHarnessText(input.root, path, signal);
        if (!sidecar) continue;
        if (chars + sidecar.content.length > budget) { invalid.push({ path, reason: 'annotation_read_budget_exceeded' }); continue; }
        chars += sidecar.content.length;
        const parsed = deserializeAnnotationFile(sidecar.content);
        if (!parsed || parsed.fileType !== 'pdf') { invalid.push({ path, reason: 'invalid_pdf_annotation_sidecar' }); continue; }
        records.push({ path, version: sidecar.version, locator: path, documentId: parsed.documentId, annotations: parsed.annotations });
      }
      const annotationPath = manifest.annotationIndexPath ?? `${manifest.itemFolderPath}/_annotations.md`;
      const note = await readExistingHarnessText(input.root, annotationPath, signal);
      const page = harnessPage(records, args); await assertCurrent(signal);
      if ((await input.index.validateSnapshots([snapshot], signal)).invalid.length) throw new Error('PDF source revision changed during annotation read.');
      const annotationNote = note ? { path: annotationPath, locator: annotationPath, version: note.version,
        text: note.content.slice(0, Math.max(0, budget - chars)), complete: note.content.length <= budget - chars } : undefined;
      return { parent: snapshot, ...page, complete: page.complete && !invalid.length && (!annotationNote || annotationNote.complete), invalid, scannedChars: chars + (annotationNote?.text.length ?? 0),
        ...(annotationNote ? { annotationNote } : {}) };
    }
    if (name === 'lattice.pdf.proposeAnnotations') {
      const { snapshot, manifest } = await parent(args, signal), evidence = remembered.get(snapshot.path);
      if (!evidence || evidence.snapshot.version !== snapshot.version) throw new Error('Read the actual PDF pages before proposing annotations.');
      const annotationPath = manifest.annotationIndexPath ?? `${manifest.itemFolderPath}/_annotations.md`;
      const existing = await readExistingHarnessText(input.root, annotationPath, signal);
      const content = appendVerifiedAnnotationDrafts(existing?.content ?? '', args.annotations as HarnessAnnotationIntent[], evidence);
      const proposal = await preparePdfChildProposal({ root: input.root, workspaceKey: input.workspaceKey, parentPath: snapshot.path, parentItemId: manifest.itemId,
        fileName: '_annotations.md', content, mode: existing ? 'update' : 'create', sourceSnapshot: snapshot,
        ...(existing ? { expectedContent: existing.content } : {}), signal });
      await assertCurrent(signal);
      return publishPdf(proposal, signal);
    }
    if (name === 'lattice.pdf.proposeChild') return publishPdf(await base.execute(name, args, signal) as PdfChildProposal, signal);
    if (name === 'lattice.workspace.proposeWrite') {
      const targetPath = normalizeWorkspaceWritePath(input.root, args.targetPath as string), content = args.content as string;
      if (targetPath.startsWith('.lattice/')) throw new Error('Use the dedicated PDF proposal tool for internal child files.');
      validateHarnessTextContent(targetPath, content);
      if (args.fileName !== undefined) throw new Error('Local writes use a single concrete targetPath, not fileName.');
      let original: string | undefined;
      if (args.mode === 'update') {
        const source = await read(targetPath, { expectedVersion: args.expectedVersion, maxChars: 400_000, maxUnits: 4096 }, signal);
        original = (await readExistingHarnessText(input.root, source.snapshot.path, signal))?.content;
        if (original === undefined) throw new Error('Update target does not exist.');
        if ((await input.index.validateSnapshots([source.snapshot], signal)).invalid.length) throw new Error('Update source revision changed before review.');
      } else if (await readExistingHarnessText(input.root, targetPath, signal)) throw new Error('Create target already exists; review an explicit update.');
      await assertCurrent(signal);
      return publishHarnessDraft(input.onDraft, { type: 'code_explainer', title: targetPath.split('/').at(-1)!, content, contentFormat: 'raw', targetPath,
        writeMode: args.mode as 'create' | 'update', sourceRefs: original === undefined ? [] : [{ kind: 'file', label: targetPath, locator: targetPath }],
        fileChange: { targetPath, expectedContent: original, workspaceKey: input.workspaceKey } }, signal);
    }
    throw new Error('Unknown Lattice tool.');
  } };
}
