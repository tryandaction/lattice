import { describe, expect, it } from 'vitest';
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
    return {
      async text() {
        return content;
      },
    } as File;
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
    throw new Error(`Directory not found: ${name}`);
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) {
      throw new Error(`File not found: ${name}`);
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

  it('formats draft artifacts into markdown with evidence section', () => {
    const markdown = formatDraftArtifactMarkdown(createDraft());

    expect(markdown).toContain('# Quantum Notes');
    expect(markdown).toContain('## Content');
    expect(markdown).toContain('A concise summary of the paper.');
    expect(markdown).toContain('## Evidence');
    expect(markdown).toContain('notes/paper.md#Method');
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
