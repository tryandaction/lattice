import { describe, expect, it } from 'vitest';

import {
  buildAgentMemoryReviewViewModel,
  buildAgentMemorySourceFingerprint,
  buildAgentMemorySuggestion,
  createAgentMemoryEntry,
  evaluateAgentMemoryLifecycle,
  evaluateAgentMemorySuggestion,
  rankAgentMemoryEntriesForContext,
  reviewAgentMemorySuggestionPolicy,
  shouldSuggestAgentMemory,
} from '../ai/agent-memory';

describe('agent-memory', () => {
  it('creates stable source fingerprints from normalized source parts', () => {
    const first = buildAgentMemorySourceFingerprint([
      'Workspace A',
      'reading-note',
      'Alpha query',
      'notes/alpha.md',
    ]);
    const second = buildAgentMemorySourceFingerprint([
      ' workspace   a ',
      'READING-NOTE',
      'Alpha query',
      'notes/alpha.md',
    ]);

    expect(first).toBe(second);
    expect(first).toMatch(/^mem-src-/);
  });

  it('dedupes memory suggestions by source fingerprint as well as title key', () => {
    const fingerprint = buildAgentMemorySourceFingerprint(['workspace-a', 'alpha', 'notes/alpha.md']);
    const existing = createAgentMemoryEntry({
      id: 'memory-existing',
      scope: 'workspace',
      title: 'Different title',
      content: 'Alpha should be remembered.',
      source: {
        label: 'Research Agent suggestion',
        locator: 'agent-session://one',
        fingerprint,
      },
      workspaceKey: 'workspace-a',
      now: 100,
    });
    const suggestion = buildAgentMemorySuggestion({
      scope: 'workspace',
      title: 'New title',
      content: 'Alpha should be remembered in a fresh wording because this reusable research finding should carry across future workspace runs.',
      source: {
        label: 'Research Agent suggestion',
        locator: 'agent-session://two',
        fingerprint,
      },
      workspaceKey: 'workspace-a',
      reason: 'Same source finding.',
      now: 200,
    });

    expect(suggestion?.sourceFingerprint).toBe(fingerprint);
    expect(suggestion && shouldSuggestAgentMemory(suggestion, [existing])).toBe(false);
    expect(suggestion && evaluateAgentMemorySuggestion(suggestion, [existing])).toMatchObject({
      shouldSuggest: false,
      code: 'duplicate_source',
      duplicateMemoryId: 'memory-existing',
    });
  });

  it('explains low-quality memory candidates before approval', () => {
    const lowConfidence = buildAgentMemorySuggestion({
      scope: 'conversation',
      title: 'Maybe useful',
      content: 'This candidate has enough words to avoid the thin-content gate but low confidence.',
      source: { label: 'Research Agent suggestion' },
      reason: 'Weak evidence.',
      confidence: 0.2,
    });
    const thinContent = buildAgentMemorySuggestion({
      scope: 'conversation',
      title: 'Thin',
      content: 'Too short.',
      source: { label: 'Research Agent suggestion' },
      reason: 'Too little content.',
      confidence: 0.9,
    });

    expect(lowConfidence && evaluateAgentMemorySuggestion(lowConfidence, [])).toMatchObject({
      shouldSuggest: false,
      code: 'low_confidence',
    });
    expect(thinContent && evaluateAgentMemorySuggestion(thinContent, [])).toMatchObject({
      shouldSuggest: false,
      code: 'thin_content',
    });
  });

  it('classifies reusable memory candidates and rejects session-only state', () => {
    const finding = buildAgentMemorySuggestion({
      scope: 'workspace',
      title: 'Alpha evidence finding',
      content: 'Finding: Alpha evidence indicates that reading notes should preserve reproducibility claims and source-backed context across future research runs.',
      source: { label: 'Research Agent suggestion' },
      reason: 'Reusable evidence-backed finding.',
      confidence: 0.8,
    });
    const transient = buildAgentMemorySuggestion({
      scope: 'conversation',
      title: 'Current todo',
      content: 'TODO: finish the current draft export next step after this session because the task is still in progress and waiting on a local check.',
      source: { label: 'Research Agent suggestion' },
      reason: 'Current task state.',
      confidence: 0.9,
    });
    const unknown = buildAgentMemorySuggestion({
      scope: 'conversation',
      title: 'Ambiguous note',
      content: 'This long enough candidate describes related material in broad terms with general background notes and no durable reusable takeaway for later work.',
      source: { label: 'Research Agent suggestion' },
      reason: 'General note.',
      confidence: 0.9,
    });

    expect(finding).toMatchObject({ candidateKind: 'finding' });
    expect(finding && evaluateAgentMemorySuggestion(finding, [])).toMatchObject({
      shouldSuggest: true,
      code: 'accepted',
    });
    expect(transient).toMatchObject({ candidateKind: 'transient_state' });
    expect(transient && evaluateAgentMemorySuggestion(transient, [])).toMatchObject({
      shouldSuggest: false,
      code: 'transient_state',
    });
    expect(unknown).toMatchObject({ candidateKind: 'unknown' });
    expect(unknown && evaluateAgentMemorySuggestion(unknown, [])).toMatchObject({
      shouldSuggest: false,
      code: 'unknown_kind',
    });
  });

  it('reviews memory policy before approval and exposes policy reasons', () => {
    const strong = buildAgentMemorySuggestion({
      scope: 'workspace',
      title: 'Alpha reusable evidence finding',
      content: 'Finding: Alpha evidence supports preserving source-backed reproducibility claims across future research runs. Evidence: alpha.md locator notes/alpha.md. This reusable conclusion should be remembered for later reading-note synthesis.',
      source: {
        label: 'Research Agent suggestion',
        locator: 'agent-session://alpha',
        fingerprint: 'mem-src-alpha-policy',
      },
      reason: 'Reusable evidence-backed finding.',
      candidateKind: 'finding',
      confidence: 0.72,
    });
    const weak = buildAgentMemorySuggestion({
      scope: 'workspace',
      title: 'Broad Alpha note',
      content: 'Finding: Alpha may be useful later. This is a broad answer dump without clear cited evidence or a specific reusable conclusion for future work.',
      source: {
        label: 'Research Agent suggestion',
      },
      reason: 'Maybe reusable.',
      candidateKind: 'finding',
      confidence: 0.56,
    });

    expect(strong && reviewAgentMemorySuggestionPolicy(strong)).toMatchObject({
      decision: 'approve',
      reasons: expect.arrayContaining(['provenance:ok', 'reuse:ok']),
    });
    expect(strong && evaluateAgentMemorySuggestion(strong, [])).toMatchObject({
      shouldSuggest: true,
      policy: expect.objectContaining({
        decision: 'approve',
      }),
    });
    expect(weak && reviewAgentMemorySuggestionPolicy(weak)).toMatchObject({
      decision: 'review',
      reasons: expect.arrayContaining(['weak-provenance']),
    });
    expect(weak && evaluateAgentMemorySuggestion(weak, [])).toMatchObject({
      shouldSuggest: false,
      code: 'low_confidence',
      policy: expect.objectContaining({
        decision: 'review',
      }),
    });
  });

  it('builds a compact review view model for pending memory approval', () => {
    const approved = buildAgentMemoryReviewViewModel({
      memory: {
        scope: 'workspace',
        title: 'Alpha reusable evidence finding',
        content: 'Finding: Alpha evidence supports durable source-backed reading notes across repeated research runs.',
        source: {
          label: 'Research Agent suggestion',
          locator: 'agent-session://alpha',
          fingerprint: 'mem-src-alpha',
        },
        candidateKind: 'finding',
      },
      reason: 'Reusable evidence-backed finding.',
      review: {
        candidateKind: 'finding',
        evidenceSummary: 'alpha.md / Context pack alpha',
        policySummary: 'approve / adjusted=72% / provenance:ok, reuse:ok',
        policyReasons: ['provenance:ok', 'reuse:ok'],
      },
    });
    const risky = buildAgentMemoryReviewViewModel({
      memory: {
        scope: 'conversation',
        title: 'Current todo',
        content: 'TODO: finish this temporary task state after the current draft is complete.',
        source: { label: 'Research Agent suggestion' },
        candidateKind: 'transient_state',
      },
      reason: 'Current task state.',
      review: {
        candidateKind: 'transient_state',
        policySummary: 'reject / adjusted=20% / transient-state',
        policyReasons: ['transient-state', 'reuse:unclear'],
        caution: 'Keep temporary state in the trace.',
      },
    });

    expect(approved).toMatchObject({
      recommendation: 'approve',
      confidencePercent: 72,
      candidateKind: 'finding',
      primaryReason: 'Reusable evidence-backed finding.',
      evidenceLine: 'alpha.md / Context pack alpha',
      provenanceLine: 'Research Agent suggestion / agent-session://alpha',
    });
    expect(risky).toMatchObject({
      recommendation: 'reject',
      confidencePercent: 20,
      candidateKind: 'transient_state',
      riskLine: expect.stringContaining('transient-state'),
      provenanceLine: 'Research Agent suggestion',
    });
  });

  it('ranks memories by task relevance before recency', () => {
    const recentIrrelevant = createAgentMemoryEntry({
      id: 'memory-recent',
      scope: 'workspace',
      title: 'Recent unrelated preference',
      content: 'Prefer concise export summaries for teaching slides.',
      source: { label: 'Manual memory' },
      workspaceKey: 'workspace-alpha',
      now: 300,
    });
    const relevant = createAgentMemoryEntry({
      id: 'memory-alpha',
      scope: 'workspace',
      title: 'Alpha evidence grounding',
      content: 'Alpha reading notes should preserve evidence grounding and reproducibility claims.',
      source: { label: 'Research Agent suggestion', locator: 'notes/alpha.md' },
      workspaceKey: 'workspace-alpha',
      now: 200,
    });
    const pinned = createAgentMemoryEntry({
      id: 'memory-pinned',
      scope: 'workspace',
      title: 'Pinned style rule',
      content: 'Always keep citations visible in research answers.',
      source: { label: 'Project rule' },
      workspaceKey: 'workspace-alpha',
      pinned: true,
      now: 100,
    });

    const ranked = rankAgentMemoryEntriesForContext({
      entries: [recentIrrelevant, relevant, pinned],
      queryText: 'Explain Alpha evidence grounding in reading notes',
      workspaceKey: 'workspace-alpha',
      limit: 2,
    });

    expect(ranked.map((item) => item.entry.id)).toEqual(['memory-alpha', 'memory-pinned']);
    expect(ranked[0]).toMatchObject({
      score: expect.any(Number),
      reasons: expect.arrayContaining(['workspace']),
    });
    expect(ranked[0]?.reasons.some((reason) => reason.startsWith('title:') || reason.startsWith('content:'))).toBe(true);
  });

  it('persists candidate kind and uses it as a ranking signal', () => {
    const finding = createAgentMemoryEntry({
      id: 'memory-finding',
      scope: 'workspace',
      title: 'Alpha result',
      content: 'Alpha evidence supports durable source-backed reading notes.',
      source: { label: 'Research Agent suggestion' },
      workspaceKey: 'workspace-alpha',
      candidateKind: 'finding',
      now: 100,
    });
    const preference = createAgentMemoryEntry({
      id: 'memory-preference',
      scope: 'workspace',
      title: 'Alpha result',
      content: 'Alpha evidence supports durable source-backed reading notes.',
      source: { label: 'Research Agent suggestion' },
      workspaceKey: 'workspace-alpha',
      candidateKind: 'preference',
      now: 200,
    });

    const ranked = rankAgentMemoryEntriesForContext({
      entries: [preference, finding],
      queryText: 'Research finding about Alpha evidence',
      workspaceKey: 'workspace-alpha',
    });

    expect(finding.candidateKind).toBe('finding');
    expect(ranked.map((item) => item.entry.id)).toEqual(['memory-finding', 'memory-preference']);
    expect(ranked[0]?.reasons).toContain('kind:finding');
  });

  it('evaluates memory lifecycle without mutating saved status', () => {
    const oldFinding = createAgentMemoryEntry({
      id: 'memory-old',
      scope: 'workspace',
      title: 'Old Alpha finding',
      content: 'Finding: Alpha evidence supports durable source-backed reading notes across repeated research runs.',
      source: {
        label: 'Research Agent suggestion',
        locator: 'notes/alpha.md',
      },
      candidateKind: 'finding',
      now: 100,
    });
    const weak = createAgentMemoryEntry({
      id: 'memory-weak',
      scope: 'workspace',
      title: 'Weak memory',
      content: 'Short memory content without enough reusable support.',
      source: {
        label: 'Manual memory',
      },
      now: 1_000,
    });
    const unknown = createAgentMemoryEntry({
      id: 'memory-unknown',
      scope: 'workspace',
      title: 'Unknown memory',
      content: 'This saved memory has enough content for display but its candidate kind should be reviewed before future reuse.',
      source: {
        label: 'Manual memory',
        locator: 'notes/review.md',
      },
      candidateKind: 'unknown',
      now: 1_000,
    });
    const stale = evaluateAgentMemoryLifecycle(oldFinding, 200 * 86_400_000);
    const weakEvaluation = evaluateAgentMemoryLifecycle(weak, 2_000);
    const review = evaluateAgentMemoryLifecycle(unknown, 2_000);

    expect(stale).toMatchObject({
      status: 'stale',
      recommendedAction: 'refresh',
      reasons: expect.arrayContaining(['age:199d']),
    });
    expect(weakEvaluation).toMatchObject({
      status: 'weak',
      recommendedAction: 'review',
      reasons: expect.arrayContaining(['weak-provenance', 'thin-content']),
    });
    expect(review).toMatchObject({
      status: 'review',
      recommendedAction: 'disable',
      reasons: expect.arrayContaining(['kind:unknown']),
    });
    expect(oldFinding.status).toBe('active');
  });

  it('adds lifecycle reasons to memory ranking and downranks stale memories', () => {
    const staleFinding = createAgentMemoryEntry({
      id: 'memory-stale',
      scope: 'workspace',
      title: 'Alpha evidence finding',
      content: 'Alpha evidence supports durable source-backed reading notes across repeated research runs.',
      source: {
        label: 'Research Agent suggestion',
        locator: 'notes/alpha-old.md',
      },
      workspaceKey: 'workspace-alpha',
      candidateKind: 'finding',
      now: 100,
    });
    const freshFinding = createAgentMemoryEntry({
      id: 'memory-fresh',
      scope: 'workspace',
      title: 'Alpha evidence finding',
      content: 'Alpha evidence supports durable source-backed reading notes across repeated research runs.',
      source: {
        label: 'Research Agent suggestion',
        locator: 'notes/alpha-new.md',
      },
      workspaceKey: 'workspace-alpha',
      candidateKind: 'finding',
      now: 190 * 86_400_000,
    });

    const ranked = rankAgentMemoryEntriesForContext({
      entries: [staleFinding, freshFinding],
      queryText: 'Research finding about Alpha evidence',
      workspaceKey: 'workspace-alpha',
      now: 200 * 86_400_000,
    });

    expect(ranked.map((item) => item.entry.id)).toEqual(['memory-fresh', 'memory-stale']);
    expect(ranked[1]?.reasons).toContain('lifecycle:stale');
    expect(ranked[1]?.reasons).toContain('age:199d');
  });
});
