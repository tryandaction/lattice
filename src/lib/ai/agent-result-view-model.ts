import type { ChatMessage } from '@/stores/ai-chat-store';
import type { AiFollowUpAction } from './types';

export type AgentResultSectionKind = 'conclusion' | 'next_actions' | 'run' | 'plan';

export interface AgentResultSectionViewModel {
  kind: AgentResultSectionKind;
  title: string;
  content: string;
  synthetic: true;
}

const MAX_AGENT_OBSERVATION_LINES = 4;

type AgentToolObservation = NonNullable<NonNullable<ChatMessage['agentResult']>['toolObservations']>[number];

function buildCountSummary(values: string[], maxItems = 4): string {
  const counts = values.reduce<Map<string, number>>((summary, value) => {
    summary.set(value, (summary.get(value) ?? 0) + 1);
    return summary;
  }, new Map());

  return Array.from(counts.entries())
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey))
    .slice(0, maxItems)
    .map(([key, count]) => `${key}=${count}`)
    .join(', ');
}

function formatAgentObservationLine(observation: AgentToolObservation): string {
  const evidence = observation.evidenceCount ? `, ${observation.evidenceCount} evidence` : '';
  const schema = [
    observation.resultStatus ? `status=${observation.resultStatus}` : null,
    observation.resultSummary ? `summary=${observation.resultSummary}` : null,
    observation.resultMetricsPreview ? `metrics=${observation.resultMetricsPreview}` : null,
    observation.resultArtifactsPreview ? `artifacts=${observation.resultArtifactsPreview}` : null,
    observation.resultDiagnosticsPreview ? `diagnostics=${observation.resultDiagnosticsPreview}` : null,
  ].filter(Boolean).join(' / ');

  return `- ${observation.status}: ${observation.toolName} via ${observation.stepId}${evidence}${schema ? ` [${schema}]` : ''} - ${observation.preview}`;
}

export function buildAgentObservationLines(observations: AgentToolObservation[]): string[] {
  if (observations.length === 0) {
    return [];
  }

  const statusSummary = buildCountSummary(observations.map((observation) => observation.status));
  const toolSummary = buildCountSummary(observations.map((observation) => observation.toolName));
  const summaryParts = [
    `${observations.length} observations`,
    statusSummary ? `statuses: ${statusSummary}` : null,
    toolSummary ? `tools: ${toolSummary}` : null,
  ].filter((part): part is string => Boolean(part));

  const visibleObservations = observations.slice(0, MAX_AGENT_OBSERVATION_LINES);
  const hiddenCount = observations.length - visibleObservations.length;
  const lines = [
    `Summary: ${summaryParts.join(' / ')}`,
    ...visibleObservations.map(formatAgentObservationLine),
  ];

  if (hiddenCount > 0) {
    lines.push(`... ${hiddenCount} more observation${hiddenCount === 1 ? '' : 's'} hidden in Trace.`);
  }

  return lines;
}

