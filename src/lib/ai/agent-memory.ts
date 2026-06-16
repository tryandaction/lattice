import type { EvidenceRef } from './types';

export type AgentMemoryScope =
  | 'workspace'
  | 'project'
  | 'conversation'
  | 'user';

export type AgentMemoryStatus =
  | 'active'
  | 'disabled'
  | 'deleted';

export type AgentMemoryCandidateKind =
  | 'finding'
  | 'preference'
  | 'project_rule'
  | 'transient_state'
  | 'unknown';

export type AgentMemoryLifecycleStatus =
  | 'healthy'
  | 'stale'
  | 'weak'
  | 'review'
  | 'disabled'
  | 'deleted';

export type AgentMemoryLifecycleAction =
  | 'keep'
  | 'review'
  | 'refresh'
  | 'disable'
  | 'restore';

export interface AgentMemorySource {
  label: string;
  locator?: string;
  fingerprint?: string;
  evidenceRef?: EvidenceRef;
}

export interface AgentMemoryEntry {
  id: string;
  scope: AgentMemoryScope;
  title: string;
  content: string;
  source: AgentMemorySource;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  status: AgentMemoryStatus;
  tags?: string[];
  workspaceKey?: string;
  projectKey?: string;
  conversationId?: string;
  candidateKind?: AgentMemoryCandidateKind;
}

export interface CreateAgentMemoryEntryInput {
  id?: string;
  scope: AgentMemoryScope;
  title: string;
  content: string;
  source: AgentMemorySource;
  pinned?: boolean;
  tags?: string[];
  workspaceKey?: string;
  projectKey?: string;
  conversationId?: string;
  now?: number;
  candidateKind?: AgentMemoryCandidateKind;
}

export interface AgentMemorySuggestion extends CreateAgentMemoryEntryInput {
  reason: string;
  confidence: number;
  dedupeKey: string;
  sourceFingerprint?: string;
  candidateKind: AgentMemoryCandidateKind;
}

export type AgentMemorySuggestionEvaluationCode =
  | 'accepted'
  | 'duplicate_title'
  | 'duplicate_source'
  | 'low_confidence'
  | 'thin_content'
  | 'transient_state'
  | 'unknown_kind';

export interface AgentMemorySuggestionEvaluation {
  shouldSuggest: boolean;
  code: AgentMemorySuggestionEvaluationCode;
  reason: string;
  duplicateMemoryId?: string;
  policy?: AgentMemorySuggestionPolicyReview;
}

export type AgentMemorySuggestionPolicyDecision = 'approve' | 'review' | 'reject';

export interface AgentMemorySuggestionPolicyReview {
  decision: AgentMemorySuggestionPolicyDecision;
  confidenceAdjustment: number;
  reasons: string[];
  summary: string;
}

export interface AgentMemoryQuery {
  scopes?: AgentMemoryScope[];
  workspaceKey?: string;
  projectKey?: string;
  conversationId?: string;
  includeDisabled?: boolean;
  includeDeleted?: boolean;
  limit?: number;
}

export interface AgentMemoryRankingInput {
  entries: AgentMemoryEntry[];
  queryText: string;
  workspaceKey?: string;
  projectKey?: string;
  conversationId?: string;
  limit?: number;
  now?: number;
}

export interface AgentMemoryRankingItem {
  entry: AgentMemoryEntry;
  score: number;
  reasons: string[];
}

export interface AgentMemoryLifecycleEvaluation {
  status: AgentMemoryLifecycleStatus;
  recommendedAction: AgentMemoryLifecycleAction;
  scoreAdjustment: number;
  reasons: string[];
}

export type AgentMemoryReviewRecommendation = 'approve' | 'review' | 'reject';

export interface AgentMemoryReviewMetadata {
  candidateKind?: string;
  applicability?: string;
  evidenceSummary?: string;
  recoverySummary?: string;
  policySummary?: string;
  policyReasons?: string[];
  caution?: string;
}

export interface AgentMemoryReviewViewModelInput {
  memory: CreateAgentMemoryEntryInput;
  reason?: string;
  review?: AgentMemoryReviewMetadata;
}

