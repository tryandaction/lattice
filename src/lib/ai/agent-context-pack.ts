import { estimateTokens } from './token-estimator';
import type { AgentMemoryEntry } from './agent-memory';
import type { AiContextNode, EvidenceRef } from './types';

export type AgentContextPackSource =
  | 'explicit_evidence'
  | 'selection'
  | 'active_file'
  | 'workspace_chunk'
  | 'memory'
  | 'heavy_input';

export interface AgentContextPackBudget {
  maxTokens: number;
  bySource: Partial<Record<AgentContextPackSource, number>>;
}

export interface AgentContextPackItemInput {
  id: string;
  source: AgentContextPackSource;
  label: string;
  content: string;
  priority: number;
  evidenceRef?: EvidenceRef;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AgentContextPackItem extends AgentContextPackItemInput {
  tokenEstimate: number;
}

export interface AgentContextPackSourceSummary {
  source: AgentContextPackSource;
  budgetTokens: number;
  usedTokens: number;
  includedCount: number;
  omittedCount: number;
}

export interface AgentContextPackOmittedSourceSummary {
  source: AgentContextPackSource;
  omittedCount: number;
  omittedTokens: number;
  labels: string[];
  contentPreviews: string[];
}

export interface AgentContextPackOmittedRecoveryHint {
  source: AgentContextPackSource;
  label: string;
  tokenEstimate: number;
  contentPreview: string;
  locator: string | null;
  priorityScore: number;
  priorityReason: string;
}

export type AgentContextPackOmittedRecoveryAction = 'read_indexed_context' | 'use_semantic_preview';

export interface AgentContextPackOmittedRecoveryPlanItem extends AgentContextPackOmittedRecoveryHint {
  recoveryAction: AgentContextPackOmittedRecoveryAction;
  whyOmitted: string;
}

export interface AgentContextPackOmittedAutoSummaryItem {
  source: AgentContextPackSource;
  omittedCount: number;
  omittedTokens: number;
  labels: string[];
  keywords: string[];
  representativePreviews: string[];
  summary: string;
}

export interface AgentContextPackOmittedSummary {
  totalOmittedCount: number;
  totalOmittedTokens: number;
  bySource: AgentContextPackOmittedSourceSummary[];
  preview: string;
  semanticPreview: string;
  autoSummary: AgentContextPackOmittedAutoSummaryItem[];
  autoSummaryPreview: string;
  recoveryHints: AgentContextPackOmittedRecoveryHint[];
  recoveryHintsPreview: string;
  recoveryPriorityPreview: string;
  recoveryPlan: AgentContextPackOmittedRecoveryPlanItem[];
  recoveryPlanPreview: string;
}

export interface AgentContextPack {
  id: string;
  createdAt: number;
  budget: AgentContextPackBudget;
  sections: AgentContextPackItem[];
  omitted: AgentContextPackItem[];
  evidenceRefs: EvidenceRef[];
  sourceSummaries: AgentContextPackSourceSummary[];
  omittedSummary: AgentContextPackOmittedSummary;
  prompt: string;
  tokenEstimate: number;
  truncated: boolean;
}

export interface BuildAgentContextPackInput {
  id?: string;
  budget?: Partial<AgentContextPackBudget> & {
    bySource?: Partial<Record<AgentContextPackSource, number>>;
  };
  explicitEvidenceRefs?: EvidenceRef[];
  selection?: {
    text: string;
    label?: string;
    evidenceRef?: EvidenceRef;
  };
  activeFile?: {
    path: string;
    summary: string;
    evidenceRef?: EvidenceRef;
  };
  workspaceChunks?: Array<{
    id: string;
    path: string;
    label: string;
    content: string;
    evidenceRef?: EvidenceRef;
  }>;
  memoryEntries?: AgentMemoryEntry[];
  heavyInputs?: Array<{
    id: string;
    label: string;
    content: string;
    evidenceRef?: EvidenceRef;
  }>;
  contextNodes?: AiContextNode[];
  now?: number;
}

const DEFAULT_SOURCE_BUDGETS: Record<AgentContextPackSource, number> = {
  explicit_evidence: 1800,
  selection: 3000,
  active_file: 5000,
  workspace_chunk: 7000,
  memory: 2500,
  heavy_input: 2000,
};

const DEFAULT_BUDGET: AgentContextPackBudget = {
  maxTokens: 16000,
  bySource: DEFAULT_SOURCE_BUDGETS,
};

function sourceTitle(source: AgentContextPackSource): string {
  switch (source) {
    case 'explicit_evidence':
      return 'Explicit evidence';
    case 'selection':
      return 'Selected text';
    case 'active_file':
      return 'Active file summary';
    case 'workspace_chunk':
      return 'Relevant workspace context';
    case 'memory':
      return 'Scoped memory';
    case 'heavy_input':
      return 'Optional heavy input';
  }
}

function itemToPromptSection(item: AgentContextPackItemInput): string {
  return `## ${sourceTitle(item.source)}: ${item.label}\n${item.content}`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildOmittedContentPreview(item: AgentContextPackItem): string | null {
  const content = truncateText(item.content, 140);
  if (!content) {
    return null;
  }
  return `${item.label}: ${content}`;
}

const OMITTED_SUMMARY_STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'and',
  'are',
  'because',
  'been',
  'before',
  'between',
  'context',
  'from',
  'have',
  'into',
  'note',
  'notes',
  'that',
  'the',
  'their',
  'this',
  'through',
  'with',
  'workspace',
]);

