import { describe, expect, it, vi } from 'vitest';
import {
  applyDraftArtifactsToWorkspace,
  buildDraftArtifactsFromProposal,
  buildDraftArtifactDefaultPath,
  formatDraftArtifactMarkdown,
  formatTaskProposalDraftContent,
  getProposalTargetDrafts,
  summarizeProposalTargetDrafts,
  toEvidenceNavigationTarget,
  writeDraftArtifactToTarget,
  writeDraftArtifactToWorkspace,
} from '../ai/workbench-actions';
import type { AiDraftArtifact, AiTaskProposal, EvidenceRef } from '../ai/types';
import { parseLinkTarget } from '../link-router/parse-link-target';
import { listPdfItemNotes, loadPdfItemManifest, savePdfItemManifest } from '../pdf-item';
import { getAgentDocumentVersion } from '../ai/document-source';
import { useWorkspaceStore } from '@/stores/workspace-store';

class FakeWritable {
  constructor(private readonly onWrite: (content: string) => void) {}

  async write(content: string) {
    this.onWrite(content);
  }

  async close() {}
}

class FakeFileHandle {
  kind = 'file' as const;

  constructor(
    public readonly name: string,
    private readonly onRead: () => string,
    private readonly onWrite: (content: string) => void,
  ) {}

  async getFile() {
    const content = this.onRead();
    return new File([content], this.name);
  }

  async createWritable() {
    return new FakeWritable(this.onWrite);
  }
}

class FakeDirectoryHandle {
  kind = 'directory' as const;
  private readonly files = new Map<string, string>();
  private readonly directories = new Map<string, FakeDirectoryHandle>();

  constructor(public readonly name: string) {}

  async *values() {
    for (const directory of this.directories.values()) yield directory;
    for (const name of this.files.keys()) yield await this.getFileHandle(name);
  }

  async removeEntry(name: string) {
    this.files.delete(name);
    this.directories.delete(name);
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) {
      return existing;
    }
    if (options?.create) {
      const created = new FakeDirectoryHandle(name);
      this.directories.set(name, created);
      return created;
    }
    throw new DOMException(`Directory not found: ${name}`, 'NotFoundError');
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) {
      throw new DOMException(`File not found: ${name}`, 'NotFoundError');
    }
    if (!this.files.has(name)) {
      this.files.set(name, '');
    }

    return new FakeFileHandle(name, () => {
      return this.files.get(name) ?? '';
    }, (content) => {
      this.files.set(name, content);
    }) as unknown as FileSystemFileHandle;
  }

  readFile(name: string): string {
    const content = this.files.get(name);
    if (content === undefined) {
      throw new Error(`Missing file content: ${name}`);
    }
    return content;
  }
}

function createDraft(overrides: Partial<AiDraftArtifact> = {}): AiDraftArtifact {
  return {
    id: 'draft-1',
    type: 'research_summary',
    title: 'Quantum Notes',
    sourceRefs: [
      {
        kind: 'heading',
        label: 'notes/paper.md#Method',
        locator: 'notes/paper.md#Method',
        preview: 'Method summary',
      },
    ],
    content: 'A concise summary of the paper.',
    status: 'draft',
    createdAt: Date.parse('2026-03-15T12:00:00.000Z'),
    ...overrides,
  };
}

function createProposal(overrides: Partial<AiTaskProposal> = {}): AiTaskProposal {
  return {
    id: 'proposal-1',
    summary: '整理本周实验记录',
    steps: [
      { id: 'step-1', title: 'Review notes', description: 'Inspect experiment notes and outputs.' },
      { id: 'step-2', title: 'Write recap', description: 'Prepare a concise weekly summary.' },
    ],
    requiredApprovals: [
      'Confirm target note path',
      'Confirm append strategy',
    ],
    plannedWrites: [
      {
        targetPath: 'Research/weekly-summary.md',
        mode: 'append',
        contentPreview: 'Append this week summary to the weekly note.',
      },
    ],
    sourceRefs: [
      {
        kind: 'heading',
        label: 'lab/week.md#Results',
        locator: 'lab/week.md#Results',
      },
    ],
    status: 'pending',
    confirmedApprovals: ['Confirm target note path'],
    approvedWrites: ['Research/weekly-summary.md'],
    generatedDraftTargets: [],
    createdAt: Date.parse('2026-03-16T08:00:00.000Z'),
    ...overrides,
  };
}