export interface AgentMemoryReviewViewModel {
  recommendation: AgentMemoryReviewRecommendation;
  confidencePercent: number | null;
  candidateKind: string | null;
  title: string;
  contentPreview: string;
  primaryReason: string;
  evidenceLine: string | null;
  recoveryLine: string | null;
  policyLine: string | null;
  riskLine: string | null;
  provenanceLine: string;
}

function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function tokenizeMemoryText(value: string): string[] {
  const normalized = normalizeMemoryText(value).toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  return [...new Set(tokens)].slice(0, 80);
}

function countTokenOverlap(left: string[], right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }
  return count;
}

function memoryAgeDays(entry: AgentMemoryEntry, now: number): number {
  return Math.max(0, Math.floor((now - entry.updatedAt) / 86_400_000));
}

function staleAfterDays(entry: AgentMemoryEntry): number {
  if (entry.scope === 'conversation') {
    return 30;
  }
  if (entry.candidateKind === 'preference' || entry.candidateKind === 'project_rule') {
    return 365;
  }
  if (entry.scope === 'user') {
    return 365;
  }
  return 180;
}

export function evaluateAgentMemoryLifecycle(
  entry: AgentMemoryEntry,
  now = Date.now(),
): AgentMemoryLifecycleEvaluation {
  if (entry.status === 'deleted') {
    return {
      status: 'deleted',
      recommendedAction: 'restore',
      scoreAdjustment: -100,
      reasons: ['deleted'],
    };
  }
  if (entry.status === 'disabled') {
    return {
      status: 'disabled',
      recommendedAction: 'restore',
      scoreAdjustment: -30,
      reasons: ['disabled'],
    };
  }

  const reasons: string[] = [];
  const ageDays = memoryAgeDays(entry, now);
  const staleThreshold = staleAfterDays(entry);
  const hasProvenance = Boolean(
    entry.source.fingerprint ||
    entry.source.locator ||
    entry.source.evidenceRef?.locator,
  );
  const contentLength = normalizeMemoryText(entry.content).length;

  if (entry.pinned) {
    reasons.push('pinned');
  }
  if (ageDays >= staleThreshold) {
    reasons.push(`age:${ageDays}d`);
  }
  if (!hasProvenance) {
    reasons.push('weak-provenance');
  }
  if (contentLength < 120) {
    reasons.push('thin-content');
  }
  if (entry.candidateKind === 'transient_state' || entry.candidateKind === 'unknown') {
    reasons.push(`kind:${entry.candidateKind}`);
  }

  const reviewReasons = reasons.filter((reason) => reason !== 'pinned');
  if (reviewReasons.length === 0) {
    return {
      status: 'healthy',
      recommendedAction: 'keep',
      scoreAdjustment: 0,
      reasons: ['healthy'],
    };
  }

  if (entry.candidateKind === 'transient_state' || entry.candidateKind === 'unknown') {
    return {
      status: 'review',
      recommendedAction: 'disable',
      scoreAdjustment: entry.pinned ? -1 : -6,
      reasons,
    };
  }

  if (ageDays >= staleThreshold) {
    return {
      status: 'stale',
      recommendedAction: 'refresh',
      scoreAdjustment: entry.pinned ? -1 : -4,
      reasons,
    };
  }

  return {
    status: 'weak',
    recommendedAction: 'review',
    scoreAdjustment: entry.pinned ? 0 : -2,
    reasons,
  };
}

function inferAgentMemoryCandidateKind(input: {
  title: string;
  content: string;
  reason: string;
  explicitKind?: AgentMemoryCandidateKind;
}): AgentMemoryCandidateKind {
  if (input.explicitKind) {
    return input.explicitKind;
  }

  const text = normalizeMemoryText([
    input.title,
    input.content,
    input.reason,
  ].join(' ')).toLowerCase();
  if (/\b(todo|next step|pending|in progress|waiting|blocked|temporary|draft status|current task)\b/.test(text)) {
    return 'transient_state';
  }
  if (/\b(prefer|preference|always|style|tone|format|default)\b/.test(text)) {
    return 'preference';
  }
  if (/\b(rule|policy|constraint|must|requirement|workflow)\b/.test(text)) {
    return 'project_rule';
  }
  if (/\b(finding|evidence|result|shows|indicates|conclusion|claim|supports|demonstrates)\b/.test(text)) {
    return 'finding';
  }
  return 'unknown';
}