function formatDraftSuggestionLine(message: ChatMessage): string | null {
  const suggestion = message.draftSuggestion;
  if (!suggestion) {
    return null;
  }

  return [
    `Draft suggestion: ${suggestion.title}`,
    `type=${suggestion.type}`,
    suggestion.templateId ? `template=${suggestion.templateId}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
}

function buildAgentWorkbenchSection(message: ChatMessage): AgentResultSectionViewModel {
  const actions = message.followUpActions ?? [];
  const hasDraftAction = actions.some((action) => action.kind === 'create_draft');
  const hasProposalAction = actions.some((action) => action.kind === 'propose_task');
  const draftLine = formatDraftSuggestionLine(message);
  const actionLines = actions.map((action) => `- ${action.label}`);
  const mode = hasDraftAction && hasProposalAction
    ? 'draft-and-proposal'
    : hasDraftAction
      ? 'draft-ready'
      : hasProposalAction
        ? 'proposal-ready'
        : 'answer-only';
  const guidance = hasProposalAction
    ? 'Use the proposal handoff when organization or writeback should be reviewed before workspace changes.'
    : hasDraftAction
      ? 'Use the draft handoff to move this source-backed answer into Workbench for review.'
      : 'No Workbench artifact is suggested for this answer.';

  return {
    kind: 'next_actions',
    title: 'Workbench',
    content: [
      `Mode: ${mode}`,
      draftLine,
      actionLines.length > 0 ? `Available actions:\n${actionLines.join('\n')}` : 'Available actions: none',
      guidance,
      'Safety: no draft, proposal, memory, or workspace write is created until the user chooses an action or approves a tool request.',
    ].filter((line): line is string => Boolean(line)).join('\n'),
    synthetic: true,
  };
}

function buildAgentRunSection(message: ChatMessage): AgentResultSectionViewModel | null {
  const agentResult = message.agentResult;
  if (!agentResult) {
    return null;
  }

  const metadataLines = [
    `Agent session: ${agentResult.sessionId}`,
    agentResult.workflowLabel
      ? `Workflow: ${agentResult.workflowLabel}${agentResult.workflowInferred ? ' (auto)' : ''}`
      : null,
    agentResult.continuation ? `Continuation: ${agentResult.continuation.sourceSessionId}${agentResult.continuation.compactionId ? ` / ${agentResult.continuation.compactionId}` : ''}` : null,
    agentResult.planSource ? `Plan source: ${agentResult.planSource}` : null,
    agentResult.approvalStatus ?? null,
    agentResult.recoverySummary ?? null,
    agentResult.contextSummary && agentResult.contextSummary.omittedCount > 0
      ? `Context omitted: ${agentResult.contextSummary.omittedCount} item${agentResult.contextSummary.omittedCount === 1 ? '' : 's'} / ${agentResult.contextSummary.omittedTokens} tokens.`
      : null,
    agentResult.contextSummary?.modelSummaryStatus
      ? `Omitted summary: ${[
          agentResult.contextSummary.modelSummaryStatus,
          agentResult.contextSummary.modelSummaryQuality,
        ].filter(Boolean).join(' / ')}`
      : null,
    agentResult.contextSummary?.preview ? `Omitted preview: ${agentResult.contextSummary.preview}` : null,
    agentResult.contextSummary?.recoveryPlan ? `Recovery plan: ${agentResult.contextSummary.recoveryPlan}` : null,
    agentResult.memorySummary && agentResult.memorySummary.pendingSuggestionCount > 0
      ? `Memory suggestions: ${agentResult.memorySummary.pendingSuggestionCount} pending${agentResult.memorySummary.pendingSuggestionTitles?.length ? ` (${agentResult.memorySummary.pendingSuggestionTitles.join(', ')})` : ''}.`
      : null,
    ...(agentResult.warnings ?? []).map((warning) => `Warning: ${warning}`),
  ].filter((line): line is string => Boolean(line));

  if (metadataLines.length === 0) {
    return null;
  }

  return {
    kind: 'run',
    title: 'Run',
    content: metadataLines.join('\n'),
    synthetic: true,
  };
}

export function buildAgentResultSections(message: ChatMessage): AgentResultSectionViewModel[] | null {
  const agentResult = message.agentResult;
  if (!agentResult) {
    return null;
  }

  const sections: AgentResultSectionViewModel[] = [
    {
      kind: 'conclusion',
      title: 'Answer',
      content: message.content.split(/\n---\n/)[0]?.trim() || message.content,
      synthetic: true,
    },
  ];
  const runSection = buildAgentRunSection(message);
  if (runSection) {
    sections.push(runSection);
  }

  sections.push(buildAgentWorkbenchSection(message));

  const planLines = (agentResult.planSteps ?? []).map((step) =>
    `- ${step.status}: ${step.title}${step.toolName ? ` (${step.toolName})` : ''}`
  );
  if (planLines.length > 0) {
    sections.push({
      kind: 'plan',
      title: 'Plan',
      content: planLines.join('\n'),
      synthetic: true,
    });
  }

  const observationLines = buildAgentObservationLines(agentResult.toolObservations ?? []);
  if (observationLines.length > 0) {
    sections.push({
      kind: 'run',
      title: 'Observations',
      content: observationLines.join('\n'),
      synthetic: true,
    });
  }

  return sections;
}

export function summarizeAgentFollowUpKinds(actions: AiFollowUpAction[]): string {
  return buildCountSummary(actions.map((action) => action.kind));
}
