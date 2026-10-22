import { describe, expect, it } from 'vitest';
import type { ResearchAgentRunResult } from '../ai/research-agent';
import {
  getResearchAgentWorkflow,
  resolveNoteTakingSkillConfig,
} from '../ai/research-agent-workflows';
import { buildNoteTakingDraftSuggestion } from '../ai/lattice-skills/note-taking-draft-planner';
import { buildCitationContracts } from '../ai/citation-contract';
import { parseLinkTarget } from '../link-router/parse-link-target';
import type { DirectoryResearchFile } from '../ai/directory-research';

function createResult(overrides: Partial<ResearchAgentRunResult> = {}): ResearchAgentRunResult {
  return {
    sessionId: 'research-session-draft-planner',
    session: {
      id: 'research-session-draft-planner',
      profile: 'research',
      task: 'Explain Alpha',
      title: 'Explain Alpha',
      status: 'completed',
      createdAt: 1,
      updatedAt: 2,
      trace: [],
      evidenceRefs: [],
      approvalRequestIds: [],
      pendingApprovals: [],
      compactions: [],
      memorySnapshotIds: [],
    },
    approvalSummary: {
      status: 'none',
      totalApprovals: 0,
      pendingApprovals: 0,
      executingApprovals: 0,
      completedApprovals: 0,
      failedApprovals: 0,
      rejectedApprovals: 0,
      pendingToolNames: [],
      executingToolNames: [],
      completedToolNames: [],
      failedToolNames: [],
    },
    contextPack: {
      id: 'context-pack-draft-planner',
      createdAt: 1,
      sections: [],
      sourceSummaries: [],
      evidenceRefs: [],
      prompt: '',
      tokenEstimate: 0,
      truncated: false,
      budget: {
        maxTokens: 4000,
        bySource: {},
      },
      omitted: [],
      omittedSummary: {
        totalOmittedCount: 0,
        totalOmittedTokens: 0,
        bySource: [],
        preview: 'No omitted context.',
        semanticPreview: 'No omitted context.',
        autoSummary: [],
        autoSummaryPreview: 'No omitted auto summary.',
        recoveryHints: [],
        recoveryHintsPreview: 'No omitted recovery hints.',
        recoveryPriorityPreview: 'No omitted recovery priorities.',
        recoveryPlan: [],
        recoveryPlanPreview: 'No omitted recovery plan.',
      },
    },
    promptContext: {
      nodes: [],
      prompt: '',
      evidenceRefs: [],
      truncated: false,
    },
    answer: [
      '## Findings',
      '- Alpha finding.',
    ].join('\n'),
    planSteps: [],
    planSource: 'custom',
    planWarnings: [],
    plannerPrompt: 'planner prompt',
    plannerRawOutput: '{"steps":[]}',
    memorySnapshotIds: [],
    workspaceSummary: null,
    artifactResults: [],
    toolResults: [],
    toolObservations: [],
    memorySuggestionResults: [],
    ...overrides,
  };
}

function readDirectoryFile(path: string, kind: 'pdf' | 'markdown' = 'pdf'): DirectoryResearchFile {
  const version = `${path}|100|synthetic-content-hash`, unitLabel = kind === 'pdf' ? 'page' as const : 'section' as const;
  return { path, size: 100, lastModified: 1, status: 'complete',
    snapshot: { workspaceKey: 'workspace-A', path, sourceId: `source:${path}`, version, kind, totalUnits: 1, unitLabel },
    checkpoint: { version: 1, queryKey: '["Read all","Compare"]', completedBatches: 1, summaries: ['Verified source summary'], findings: [],
      sources: [{ path, version, totalUnits: 1, completedUnits: [1], offsets: {} }],
      coverage: [{ path, kind, unitLabel, totalUnits: 1, readUnits: [1], pendingUnits: [], emptyUnits: [], unreadableUnits: [] }] },
  };
}

function directoryResult(files: DirectoryResearchFile[]): ResearchAgentRunResult {
  const result = createResult();
  result.session.task = '阅读目录中全部文章并生成一个md子文档总结';
  result.session.documentResearch = { workspaceKey: 'workspace-A', status: 'ready',
    checkpoint: { version: 1, queryKey: '["Read all","Compare"]', completedBatches: 0, summaries: [], findings: [], sources: [], coverage: [] },
    directory: { version: 2, workspaceKey: 'workspace-A', selections: [{ kind: 'folder', path: 'papers' }], task: result.session.task,
      query: 'Compare', files, reductions: [], removedPaths: [], calls: 2, phase: 'ready',
      manifest: { version: 1, workspaceKey: 'workspace-A', selections: [{ kind: 'folder', path: 'papers' }], roots: [{ kind: 'folder', path: 'papers' }],
        files: [], directories: [], pendingDirectories: [], complete: true, revision: 1, changedPaths: [], removedPaths: [] } },
  };
  return result;
}