export function buildAgentMemoryDedupeKey(input: Pick<CreateAgentMemoryEntryInput, 'scope' | 'title' | 'workspaceKey' | 'projectKey' | 'conversationId'>): string {
  return [
    input.scope,
    input.workspaceKey ?? '',
    input.projectKey ?? '',
    input.conversationId ?? '',
    normalizeMemoryText(input.title).toLowerCase(),
  ].join(':');
}

export function buildAgentMemorySourceFingerprint(parts: Array<string | number | boolean | null | undefined>): string {
  const normalized = parts
    .map((part) => normalizeMemoryText(String(part ?? '')).toLowerCase())
    .filter(Boolean)
    .join('|');
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = Math.imul(31, hash) + normalized.charCodeAt(index) | 0;
  }
  return `mem-src-${Math.abs(hash).toString(36)}`;
}

export function createAgentMemoryEntry(input: CreateAgentMemoryEntryInput): AgentMemoryEntry {
  const now = input.now ?? Date.now();
  return {
    id: input.id ?? `agent-memory-${now}-${Math.random().toString(36).slice(2, 8)}`,
    scope: input.scope,
    title: input.title.trim(),
    content: input.content.trim(),
    source: input.source,
    createdAt: now,
    updatedAt: now,
    pinned: input.pinned ?? false,
    status: 'active',
    tags: input.tags,
    workspaceKey: input.workspaceKey,
    projectKey: input.projectKey,
    conversationId: input.conversationId,
    candidateKind: input.candidateKind,
  };
}

export function memoryEntryDedupeKey(entry: AgentMemoryEntry): string {
  return buildAgentMemoryDedupeKey(entry);
}

export function buildAgentMemorySuggestion(
  input: CreateAgentMemoryEntryInput & {
    reason: string;
    confidence?: number;
  },
): AgentMemorySuggestion | null {
  const title = normalizeMemoryText(input.title);
  const content = input.content.trim();
  if (!title || !content) {
    return null;
  }

  return {
    ...input,
    title,
    content,
    reason: normalizeMemoryText(input.reason),
    confidence: Math.max(0, Math.min(1, input.confidence ?? 0.6)),
    candidateKind: inferAgentMemoryCandidateKind({
      title,
      content,
      reason: input.reason,
      explicitKind: input.candidateKind,
    }),
    dedupeKey: buildAgentMemoryDedupeKey({
      scope: input.scope,
      title,
      workspaceKey: input.workspaceKey,
      projectKey: input.projectKey,
      conversationId: input.conversationId,
    }),
    sourceFingerprint: input.source.fingerprint,
  };
}

export function memoryMatchesQuery(entry: AgentMemoryEntry, query: AgentMemoryQuery = {}): boolean {
  if (!query.includeDeleted && entry.status === 'deleted') {
    return false;
  }
  if (!query.includeDisabled && entry.status === 'disabled') {
    return false;
  }
  if (query.scopes?.length && !query.scopes.includes(entry.scope)) {
    return false;
  }
  if (query.workspaceKey && entry.workspaceKey && entry.workspaceKey !== query.workspaceKey) {
    return false;
  }
  if (query.projectKey && entry.projectKey && entry.projectKey !== query.projectKey) {
    return false;
  }
  if (query.conversationId && entry.conversationId && entry.conversationId !== query.conversationId) {
    return false;
  }
  return true;
}

export function sortAgentMemoryEntries(entries: AgentMemoryEntry[]): AgentMemoryEntry[] {
  return [...entries].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    return right.updatedAt - left.updatedAt;
  });
}

