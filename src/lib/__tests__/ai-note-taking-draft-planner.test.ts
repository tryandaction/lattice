import { describe, expect, it } from 'vitest';
import type { ResearchAgentRunResult } from '../ai/research-agent';
import {
  getResearchAgentWorkflow,
  resolveNoteTakingSkillConfig,
} from '../ai/research-agent-workflows';
import { buildNoteTakingDraftSuggestion } from '../ai/lattice-skills/note-taking-draft-planner';

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
      'Task: Explain Alpha',
      '',
      'Workflow output:',
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

describe('note-taking draft planner', () => {
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
    expect(suggestion?.content).toContain('> Workflow: Reading Note');
    expect(suggestion?.content).toContain('alpha.md (notes/alpha.md) - Alpha evidence preview');
    expect(suggestion?.content).toContain('## Configured Sections');
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
    expect(suggestion?.content).toContain('Rydberg Quantum Gates.pdf page 3 (Papers/Rydberg Quantum Gates.pdf#page=3)');
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