describe('ai-workbench-actions', () => {
  it('keeps a planned update as an update and blocks previews without an original version', () => {
    const proposal = createProposal({ plannedWrites: [{ targetPath: 'note.md', mode: 'update', contentPreview: 'Replace conclusion' }], approvedWrites: ['note.md'] });
    const [draft] = buildDraftArtifactsFromProposal(proposal);
    expect(draft.writeMode).toBe('update');
    expect(summarizeProposalTargetDrafts({ generatedDraftTargets: ['note.md'] }, [createDraft({ ...draft })])).toMatchObject({ ready: 0, blocked: 1 });
  });

  it('enforces the editor guard for every bulk write while allowing other targets to complete', async () => {
    const root = new FakeDirectoryHandle('workspace-root');
    const beforeWrite = vi.fn((path: string) => { if (path === 'dirty.md') throw new Error('Unsaved editor'); });
    const results = await applyDraftArtifactsToWorkspace(root as unknown as FileSystemDirectoryHandle, [
      createDraft({ id: 'dirty', targetPath: 'dirty.md' }),
      createDraft({ id: 'clean', targetPath: 'clean.md' }),
    ], { beforeWrite });
    expect(results).toMatchObject([{ draftId: 'dirty', ok: false, error: 'Unsaved editor' }, { draftId: 'clean', ok: true }]);
    expect(beforeWrite.mock.calls.map(call => call[0])).toEqual(['dirty.md', 'clean.md']);
    expect(() => root.readFile('dirty.md')).toThrow('Missing file content');
  });
  it('writes a reviewed raw edit and rejects a stale source or a changed target', async () => {
    const root = new FakeDirectoryHandle('workspace-root');
    const handle = root as unknown as FileSystemDirectoryHandle;
    const original = await root.getFileHandle('example.py', { create: true });
    const initial = await original.createWritable(); await initial.write('old = 1\n'); await initial.close();
    const draft = createDraft({ targetPath: 'example.py', writeMode: 'update', contentFormat: 'raw', content: 'new = 2\n', fileChange: { targetPath: 'example.py', expectedContent: 'old = 1\n', workspaceKey: 'workspace-root' } });
    await writeDraftArtifactToTarget(handle, draft, { targetPath: draft.targetPath, writeMode: 'update' });
    expect(root.readFile('example.py')).toBe('new = 2\n');
    await expect(writeDraftArtifactToTarget(handle, draft, { targetPath: 'other.py', writeMode: 'update' })).rejects.toThrow('绑定原文件');
    await expect(writeDraftArtifactToTarget(handle, draft, { targetPath: draft.targetPath, writeMode: 'update' })).rejects.toThrow('已改变');
    expect(root.readFile('example.py')).toBe('new = 2\n');
  });
  it('creates a raw file without wrapping code in note metadata and refuses overwrites', async () => {
    const root = new FakeDirectoryHandle('workspace-root');
    const draft = createDraft({ contentFormat: 'raw', targetPath: 'example.py', content: 'print(1)\n' });
    await writeDraftArtifactToTarget(root as unknown as FileSystemDirectoryHandle, draft, { targetPath: draft.targetPath });
    expect(root.readFile('example.py')).toBe('print(1)\n');
    await expect(writeDraftArtifactToTarget(root as unknown as FileSystemDirectoryHandle, draft, { targetPath: draft.targetPath })).rejects.toThrow('已存在');
  });
  it.each(['../outside.md', 'notes/../../outside.md', '/outside.md', '.lattice/settings.json'])('rejects an invalid file target %s', async targetPath => {
    const root = new FakeDirectoryHandle('workspace-root');
    await expect(writeDraftArtifactToTarget(root as unknown as FileSystemDirectoryHandle, createDraft({ targetPath }), { targetPath })).rejects.toThrow();
  });
  async function childDraft(overrides: Partial<AiDraftArtifact> = {}, parentItemId = 'papers-original.pdf') {
    const path = '.lattice/items/papers-original.pdf/original Reading Note.md';
    return createDraft({
      type: 'paper_note', targetPath: path, pdfChildTarget: { sourcePath: 'papers/original.pdf', suggestedTargetPath: path, workspaceKey: 'workspace-root',
        parentItemId, parentVersion: await getAgentDocumentVersion(new File([''], 'original.pdf'), parentItemId) },
      sourceRefs: [{ kind: 'pdf_page', label: 'Original', locator: 'papers/original.pdf#page=4' }], ...overrides,
    });
  }

  it('registers a reviewed child note under the original PDF item without overwriting another child', async () => {
    const root = new FakeDirectoryHandle('workspace-root');
    const handle = root as unknown as FileSystemDirectoryHandle;
    const papers = await root.getDirectoryHandle('papers', { create: true });
    await papers.getFileHandle('original.pdf', { create: true });
    const draft = await childDraft();
    useWorkspaceStore.setState({ rootHandle: handle });
    const saved = await writeDraftArtifactToTarget(handle, draft, { targetPath: draft.targetPath });
    const manifest = await loadPdfItemManifest(handle, 'papers-original.pdf', 'papers/original.pdf');
    const itemFolder = await (await (await root.getDirectoryHandle('.lattice')).getDirectoryHandle('items')).getDirectoryHandle('papers-original.pdf');
    expect(JSON.parse(itemFolder.readFile('manifest.json')).pdfPath).toBe('papers/original.pdf');
    expect(saved).toMatchObject({ path: 'workspace-root/.lattice/items/papers-original.pdf/original Reading Note.md', parentPdfPath: 'workspace-root/papers/original.pdf' });
    expect((await listPdfItemNotes(handle, manifest)).map(note => note.fileName)).toContain('original Reading Note.md');
    await expect(writeDraftArtifactToTarget(handle, draft, { targetPath: draft.targetPath })).rejects.toThrow('已存在');
    expect(await (await saved.handle.getFile()).text()).toContain('A concise summary of the paper.');
  });

  it('saves a child into the existing moved PDF item folder through its known path alias', async () => {
    const root = new FakeDirectoryHandle('workspace-root');
    const handle = root as unknown as FileSystemDirectoryHandle;
    const papers = await root.getDirectoryHandle('papers', { create: true });
    await papers.getFileHandle('renamed.pdf', { create: true });
    await savePdfItemManifest(handle, { version: 4, itemId: 'stable-id', pdfPath: 'papers/renamed.pdf', itemFolderPath: '.lattice/items/custom-folder', annotationIndexPath: null,
      fileFingerprint: null, versionFingerprint: null, knownPdfPaths: ['papers/original.pdf', 'papers/renamed.pdf'], createdAt: 1, updatedAt: 1 });
    const draft = await childDraft({}, 'stable-id');
    useWorkspaceStore.setState({ rootHandle: handle });
    const saved = await writeDraftArtifactToTarget(handle, draft, { targetPath: draft.targetPath });
    expect(saved).toMatchObject({ path: 'workspace-root/.lattice/items/custom-folder/original Reading Note.md', parentPdfPath: 'workspace-root/papers/renamed.pdf' });
  });

  it('honors an edited note target instead of applying the suggested PDF child binding', async () => {
    const root = new FakeDirectoryHandle('workspace-root');
    const saved = await writeDraftArtifactToTarget(root as unknown as FileSystemDirectoryHandle, await childDraft(), { targetPath: 'Notes/my-chosen-note.md' });
    expect(saved.path).toBe('workspace-root/Notes/my-chosen-note.md');
    expect(saved.parentPdfPath).toBeUndefined();
    await expect(root.getDirectoryHandle('.lattice')).rejects.toThrow();
  });

  it.each(['missing-pdf', 'wrong-workspace'])('does not create a child when original parent authorization fails: %s', async (failure) => {
    const root = new FakeDirectoryHandle('workspace-root');
    const draft = await childDraft();
    await expect(writeDraftArtifactToTarget(root as unknown as FileSystemDirectoryHandle, draft, {
      targetPath: draft.targetPath, workspaceKey: failure === 'wrong-workspace' ? 'other-workspace' : 'workspace-root',
    })).rejects.toThrow();
    await expect(root.getDirectoryHandle('.lattice')).rejects.toThrow();
  });
  it('normalizes pdf annotation evidence locators for navigation', () => {
    const ref: EvidenceRef = {
      kind: 'pdf_annotation',
      label: 'paper annotation',
      locator: 'papers/math.pdf#ann=42',
    };

    expect(toEvidenceNavigationTarget(ref)).toBe('papers/math.pdf#ann-42');
    expect(toEvidenceNavigationTarget({
      ...ref,
      locator: 'papers/math.pdf#annotation=ann-108',
    })).toBe('papers/math.pdf#ann-108');
  });

  it('saves the reviewed draft without adding a source inventory or fake next actions', () => {
    const markdown = formatDraftArtifactMarkdown(createDraft({
      templateId: 'reading-note',
      originMessageId: 'message-1',
    }));

    expect(markdown).toContain('# Quantum Notes');
    expect(markdown).toContain('- Template: Reading Note');
    expect(markdown).toContain('- Origin Message: message-1');
    expect(markdown).toContain('## Content');
    expect(markdown).toContain('A concise summary of the paper.');
    expect(markdown).not.toContain('## Evidence');
    expect(markdown).not.toContain('Preview:');
    expect(markdown).not.toContain('## Next Actions');
    expect(markdown).not.toContain('notes/paper.md#Method');
  });

  it('builds the default target path for drafts', () => {
    expect(buildDraftArtifactDefaultPath(createDraft())).toBe('AI Drafts/Quantum Notes.md');
  });

  it('formats task proposals into reviewable markdown content', () => {
    const markdown = formatTaskProposalDraftContent(createProposal());

    expect(markdown).toContain('Status: pending');
    expect(markdown).toContain('## Steps');
    expect(markdown).toContain('1. Review notes');
    expect(markdown).toContain('- [x] Confirm target note path');
    expect(markdown).toContain('Research/weekly-summary.md (append)');
  });

  it('builds target drafts from approved writes only once', () => {
    const drafts = buildDraftArtifactsFromProposal(createProposal({
      plannedWrites: [
        {
          targetPath: 'Research/weekly-summary.md',
          mode: 'append',
          contentPreview: 'Append summary',
        },
        {
          targetPath: 'Research/method-note.md',
          mode: 'create',
          contentPreview: 'Create method note',
        },
      ],
      approvedWrites: ['Research/method-note.md'],
      generatedDraftTargets: ['Research/weekly-summary.md'],
    }));

    expect(drafts).toEqual([
      expect.objectContaining({
        templateId: 'task-plan',
        originProposalId: 'proposal-1',
        title: 'method note Draft',
        targetPath: 'Research/method-note.md',
        writeMode: 'create',
      }),
    ]);
  });

  it('collects and summarizes target drafts for a proposal', () => {
    const targetDrafts = [
      createDraft({
        id: 'draft-a',
        targetPath: 'Research/weekly-summary.md',
        writeMode: 'append',
        type: 'task_plan',
      }),
      createDraft({
        id: 'draft-b',
        targetPath: 'Research/method-note.md',
        writeMode: 'create',
        type: 'task_plan',
        status: 'applied',
      }),
      createDraft({
        id: 'draft-c',
        targetPath: 'Research/ignored.md',
        writeMode: 'create',
      }),
    ];
    const proposal = createProposal({
      generatedDraftTargets: ['Research/weekly-summary.md', 'Research/method-note.md'],
    });

    expect(getProposalTargetDrafts(proposal, targetDrafts).map((draft) => draft.id)).toEqual([
      'draft-a',
      'draft-b',
    ]);
    expect(summarizeProposalTargetDrafts(proposal, targetDrafts)).toEqual({
      total: 2,
      ready: 1,
      applied: 1,
      discarded: 0,
      blocked: 0,
    });
  });

  it('applies multiple drafts to the workspace and reports per-draft results', async () => {
    const root = new FakeDirectoryHandle('workspace-root');
    const notesDir = await root.getDirectoryHandle('Notes', { create: true });
    const noteHandle = await notesDir.getFileHandle('lab.md', { create: true });
    const writable = await noteHandle.createWritable();
    await writable.write('# Existing Note');
    await writable.close();

    const results = await applyDraftArtifactsToWorkspace(
      root as unknown as FileSystemDirectoryHandle,
      [
        createDraft({
          id: 'draft-append',
          type: 'task_plan',
          targetPath: 'Notes/lab.md',
          writeMode: 'append',
        }),
        createDraft({
          id: 'draft-create',
          type: 'task_plan',
          targetPath: 'Research/new-note.md',
          writeMode: 'create',
        }),
      ],
    );

    expect(results).toEqual([
      expect.objectContaining({
        draftId: 'draft-append',
        ok: true,
        path: 'workspace-root/Notes/lab.md',
      }),
      expect.objectContaining({
        draftId: 'draft-create',
        ok: true,
        path: 'workspace-root/Research/new-note.md',
      }),
    ]);
    const researchDir = await root.getDirectoryHandle('Research');
    expect(researchDir.readFile('new-note.md')).toContain('# Quantum Notes');
    expect(notesDir.readFile('lab.md')).toContain('## Quantum Notes');
  });

  it('writes approved drafts into the AI Drafts workspace folder', async () => {
    const root = new FakeDirectoryHandle('workspace-root');
    const draft = createDraft();

    const result = await writeDraftArtifactToWorkspace(
      root as unknown as FileSystemDirectoryHandle,
      draft,
    );

    expect(result.path).toBe('workspace-root/AI Drafts/Quantum Notes.md');
    const draftsDir = await root.getDirectoryHandle('AI Drafts');
    expect(draftsDir.readFile('Quantum Notes.md')).toContain('A concise summary of the paper.');
  });

  it('creates nested target directories when writing to a custom path', async () => {
    const root = new FakeDirectoryHandle('workspace-root');
    const draft = createDraft();

    const result = await writeDraftArtifactToTarget(
      root as unknown as FileSystemDirectoryHandle,
      draft,
      { targetPath: 'workspace-root/Research/Week 1/summary.md', writeMode: 'create' },
    );

    expect(result.path).toBe('workspace-root/Research/Week 1/summary.md');
    const researchDir = await root.getDirectoryHandle('Research');
    const weekDir = await researchDir.getDirectoryHandle('Week 1');
    expect(weekDir.readFile('summary.md')).toContain('# Quantum Notes');
  });

  it('preserves a precise cross-file citation through reviewed draft write and reread', async () => {
    const root = new FakeDirectoryHandle('workspace-root');
    const href = '/papers/source.pdf#page=4&text=The%20measured%20field%20was%2058%20G';
    const draft = createDraft({ content: `The field was 58 G. [p.4](${href})`, sourceRefs: [{ kind: 'pdf_page', label: 'source', locator: 'papers/source.pdf#page=4', preview: 'FULL PAGE CONTENT SHOULD NOT BE APPENDED' }] });
    const saved = await writeDraftArtifactToTarget(root as unknown as FileSystemDirectoryHandle, draft, { targetPath: 'Notes/Reading/summary.md', writeMode: 'create' });
    const markdown = await (await saved.handle.getFile()).text();
    expect(markdown).toContain(draft.content);
    expect(markdown).not.toContain('FULL PAGE CONTENT');
    expect(parseLinkTarget(markdown.match(/\[p\.4\]\(([^)]+)\)/)![1], { currentFilePath: saved.path }).target).toEqual({
      type: 'pdf_page', path: 'papers/source.pdf', page: 4, snippet: 'The measured field was 58 G',
    });
    expect(draft.sourceRefs[0].preview).toBe('FULL PAGE CONTENT SHOULD NOT BE APPENDED');
  });

  it('checks open-editor state immediately before overwriting the original file', async () => {
    const root = new FakeDirectoryHandle('workspace-root');
    const handle = await root.getFileHandle('test.py', { create: true });
    const writer = await handle.createWritable(); await writer.write('value=1'); await writer.close();
    const draft = createDraft({ content: 'value=2', contentFormat: 'raw', targetPath: 'test.py',
      fileChange: { targetPath: 'test.py', expectedContent: 'value=1' } });
    await expect(writeDraftArtifactToTarget(root as unknown as FileSystemDirectoryHandle, draft, {
      targetPath: 'test.py', writeMode: 'update', beforeWrite: () => { throw new Error('Unsaved editor'); },
    })).rejects.toThrow('Unsaved editor');
    expect(root.readFile('test.py')).toBe('value=1');
  });

  it('appends draft markdown into an existing markdown note', async () => {
    const root = new FakeDirectoryHandle('workspace-root');
    const notesDir = await root.getDirectoryHandle('Notes', { create: true });
    const noteHandle = await notesDir.getFileHandle('lab.md', { create: true });
    const writable = await noteHandle.createWritable();
    await writable.write('# Existing Note\n\nBase content.');
    await writable.close();

    const draft = createDraft();
    const result = await writeDraftArtifactToTarget(
      root as unknown as FileSystemDirectoryHandle,
      draft,
      { targetPath: 'Notes/lab.md', writeMode: 'append' },
    );

    expect(result.path).toBe('workspace-root/Notes/lab.md');
    expect(notesDir.readFile('lab.md')).toContain('## Quantum Notes');
    expect(notesDir.readFile('lab.md')).toContain('Base content.');
  });
});