export function rankAgentMemoryEntriesForContext(input: AgentMemoryRankingInput): AgentMemoryRankingItem[] {
  const queryTokens = new Set(tokenizeMemoryText(input.queryText));
  const now = input.now ?? Date.now();
  const ranked = input.entries.map((entry) => {
    const reasons: string[] = [];
    let score = 0;
    const lifecycle = evaluateAgentMemoryLifecycle(entry, now);

    if (entry.pinned) {
      score += 6;
      reasons.push('pinned');
    }
    if (input.workspaceKey && entry.workspaceKey === input.workspaceKey) {
      score += 3;
      reasons.push('workspace');
    }
    if (input.projectKey && entry.projectKey === input.projectKey) {
      score += 3;
      reasons.push('project');
    }
    if (input.conversationId && entry.conversationId === input.conversationId) {
      score += 3;
      reasons.push('conversation');
    }
    if (entry.candidateKind) {
      const kindToken = entry.candidateKind.replace('_', '-');
      const queryText = input.queryText.toLowerCase();
      if (entry.candidateKind === 'finding' && /\b(finding|evidence|claim|result|conclusion|research)\b/.test(queryText)) {
        score += 3;
        reasons.push('kind:finding');
      } else if (entry.candidateKind === 'preference' && /\b(prefer|preference|style|tone|format|default)\b/.test(queryText)) {
        score += 3;
        reasons.push('kind:preference');
      } else if (entry.candidateKind === 'project_rule' && /\b(rule|policy|constraint|requirement|workflow|must)\b/.test(queryText)) {
        score += 3;
        reasons.push('kind:project-rule');
      } else {
        reasons.push(`kind:${kindToken}`);
      }
    }

    const titleOverlap = countTokenOverlap(tokenizeMemoryText(entry.title), queryTokens);
    const contentOverlap = countTokenOverlap(tokenizeMemoryText(entry.content), queryTokens);
    const sourceOverlap = countTokenOverlap(tokenizeMemoryText([
      entry.source.label,
      entry.source.locator ?? '',
      entry.source.evidenceRef?.label ?? '',
      entry.source.evidenceRef?.locator ?? '',
      ...(entry.tags ?? []),
    ].join(' ')), queryTokens);

    if (titleOverlap > 0) {
      score += titleOverlap * 4;
      reasons.push(`title:${titleOverlap}`);
    }
    if (contentOverlap > 0) {
      score += Math.min(contentOverlap, 8) * 2;
      reasons.push(`content:${contentOverlap}`);
    }
    if (sourceOverlap > 0) {
      score += Math.min(sourceOverlap, 4) * 2;
      reasons.push(`source:${sourceOverlap}`);
    }

    if (lifecycle.status !== 'healthy') {
      score += lifecycle.scoreAdjustment;
      reasons.push(`lifecycle:${lifecycle.status}`);
      reasons.push(...lifecycle.reasons.slice(0, 2));
    }

    if (score === 0) {
      reasons.push('recency');
    }

    return {
      entry,
      score,
      reasons,
    };
  });

  ranked.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.entry.pinned !== right.entry.pinned) {
      return left.entry.pinned ? -1 : 1;
    }
    return right.entry.updatedAt - left.entry.updatedAt;
  });

  return typeof input.limit === 'number' ? ranked.slice(0, input.limit) : ranked;
}

export function formatAgentMemoryCitation(entry: AgentMemoryEntry): string {
  const locator = entry.source.locator ? ` (${entry.source.locator})` : '';
  return `[${entry.scope}] ${entry.title} - ${entry.source.label}${locator}`;
}