describe('note-taking draft planner', () => {
  const directoryDraft = (result: ResearchAgentRunResult) => {
    const workflow = getResearchAgentWorkflow('paper-reading');
    return buildNoteTakingDraftSuggestion({ workflow, result, noteConfig: resolveNoteTakingSkillConfig(workflow) });
  };

  it('does not attach a multi-PDF directory summary to the only PDF retained in the final citation menu', () => {
    const result = directoryResult([readDirectoryFile('papers/first.pdf'), readDirectoryFile('papers/last.pdf')]);
    result.promptContext.evidenceRefs = [{ kind: 'pdf_page', label: 'First PDF', locator: 'papers/first.pdf#page=1', preview: 'Verified first paper quotation.' }];
    expect(directoryDraft(result)?.pdfChildTarget).toBeUndefined();
  });

  it('binds one actually read PDF among non-PDF files using its exact ledger path without final quotations', () => {
    const result = directoryResult([readDirectoryFile('papers/original.pdf'), readDirectoryFile('papers/notes.md', 'markdown')]);
    expect(directoryDraft(result)?.pdfChildTarget).toMatchObject({ sourcePath: 'papers/original.pdf', workspaceKey: 'workspace-A',
      suggestedTargetPath: '.lattice/items/papers-original.pdf/original Reading Note.md' });
  });

  it.each(['missing_snapshot', 'missing_checkpoint', 'missing_version', 'different_version', 'different_path', 'different_workspace', 'different_kind', 'different_units', 'unread'] as const)(
    'never guesses a parent from final citations when the directory ledger has %s', failure => {
      const file = readDirectoryFile('papers/original.pdf');
      if (failure === 'missing_snapshot') delete file.snapshot;
      if (failure === 'missing_checkpoint') delete file.checkpoint;
      if (failure === 'missing_version') file.snapshot!.version = '';
      if (failure === 'different_version') file.snapshot!.version = 'changed-version';
      if (failure === 'different_path') file.snapshot!.path = 'other/original.pdf';
      if (failure === 'different_workspace') file.snapshot!.workspaceKey = 'workspace-B';
      if (failure === 'different_kind') file.snapshot!.kind = 'markdown';
      if (failure === 'different_units') file.snapshot!.totalUnits = 2;
      if (failure === 'unread') { file.checkpoint!.coverage[0].readUnits = []; file.checkpoint!.completedBatches = 0; file.checkpoint!.summaries = []; }
      const result = directoryResult([file]);
      result.promptContext.evidenceRefs = [{ kind: 'pdf_page', label: 'Original PDF', locator: 'papers/original.pdf#page=1', preview: 'Quotation alone cannot reconstruct the source revision.' }];
      expect(directoryDraft(result)?.pdfChildTarget).toBeUndefined();
    },
  );

  it('does not use an unopened or failed second PDF to narrow a multiple-PDF task to the successful first source', () => {
    const result = directoryResult([readDirectoryFile('papers/first.pdf'), { path: 'papers/unread.pdf', size: 10, lastModified: 1, status: 'failed' }]);
    result.promptContext.evidenceRefs = [{ kind: 'pdf_page', label: 'First PDF', locator: 'papers/first.pdf#page=1', preview: 'Verified quotation.' }];
    expect(directoryDraft(result)?.pdfChildTarget).toBeUndefined();
  });

  it('rejects a final citation for a different PDF instead of rebinding the directory draft', () => {
    const result = directoryResult([readDirectoryFile('papers/original.pdf')]);
    result.promptContext.evidenceRefs = [{ kind: 'pdf_page', label: 'Other PDF', locator: 'other/original.pdf#page=1', preview: 'A different same-name source.' }];
    expect(directoryDraft(result)?.pdfChildTarget).toBeUndefined();
  });

  it('does not infer a unique PDF before directory discovery is complete', () => {
    const result = directoryResult([readDirectoryFile('papers/original.pdf')]);
    result.session.documentResearch!.directory!.manifest!.complete = false;
    result.promptContext.evidenceRefs = [{ kind: 'pdf_page', label: 'Original PDF', locator: 'papers/original.pdf#page=1', preview: 'Verified quotation.' }];
    expect(directoryDraft(result)?.pdfChildTarget).toBeUndefined();
  });

  it.each(['bad_version', 'bad_sources', 'bad_coverage', 'bad_offsets'] as const)('does not throw or bind from a corrupted %s record', failure => {
    const file = readDirectoryFile('papers/original.pdf');
    if (failure === 'bad_version') file.snapshot!.version = 123 as unknown as string;
    if (failure === 'bad_sources') file.checkpoint!.sources = null as unknown as NonNullable<DirectoryResearchFile['checkpoint']>['sources'];
    if (failure === 'bad_coverage') file.checkpoint!.coverage = null as unknown as NonNullable<DirectoryResearchFile['checkpoint']>['coverage'];
    if (failure === 'bad_offsets') file.checkpoint!.sources[0].offsets = null as unknown as Record<string, number>;
    expect(directoryDraft(directoryResult([file]))?.pdfChildTarget).toBeUndefined();
  });

  it.each([
    ['生成一个md子文档详细讲解本文', true],
    ['Create a Markdown child document for this PDF', true],
    ['Generate a Markdown subdocument', true],
    ['Generate a Markdown document', false],
    ['生成 Markdown 文档，不要生成md子文档', false],
  ])('binds only an explicit PDF child request: %s', (task, isChild) => {
    const workflow = getResearchAgentWorkflow('paper-reading');
    const result = createResult({
      session: { ...createResult().session, task },
      promptContext: { nodes: [], prompt: '', truncated: false, evidenceRefs: [{
        kind: 'pdf_page', label: 'Original PDF', locator: 'papers/original.pdf#page=4', preview: 'Original source evidence.',
      }] },
    });
    const draft = buildNoteTakingDraftSuggestion({ workflow, result, noteConfig: resolveNoteTakingSkillConfig(workflow) });
    if (isChild) {
      expect(draft?.pdfChildTarget).toMatchObject({ sourcePath: 'papers/original.pdf', suggestedTargetPath: '.lattice/items/papers-original.pdf/original Reading Note.md' });
      expect(draft?.targetPath).toBe('.lattice/items/papers-original.pdf/original Reading Note.md');
    } else expect(draft?.pdfChildTarget).toBeUndefined();
  });
  it.each(['papers/source.pdf', 'C:/Research/papers/source.pdf'])('persists precise citation targets independently of the note folder: %s', (path) => {
    const workflow = getResearchAgentWorkflow('reading-note');
    const refs = [{ kind: 'pdf_page' as const, label: 'Source page 4', locator: `${path}#page=4`, preview: 'The measured magnetic field was 58 G throughout the experiment.', anchor: { page: 4 } }];
    const token = `citation:${buildCitationContracts(refs)[0].stableId}?quote=${encodeURIComponent('The measured magnetic field was 58 G')}`;
    const suggestion = buildNoteTakingDraftSuggestion({
      workflow, noteConfig: resolveNoteTakingSkillConfig(workflow),
      result: createResult({
        answer: `The field was 58 G. [p.4](${token})\n\n\`${token}\``,
        promptContext: { nodes: [], prompt: '', truncated: false, evidenceRefs: refs },
      }),
    });
    const href = suggestion!.content!.match(/\[p\.4\]\(([^)]+)\)/)![1];
    expect(href).toMatch(/^\//);
    for (const currentFilePath of ['AI Drafts/note.md', 'Notes/Archive/deep/note.md']) {
      expect(parseLinkTarget(href, { currentFilePath }).target).toMatchObject({
        type: 'pdf_page', path, page: 4, snippet: 'The measured magnetic field was 58 G',
      });
    }
    expect(suggestion!.content).toContain(`\`${token}\``);
  });

  it('does not promote context-only results or annotation workflows to generic note drafts', () => {
    for (const id of ['reading-note', 'pdf-annotation'] as const) {
      const workflow = getResearchAgentWorkflow(id);
      expect(buildNoteTakingDraftSuggestion({ workflow, noteConfig: resolveNoteTakingSkillConfig(workflow), result: createResult({ answer: '仅完成上下文收集，尚未生成答复。' }) })).toBeUndefined();
    }
    const workflow = getResearchAgentWorkflow('pdf-annotation');
    expect(buildNoteTakingDraftSuggestion({ workflow, noteConfig: resolveNoteTakingSkillConfig(workflow), result: createResult() })).toBeUndefined();
  });

  it('builds a reading note draft suggestion with evidence-backed content', () => {
    const workflow = getResearchAgentWorkflow('reading-note');
    const suggestion = buildNoteTakingDraftSuggestion({
      workflow,
      result: createResult({
        workflowId: 'reading-note',
        workflowTitle: 'Reading Note',
        promptContext: {
          nodes: [],
          prompt: 'resolved context',
          evidenceRefs: [
            {
              kind: 'file',
              label: 'alpha.md',
              locator: 'notes/alpha.md',
              preview: 'Alpha evidence preview',
            },
          ],
          truncated: false,
        },
      }),
      noteConfig: resolveNoteTakingSkillConfig(workflow),
    });

    expect(suggestion).toMatchObject({
      type: 'paper_note',
      templateId: 'reading-note',
      title: 'Reading Note: Explain Alpha',
      targetPath: 'AI Drafts/Reading Note Explain Alpha.md',
      writeMode: 'create',
    });
    expect(suggestion?.content).toBe('## Findings\n- Alpha finding.');
    expect(suggestion?.content).not.toContain('Configured Sections');
    expect(suggestion?.content).not.toContain('Review and refine');
    expect(suggestion?.content).not.toContain('Alpha evidence preview');
  });

  it('uses date-title naming when requested', () => {
    const workflow = getResearchAgentWorkflow('reading-note');
    const suggestion = buildNoteTakingDraftSuggestion({
      workflow,
      result: createResult({
        workflowId: 'reading-note',
        workflowTitle: 'Reading Note',
        contextPack: {
          ...createResult().contextPack,
          createdAt: Date.UTC(2026, 0, 15),
        },
      }),
      noteConfig: resolveNoteTakingSkillConfig(workflow, {
        fileNaming: 'date-title',
      }),
    });

    expect(suggestion?.targetPath).toBe('AI Drafts/2026-01-15 Reading Note Explain Alpha.md');
  });

  it('uses PDF evidence for pdf-title naming without enabling PDF writes', () => {
    const workflow = getResearchAgentWorkflow('paper-reading');
    const suggestion = buildNoteTakingDraftSuggestion({
      workflow,
      result: createResult({
        workflowId: 'paper-reading',
        workflowTitle: 'Paper Reading',
        promptContext: {
          nodes: [],
          prompt: 'resolved pdf context',
          evidenceRefs: [
            {
              kind: 'pdf_page',
              label: 'Rydberg Quantum Gates.pdf page 3',
              locator: 'Papers/Rydberg Quantum Gates.pdf#page=3',
              preview: 'Gate mechanism evidence',
            },
          ],
          truncated: false,
        },
      }),
      noteConfig: resolveNoteTakingSkillConfig(workflow),
    });

    expect(suggestion).toMatchObject({
      type: 'paper_note',
      templateId: 'reading-note',
      title: 'Paper Reading: Explain Alpha',
      targetPath: 'AI Drafts/Rydberg Quantum Gates Reading Note.md',
      writeMode: 'create',
    });
    expect(suggestion?.content).toBe('## Findings\n- Alpha finding.');
  });

  it('maps workflow families to the expected draft artifact types', () => {
    const notebookWorkflow = getResearchAgentWorkflow('notebook-analysis');
    const matrixWorkflow = getResearchAgentWorkflow('literature-matrix');
    const markdownWorkflow = getResearchAgentWorkflow('markdown-research');

    expect(buildNoteTakingDraftSuggestion({
      workflow: notebookWorkflow,
      result: createResult({ workflowId: 'notebook-analysis', workflowTitle: 'Notebook Analysis' }),
      noteConfig: resolveNoteTakingSkillConfig(notebookWorkflow),
    })).toMatchObject({
      type: 'code_explainer',
      templateId: 'code-note',
    });
    expect(buildNoteTakingDraftSuggestion({
      workflow: matrixWorkflow,
      result: createResult({ workflowId: 'literature-matrix', workflowTitle: 'Literature Matrix' }),
      noteConfig: resolveNoteTakingSkillConfig(matrixWorkflow),
    })).toMatchObject({
      type: 'comparison_summary',
      templateId: 'comparison-summary',
    });
    expect(buildNoteTakingDraftSuggestion({
      workflow: markdownWorkflow,
      result: createResult({ workflowId: 'markdown-research', workflowTitle: 'Markdown Research' }),
      noteConfig: resolveNoteTakingSkillConfig(markdownWorkflow),
    })).toMatchObject({
      type: 'research_summary',
      templateId: 'research-summary',
    });
  });

  it('does not create drafts for proposal-only or answer-only workflows', () => {
    const organizationWorkflow = getResearchAgentWorkflow('knowledge-organization');
    const teachingWorkflow = getResearchAgentWorkflow('teaching-explain');

    expect(buildNoteTakingDraftSuggestion({
      workflow: organizationWorkflow,
      result: createResult({ workflowId: 'knowledge-organization', workflowTitle: 'Knowledge Organization' }),
      noteConfig: resolveNoteTakingSkillConfig(organizationWorkflow),
    })).toBeUndefined();
    expect(buildNoteTakingDraftSuggestion({
      workflow: teachingWorkflow,
      result: createResult({ workflowId: 'teaching-explain', workflowTitle: 'Teaching Explain' }),
      noteConfig: resolveNoteTakingSkillConfig(teachingWorkflow),
    })).toBeUndefined();
  });
});
