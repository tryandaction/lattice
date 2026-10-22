import { describe, expect, it } from 'vitest';
import {
  buildAgentObservationLines,
  buildAgentResultSections,
  summarizeAgentFollowUpKinds,
} from '@/lib/ai/agent-result-view-model';
import type { ChatMessage } from '@/stores/ai-chat-store';

function createAgentMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-agent',
    role: 'assistant',
    content: 'Agent answer\n---\nAgent session: agent-session-1\nPlan source: custom',
    timestamp: 100,
    agentResult: {
      sessionId: 'agent-session-1',
      workflowLabel: 'Markdown Research',
      workflowInferred: true,
      planSource: 'custom',
    },
    followUpActions: [],
    ...overrides,
  };
}

describe('agent result view model', () => {
  it('keeps the complete teaching answer after Markdown thematic breaks', () => {
    const content = '# 本文详细讲解\n\n## 一句话结论\n简短概括。\n\n---\n\n## 1. 物理机制\n完整机制与推导。\n\n---\n\n## 2. 鲁棒性与边界\n误差分析与适用条件。';
    const sections = buildAgentResultSections(createAgentMessage({ content, requestMode: 'chat' }));
    expect(sections?.[0].content).toBe(content);
  });

  it('removes only a recognized legacy execution footer, keeping earlier separators', () => {
    const answer = '## 结论\n结论。\n\n---\n\n## 详细机制\n足够完整的解释。';
    const sections = buildAgentResultSections(createAgentMessage({ content: answer + '\n---\nAgent session: agent-session-1\nPlan source: custom\nPlan:\n- completed: Done' }));
    expect(sections?.[0].content).toBe(answer);
  });

  it('builds compact answer, run, and workbench sections for agent messages', () => {
    const sections = buildAgentResultSections(createAgentMessage({
      agentResult: {
        sessionId: 'agent-session-1',
        workflowLabel: 'Reading Note',
        workflowInferred: false,
        planSource: 'custom',
        memorySummary: {
          pendingSuggestionCount: 1,
          pendingSuggestionTitles: ['Alpha finding'],
        },
      },
      draftSuggestion: {
        type: 'paper_note',
        templateId: 'reading-note',
        title: 'Reading Note: Alpha',
      },
      followUpActions: [
        { id: 'draft', label: 'Save draft', kind: 'create_draft' },
      ],
    }));

    expect(sections?.map((section) => section.title)).toEqual(['Answer', 'Run', 'Workbench']);
    expect(sections?.[0]?.content).toBe('Agent answer');
    expect(sections?.find((section) => section.title === 'Run')?.content).toContain('Workflow: Reading Note');
    expect(sections?.find((section) => section.title === 'Run')?.content).toContain('Memory suggestions: 1 pending (Alpha finding).');
    expect(sections?.find((section) => section.title === 'Workbench')?.content).toContain('Mode: draft-ready');
    expect(sections?.find((section) => section.title === 'Workbench')?.content).toContain('Draft suggestion: Reading Note: Alpha / type=paper_note / template=reading-note');
  });

  it('adds plan and observation sections when available', () => {
    const sections = buildAgentResultSections(createAgentMessage({
      agentResult: {
        sessionId: 'agent-session-1',
        planSteps: [
          { title: 'Resolve evidence', status: 'completed', toolName: 'evidence.resolve' },
        ],
        toolObservations: [
          {
            stepId: 'search',
            toolName: 'workspace.search',
            status: 'completed',
            preview: '2 matches',
            evidenceCount: 2,
            resultStatus: 'completed',
            resultSummary: '2 indexed matches',
          },
        ],
      },
    }));

    expect(sections?.find((section) => section.title === 'Plan')?.content).toContain('- completed: Resolve evidence (evidence.resolve)');
    const observations = sections?.find((section) => section.title === 'Observations')?.content;
    expect(observations).toContain('Summary: 1 observations');
    expect(observations).toContain('workspace.search via search, 2 evidence');
    expect(observations).toContain('summary=2 indexed matches');
  });

  it('includes navigable evidence links in the agent run summary', () => {
    const sections = buildAgentResultSections(createAgentMessage({
      evidenceRefs: [
        { kind: 'file', label: 'Methods note', locator: 'notes/methods.md#Setup' },
        { kind: 'pdf_page', label: 'Paper page 4', locator: 'papers/results.pdf#page=4' },
      ],
      agentResult: {
        sessionId: 'agent-session-evidence',
        workflowLabel: 'Research',
      },
    }));

    const run = sections?.find((section) => section.title === 'Run');
    expect(run?.content).toContain('[Methods note](notes/methods.md#Setup)');
    expect(run?.content).toContain('[Paper page 4](papers/results.pdf#page=4)');
  });

  it('summarizes and truncates observation lines deterministically', () => {
    const lines = buildAgentObservationLines(Array.from({ length: 6 }, (_, index) => ({
      stepId: `step-${index + 1}`,
      toolName: index === 5 ? 'workspace.readIndexedContext' : 'workspace.search',
      status: index === 5 ? 'failed' : 'completed',
      preview: `Observation ${index + 1}`,
    })));

    expect(lines[0]).toContain('Summary: 6 observations');
    expect(lines[0]).toContain('statuses: completed=5, failed=1');
    expect(lines[0]).toContain('tools: workspace.search=5, workspace.readIndexedContext=1');
    expect(lines.join('\n')).toContain('step-4');
    expect(lines.join('\n')).not.toContain('step-5');
    expect(lines.at(-1)).toBe('... 2 more observations hidden in Trace.');
  });

  it('summarizes follow-up action kinds for compact result headers', () => {
    expect(summarizeAgentFollowUpKinds([
      { id: 'draft-1', label: 'Draft A', kind: 'create_draft' },
      { id: 'draft-2', label: 'Draft B', kind: 'create_draft' },
      { id: 'proposal', label: 'Proposal', kind: 'propose_task' },
    ])).toBe('create_draft=2, propose_task=1');
  });
});