function extractOmittedKeywords(items: AgentContextPackItem[]): string[] {
  const counts = new Map<string, number>();
  const text = items
    .flatMap((item) => [item.label, item.content.slice(0, 500)])
    .join(' ')
    .toLowerCase();
  for (const raw of text.match(/[a-z][a-z0-9_-]{3,}/g) ?? []) {
    const word = raw.replace(/^[-_]+|[-_]+$/g, '');
    if (!word || OMITTED_SUMMARY_STOP_WORDS.has(word)) {
      continue;
    }
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([word]) => word);
}

function buildOmittedAutoSummaryItem(
  source: AgentContextPackSource,
  items: AgentContextPackItem[],
): AgentContextPackOmittedAutoSummaryItem | null {
  if (items.length === 0) {
    return null;
  }

  const labels = items.slice(0, 4).map((item) => item.label);
  const representativePreviews = items
    .slice(0, 3)
    .map(buildOmittedContentPreview)
    .filter((preview): preview is string => Boolean(preview));
  const omittedTokens = items.reduce((sum, item) => sum + item.tokenEstimate, 0);
  const keywords = extractOmittedKeywords(items);
  const summary = [
    `${source}: ${items.length} omitted item${items.length === 1 ? '' : 's'}`,
    `${omittedTokens} tokens`,
    labels.length > 0 ? `labels=${labels.join('; ')}` : null,
    keywords.length > 0 ? `keywords=${keywords.join(', ')}` : null,
    representativePreviews.length > 0 ? `examples=${representativePreviews.join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');

  return {
    source,
    omittedCount: items.length,
    omittedTokens,
    labels,
    keywords,
    representativePreviews,
    summary,
  };
}

function buildOmittedRecoveryHint(item: AgentContextPackItem): AgentContextPackOmittedRecoveryHint | null {
  const contentPreview = truncateText(item.content, 180);
  if (!contentPreview) {
    return null;
  }
  const locator = item.evidenceRef?.locator ?? (typeof item.metadata?.path === 'string' ? item.metadata.path : null);
  const sourceWeight: Record<AgentContextPackSource, number> = {
    explicit_evidence: 40,
    selection: 35,
    active_file: 28,
    workspace_chunk: 24,
    memory: 18,
    heavy_input: 16,
  };
  const tokenWeight = Math.min(25, Math.ceil(item.tokenEstimate / 80));
  const priorityScore = item.priority + sourceWeight[item.source] + tokenWeight + (locator ? 8 : 0);
  const priorityReason = [
    `priority=${item.priority}`,
    `source=${item.source}`,
    `tokens=${item.tokenEstimate}`,
    locator ? 'locator' : null,
  ].filter(Boolean).join(',');

  return {
    source: item.source,
    label: item.label,
    tokenEstimate: item.tokenEstimate,
    contentPreview,
    locator,
    priorityScore,
    priorityReason,
  };
}

function whyOmitted(source: AgentContextPackSource): string {
  return `budget_limited:${source}`;
}

function buildOmittedRecoveryPlanItem(
  hint: AgentContextPackOmittedRecoveryHint,
): AgentContextPackOmittedRecoveryPlanItem {
  return {
    ...hint,
    recoveryAction: hint.locator ? 'read_indexed_context' : 'use_semantic_preview',
    whyOmitted: whyOmitted(hint.source),
  };
}

function formatOmittedRecoveryHint(hint: AgentContextPackOmittedRecoveryHint): string {
  const locator = hint.locator ? ` @ ${hint.locator}` : '';
  return `${hint.source}: ${hint.label}${locator} (${hint.tokenEstimate} tokens) - ${hint.contentPreview}`;
}

function formatOmittedRecoveryPriority(hint: AgentContextPackOmittedRecoveryHint): string {
  const locator = hint.locator ? ` @ ${hint.locator}` : '';
  return `${hint.source}: ${hint.label}${locator} score=${hint.priorityScore} (${hint.priorityReason})`;
}

function formatOmittedRecoveryPlanItem(item: AgentContextPackOmittedRecoveryPlanItem, index: number): string {
  const locator = item.locator ? ` @ ${item.locator}` : '';
  return [
    `${index + 1}. ${item.recoveryAction}`,
    `${item.source}: ${item.label}${locator}`,
    `reason=${item.whyOmitted}`,
    `score=${item.priorityScore}`,
    `preview=${item.contentPreview}`,
  ].join(' | ');
}

function joinBounded(parts: string[], maxLength: number): string {
  const result: string[] = [];
  let length = 0;

  for (const part of parts) {
    const nextLength = length + (result.length > 0 ? 3 : 0) + part.length;
    if (nextLength > maxLength) {
      break;
    }
    result.push(part);
    length = nextLength;
  }

  if (result.length === 0 && parts[0]) {
    return truncateText(parts[0], maxLength);
  }

  return result.join(' / ');
}

function buildOmittedSummary(omitted: AgentContextPackItem[]): AgentContextPackOmittedSummary {
  const bySource = (Object.keys(DEFAULT_SOURCE_BUDGETS) as AgentContextPackSource[])
    .map((source) => {
      const items = omitted.filter((item) => item.source === source);
      return {
        source,
        omittedCount: items.length,
        omittedTokens: items.reduce((sum, item) => sum + item.tokenEstimate, 0),
        labels: items.slice(0, 4).map((item) => item.label),
        contentPreviews: items
          .slice(0, 3)
          .map(buildOmittedContentPreview)
          .filter((preview): preview is string => Boolean(preview)),
      };
    })
    .filter((summary) => summary.omittedCount > 0);
  const totalOmittedCount = omitted.length;
  const totalOmittedTokens = omitted.reduce((sum, item) => sum + item.tokenEstimate, 0);
  const preview = bySource.length > 0
    ? bySource
        .map((summary) => `${summary.source}: ${summary.omittedCount} omitted${summary.labels.length ? ` (${summary.labels.join('; ')})` : ''}`)
        .join(' / ')
    : 'No omitted context.';
  const semanticPreview = bySource.length > 0
    ? joinBounded(
        bySource.flatMap((summary) =>
          summary.contentPreviews.map((contentPreview) => `${summary.source}: ${contentPreview}`),
        ),
        900,
      ) || 'No omitted content preview available.'
    : 'No omitted context.';
  const autoSummary = (Object.keys(DEFAULT_SOURCE_BUDGETS) as AgentContextPackSource[])
    .map((source) => buildOmittedAutoSummaryItem(source, omitted.filter((item) => item.source === source)))
    .filter((summary): summary is AgentContextPackOmittedAutoSummaryItem => Boolean(summary));
  const autoSummaryPreview = autoSummary.length > 0
    ? joinBounded(autoSummary.map((summary) => summary.summary), 1200)
    : 'No omitted auto summary.';
  const recoveryHints = omitted
    .slice()
    .map(buildOmittedRecoveryHint)
    .filter((hint): hint is AgentContextPackOmittedRecoveryHint => Boolean(hint))
    .sort((left, right) => right.priorityScore - left.priorityScore || right.tokenEstimate - left.tokenEstimate)
    .slice(0, 5);
  const recoveryHintsPreview = recoveryHints.length > 0
    ? joinBounded(recoveryHints.map(formatOmittedRecoveryHint), 900)
    : 'No omitted recovery hints.';
  const recoveryPriorityPreview = recoveryHints.length > 0
    ? joinBounded(recoveryHints.map(formatOmittedRecoveryPriority), 900)
    : 'No omitted recovery priorities.';
  const recoveryPlan = recoveryHints.map(buildOmittedRecoveryPlanItem);
  const recoveryPlanPreview = recoveryPlan.length > 0
    ? joinBounded(recoveryPlan.map(formatOmittedRecoveryPlanItem), 1100)
    : 'No omitted recovery plan.';

  return {
    totalOmittedCount,
    totalOmittedTokens,
    bySource,
    preview,
    semanticPreview,
    autoSummary,
    autoSummaryPreview,
    recoveryHints,
    recoveryHintsPreview,
    recoveryPriorityPreview,
    recoveryPlan,
    recoveryPlanPreview,
  };
}

function evidenceKey(ref: EvidenceRef): string {
  return `${ref.kind}:${ref.locator}:${JSON.stringify(ref.anchor ?? {})}`;
}

function uniqEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = evidenceKey(ref);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function applyBudgetDefaults(input?: BuildAgentContextPackInput['budget']): AgentContextPackBudget {
  return {
    maxTokens: input?.maxTokens ?? DEFAULT_BUDGET.maxTokens,
    bySource: {
      ...DEFAULT_SOURCE_BUDGETS,
      ...(input?.bySource ?? {}),
    },
  };
}

function explicitEvidenceItems(refs: EvidenceRef[] = []): AgentContextPackItemInput[] {
  return refs.map((ref, index) => ({
    id: `explicit-evidence-${index}`,
    source: 'explicit_evidence',
    label: ref.label,
    content: [
      `Locator: ${ref.locator}`,
      ref.preview ? `Preview: ${ref.preview}` : null,
    ].filter(Boolean).join('\n'),
    priority: 110,
    evidenceRef: ref,
  }));
}

function contextNodeItems(nodes: AiContextNode[] = []): AgentContextPackItemInput[] {
  return nodes.map((node) => ({
    id: `context-node-${node.id}`,
    source: node.kind === 'selection'
      ? 'selection'
      : node.kind === 'workspace_chunk'
        ? 'workspace_chunk'
        : 'active_file',
    label: node.label,
    content: node.content,
    priority: node.priority,
    evidenceRef: node.evidenceRef,
  }));
}

function memoryItems(entries: AgentMemoryEntry[] = []): AgentContextPackItemInput[] {
  return entries.map((entry) => ({
    id: `memory-${entry.id}`,
    source: 'memory',
    label: `${entry.scope}: ${entry.title}`,
    content: [
      entry.content,
      `Source: ${entry.source.label}${entry.source.locator ? ` (${entry.source.locator})` : ''}`,
    ].join('\n'),
    priority: entry.pinned ? 92 : 72,
    evidenceRef: entry.source.evidenceRef,
    metadata: {
      memoryId: entry.id,
      scope: entry.scope,
      pinned: entry.pinned,
    },
  }));
}

function buildCandidateItems(input: BuildAgentContextPackInput): AgentContextPackItemInput[] {
  const candidates: AgentContextPackItemInput[] = [
    ...explicitEvidenceItems(input.explicitEvidenceRefs),
    ...contextNodeItems(input.contextNodes),
    ...memoryItems(input.memoryEntries),
  ];

  if (input.selection?.text.trim()) {
    candidates.push({
      id: 'selection',
      source: 'selection',
      label: input.selection.label ?? 'Current selection',
      content: input.selection.text.trim(),
      priority: 100,
      evidenceRef: input.selection.evidenceRef,
    });
  }

  if (input.activeFile?.summary.trim()) {
    candidates.push({
      id: `active-file-${input.activeFile.path}`,
      source: 'active_file',
      label: input.activeFile.path,
      content: input.activeFile.summary.trim(),
      priority: 86,
      evidenceRef: input.activeFile.evidenceRef,
    });
  }

  for (const chunk of input.workspaceChunks ?? []) {
    candidates.push({
      id: `workspace-${chunk.id}`,
      source: 'workspace_chunk',
      label: `${chunk.path} / ${chunk.label}`,
      content: chunk.content,
      priority: 60,
      evidenceRef: chunk.evidenceRef,
    });
  }

  for (const heavy of input.heavyInputs ?? []) {
    candidates.push({
      id: `heavy-${heavy.id}`,
      source: 'heavy_input',
      label: heavy.label,
      content: heavy.content,
      priority: 25,
      evidenceRef: heavy.evidenceRef,
    });
  }

  return candidates.filter((item) => item.content.trim().length > 0);
}

export function buildAgentContextPack(input: BuildAgentContextPackInput): AgentContextPack {
  const budget = applyBudgetDefaults(input.budget);
  const sourceUsage = new Map<AgentContextPackSource, number>();
  const candidates = buildCandidateItems(input)
    .map((item) => ({
      ...item,
      content: item.content.trim(),
      tokenEstimate: estimateTokens(itemToPromptSection(item)),
    }))
    .sort((left, right) => right.priority - left.priority);

  const sections: AgentContextPackItem[] = [];
  const omitted: AgentContextPackItem[] = [];
  let totalTokens = 0;

  for (const item of candidates) {
    const sourceBudget = budget.bySource[item.source] ?? 0;
    const usedBySource = sourceUsage.get(item.source) ?? 0;
    const fitsSource = usedBySource + item.tokenEstimate <= sourceBudget;
    const fitsTotal = totalTokens + item.tokenEstimate <= budget.maxTokens;

    if (fitsSource && fitsTotal) {
      sections.push(item);
      sourceUsage.set(item.source, usedBySource + item.tokenEstimate);
      totalTokens += item.tokenEstimate;
    } else {
      omitted.push(item);
    }
  }

  const evidenceRefs = uniqEvidence([
    ...(input.explicitEvidenceRefs ?? []),
    ...sections.flatMap((item) => item.evidenceRef ? [item.evidenceRef] : []),
  ]);

  const sourceSummaries = (Object.keys(DEFAULT_SOURCE_BUDGETS) as AgentContextPackSource[])
    .map((source) => ({
      source,
      budgetTokens: budget.bySource[source] ?? 0,
      usedTokens: sourceUsage.get(source) ?? 0,
      includedCount: sections.filter((item) => item.source === source).length,
      omittedCount: omitted.filter((item) => item.source === source).length,
    }));
  const omittedSummary = buildOmittedSummary(omitted);

  const promptSections = sections.map(itemToPromptSection);
  if (evidenceRefs.length > 0) {
    promptSections.push(`## Evidence References\n${evidenceRefs
      .map((ref) => `- ${ref.label} -> ${ref.locator}${ref.preview ? ` | ${normalizeWhitespace(ref.preview)}` : ''}`)
      .join('\n')}`);
  }
  if (omittedSummary.totalOmittedCount > 0) {
    promptSections.push([
      '## Omitted context summary',
      omittedSummary.preview,
      `Estimated omitted tokens: ${omittedSummary.totalOmittedTokens}`,
      `Omitted auto summary: ${omittedSummary.autoSummaryPreview}`,
      `Omitted content preview: ${omittedSummary.semanticPreview}`,
      `Omitted recovery hints: ${omittedSummary.recoveryHintsPreview}`,
      `Omitted recovery priority: ${omittedSummary.recoveryPriorityPreview}`,
      `Omitted recovery plan: ${omittedSummary.recoveryPlanPreview}`,
    ].join('\n'));
  }

  return {
    id: input.id ?? `context-pack-${input.now ?? Date.now()}`,
    createdAt: input.now ?? Date.now(),
    budget,
    sections,
    omitted,
    evidenceRefs,
    sourceSummaries,
    omittedSummary,
    prompt: promptSections.join('\n\n'),
    tokenEstimate: totalTokens,
    truncated: omitted.length > 0,
  };
}