function truncateMemoryReviewText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = normalizeMemoryText(value ?? '');
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...` : normalized;
}

function parseMemoryReviewConfidence(policySummary?: string): number | null {
  const match = policySummary?.match(/adjusted=(\d+)%/i);
  if (!match) {
    return null;
  }
  return Math.max(0, Math.min(100, Number(match[1])));
}

function parseMemoryReviewRecommendation(input: AgentMemoryReviewViewModelInput): AgentMemoryReviewRecommendation {
  const policy = input.review?.policySummary?.trim().toLowerCase() ?? '';
  const kind = input.review?.candidateKind?.trim().toLowerCase() ?? input.memory.candidateKind ?? '';
  if (policy.startsWith('reject') || kind === 'transient_state' || kind === 'unknown') {
    return 'reject';
  }
  if (policy.startsWith('review')) {
    return 'review';
  }
  return 'approve';
}

function buildMemoryReviewRiskLine(review?: AgentMemoryReviewMetadata): string | null {
  const risks = [
    ...(review?.policyReasons ?? []),
    review?.caution ?? '',
  ]
    .map((item) => normalizeMemoryText(item))
    .filter((item) =>
      /weak|unclear|broad|transient|unknown|caution|review|confidence|too-|reject/i.test(item),
    );
  return truncateMemoryReviewText([...new Set(risks)].join(', '), 180);
}

export function buildAgentMemoryReviewViewModel(
  input: AgentMemoryReviewViewModelInput,
): AgentMemoryReviewViewModel {
  const review = input.review;
  const candidateKind = truncateMemoryReviewText(review?.candidateKind ?? input.memory.candidateKind ?? null, 40);
  const reason = truncateMemoryReviewText(input.reason, 220);
  const caution = truncateMemoryReviewText(review?.caution, 220);
  const applicability = truncateMemoryReviewText(review?.applicability, 180);
  const evidence = truncateMemoryReviewText(review?.evidenceSummary, 180);
  const recovery = truncateMemoryReviewText(review?.recoverySummary, 180);
  const policy = truncateMemoryReviewText(review?.policySummary, 180);
  const locator = truncateMemoryReviewText(input.memory.source.locator, 160);

  return {
    recommendation: parseMemoryReviewRecommendation(input),
    confidencePercent: parseMemoryReviewConfidence(review?.policySummary),
    candidateKind,
    title: truncateMemoryReviewText(input.memory.title, 120) ?? 'Memory suggestion',
    contentPreview: truncateMemoryReviewText(input.memory.content, 260) ?? '',
    primaryReason: reason ?? caution ?? 'Suggested for future Research Agent runs.',
    evidenceLine: evidence ?? applicability,
    recoveryLine: recovery,
    policyLine: policy,
    riskLine: buildMemoryReviewRiskLine(review),
    provenanceLine: [input.memory.source.label, locator].filter(Boolean).join(' / '),
  };
}

export function shouldSuggestAgentMemory(
  suggestion: AgentMemorySuggestion,
  existingEntries: AgentMemoryEntry[],
): boolean {
  return evaluateAgentMemorySuggestion(suggestion, existingEntries).shouldSuggest;
}

export function reviewAgentMemorySuggestionPolicy(
  suggestion: AgentMemorySuggestion,
): AgentMemorySuggestionPolicyReview {
  const content = normalizeMemoryText(suggestion.content);
  const text = [
    suggestion.title,
    suggestion.reason,
    content,
    suggestion.source.label,
    suggestion.source.locator ?? '',
    suggestion.source.evidenceRef?.locator ?? '',
  ].join(' ').toLowerCase();
  const reasons: string[] = [];
  let confidenceAdjustment = 0;
  let decision: AgentMemorySuggestionPolicyDecision = 'approve';

  const hasStrongProvenance = Boolean(
    suggestion.sourceFingerprint ||
    suggestion.source.locator ||
    suggestion.source.evidenceRef?.locator,
  );
  const hasEvidenceCue = /\b(evidence|source|citation|context pack|locator|finding|result|claim|supports|demonstrates)\b/.test(text);
  const hasReusableCue = /\b(reusable|future|remember|finding|preference|rule|policy|always|default|conclusion)\b/.test(text);
  const hasTransientCue = /\b(todo|pending|in progress|waiting|blocked|temporary|draft status)\b/.test(text);
  const hasAnswerDumpCue = content.length > 1400 || (content.match(/\n/g)?.length ?? 0) > 18;

  if (!hasStrongProvenance) {
    reasons.push('weak-provenance');
    confidenceAdjustment -= 0.1;
    decision = 'review';
  } else {
    reasons.push('provenance:ok');
  }
  if (suggestion.candidateKind === 'finding' && !hasEvidenceCue) {
    reasons.push('finding:weak-evidence');
    confidenceAdjustment -= 0.15;
    decision = 'review';
  }
  if (!hasReusableCue) {
    reasons.push('reuse:unclear');
    confidenceAdjustment -= 0.1;
    decision = 'review';
  } else {
    reasons.push('reuse:ok');
  }
  if (hasAnswerDumpCue) {
    reasons.push('content:too-broad');
    confidenceAdjustment -= 0.1;
    decision = 'review';
  }
  if (hasTransientCue || suggestion.candidateKind === 'transient_state') {
    reasons.push('transient-state');
    confidenceAdjustment -= 0.4;
    decision = 'reject';
  }
  if (suggestion.candidateKind === 'unknown') {
    reasons.push('kind:unknown');
    confidenceAdjustment -= 0.3;
    decision = 'reject';
  }

  const adjustedConfidence = Math.max(0, Math.min(1, suggestion.confidence + confidenceAdjustment));
  if (decision === 'approve' && adjustedConfidence < 0.62) {
    decision = 'review';
    reasons.push('confidence:review');
  }

  return {
    decision,
    confidenceAdjustment,
    reasons,
    summary: `${decision} / adjusted=${Math.round(adjustedConfidence * 100)}% / ${reasons.join(', ')}`.slice(0, 500),
  };
}

export function evaluateAgentMemorySuggestion(
  suggestion: AgentMemorySuggestion,
  existingEntries: AgentMemoryEntry[],
): AgentMemorySuggestionEvaluation {
  const policy = reviewAgentMemorySuggestionPolicy(suggestion);
  const adjustedConfidence = Math.max(0, Math.min(1, suggestion.confidence + policy.confidenceAdjustment));

  if (suggestion.confidence < 0.5) {
    return {
      shouldSuggest: false,
      code: 'low_confidence',
      reason: `Memory candidate confidence ${Math.round(adjustedConfidence * 100)}% is below the approval threshold after policy review.`,
      policy,
    };
  }

  if (suggestion.candidateKind === 'transient_state') {
    return {
      shouldSuggest: false,
      code: 'transient_state',
      reason: 'Memory candidate looks like temporary task state, so it should stay in the session trace instead of long-term memory.',
      policy,
    };
  }

  if (normalizeMemoryText(suggestion.content).length < 80) {
    return {
      shouldSuggest: false,
      code: 'thin_content',
      reason: 'Memory candidate content is too short to be useful across future research runs.',
      policy,
    };
  }

  if (suggestion.candidateKind === 'unknown') {
    return {
      shouldSuggest: false,
      code: 'unknown_kind',
      reason: 'Memory candidate kind is unclear; require a more specific reusable finding, preference, or project rule before approval.',
      policy,
    };
  }

  if (policy.decision === 'reject') {
    const transient = policy.reasons.includes('transient-state');
    return {
      shouldSuggest: false,
      code: transient ? 'transient_state' : 'unknown_kind',
      reason: transient
        ? 'Memory policy rejected temporary task state; keep it in the session trace instead of long-term memory.'
        : 'Memory policy rejected an unclear candidate kind; require a reusable finding, preference, or project rule.',
      policy,
    };
  }

  if (adjustedConfidence < 0.5) {
    return {
      shouldSuggest: false,
      code: 'low_confidence',
      reason: `Memory candidate confidence ${Math.round(adjustedConfidence * 100)}% is below the approval threshold after policy review.`,
      policy,
    };
  }

  const duplicateTitle = existingEntries.find((entry) =>
    entry.status !== 'deleted' &&
    memoryEntryDedupeKey(entry) === suggestion.dedupeKey,
  );
  if (duplicateTitle) {
    return {
      shouldSuggest: false,
      code: 'duplicate_title',
      reason: `A memory with the same scope and title already exists: ${duplicateTitle.title}.`,
      duplicateMemoryId: duplicateTitle.id,
      policy,
    };
  }

  const duplicateSource = suggestion.sourceFingerprint
    ? existingEntries.find((entry) =>
        entry.status !== 'deleted' &&
        entry.source.fingerprint === suggestion.sourceFingerprint,
      )
    : null;
  if (duplicateSource) {
    return {
      shouldSuggest: false,
      code: 'duplicate_source',
      reason: `A memory from the same source fingerprint already exists: ${duplicateSource.title}.`,
      duplicateMemoryId: duplicateSource.id,
      policy,
    };
  }

  return {
    shouldSuggest: true,
    code: 'accepted',
    reason: policy.decision === 'review'
      ? `Memory candidate passed approval gate with policy review: ${policy.summary}`
      : 'Memory candidate is sufficiently specific and not already represented in saved memory.',
    policy,
  };
}
