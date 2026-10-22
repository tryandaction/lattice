import { describe, expect, it } from 'vitest';
import { conversationDocumentPaths, availableDocumentNotice, latestConversationDocumentContext } from '../conversation-documents';
import { checkpointObjective, reusableDocumentReading } from '../document-followup';
import type { AgentSession } from '../agent-session';

const session = (): AgentSession => ({ id: 'read-1', profile: 'research', title: 'Read', task: 'Explain', status: 'completed', createdAt: 1, updatedAt: 1, trace: [], evidenceRefs: [], approvalRequestIds: [], pendingApprovals: [], compactions: [], documentResearch: {
  status: 'ready', workflowId: 'paper-reading', workspaceKey: 'workspace-A', checkpoint: { version: 1, queryKey: '["Explain","Explain"]', summaries: ['Verified summary'], findings: [], completedBatches: 1,
    sources: [{ path: 'paper.pdf', version: 'sha-A', totalUnits: 1, completedUnits: [1], offsets: {} }],
    coverage: [{ path: 'paper.pdf', kind: 'pdf', unitLabel: 'page', totalUnits: 1, readUnits: [1], pendingUnits: [], emptyUnits: [], unreadableUnits: [] }],
  },
} });

describe('conversation document continuity', () => {
  it('ends the old paper subject when the user explicitly asks for an independent explanation', () => {
    expect(latestConversationDocumentContext([
      { role: 'assistant', documentContext: { workspaceKey: 'A', paths: ['paper.pdf'] } },
      { role: 'user', content: '不结合这篇论文，为什么会出现这种相变？' },
      { role: 'assistant', content: 'General explanation', documentContext: { workspaceKey: 'A', paths: ['paper.pdf'] } },
    ], 'A')).toBeUndefined();
  });
  it('retains every authorized nested path and keeps same-name files distinct', () => {
    const paths = Array.from({ length: 12 }, (_, i) => `notes/topic-${i}/results.md`);
    expect(conversationDocumentPaths([{ documentContext: { workspaceKey: 'A', paths } }], 'A')).toEqual(paths);
    expect(availableDocumentNotice(paths)).toContain('notes/topic-11/results.md');
  });
  it('retains supplied material after closing its tab but never carries it to another workspace', () => {
    const messages = [{ documentContext: { workspaceKey: 'A', paths: ['paper.pdf', 'notes.md'] } }];
    expect(conversationDocumentPaths(messages, 'A')).toEqual(['paper.pdf', 'notes.md']);
    expect(conversationDocumentPaths(messages, 'B')).toEqual([]);
    expect(conversationDocumentPaths(messages, 'A', 'other.pdf')).toEqual(['paper.pdf', 'notes.md', 'other.pdf']);
    expect(availableDocumentNotice(['papers/paper.pdf'])).toContain('paper.pdf');
    expect(availableDocumentNotice(['papers/paper.pdf'])).toContain('not quotation evidence');
  });
  it('keeps earlier conversation files even when a later turn used another document', () => {
    expect(conversationDocumentPaths([
      { documentContext: { workspaceKey: 'A', paths: ['first.md'] } },
      { documentContext: { workspaceKey: 'B', paths: ['foreign.md'] } },
      { documentContext: { workspaceKey: 'A', paths: ['second.md'] } },
    ], 'A', 'third.md')).toEqual(['second.md', 'first.md', 'third.md']);
  });
  it('recovers legacy structured source identities without treating old text or page counts as evidence', () => {
    const messages = [{ content: 'Historical unsupported value 999; AGENTS.md is not the paper.', evidenceRefs: [
      { kind: 'pdf_page' as const, label: 'Senoo 2026', locator: 'papers/Senoo%202026.pdf#page=61', preview: 'OLD UNVERIFIED QUOTE' },
      { kind: 'file' as const, label: 'rules', locator: 'AGENTS.md' },
      { kind: 'file' as const, label: 'external', locator: 'https://example.com/other.pdf' },
    ] }];
    expect(conversationDocumentPaths(messages, 'A', undefined, 'A')).toEqual(['papers/Senoo 2026.pdf']);
    expect(conversationDocumentPaths(messages, 'B', undefined, 'A')).toEqual([]);
    expect(conversationDocumentPaths(messages, 'A')).toEqual([]);
  });
  it('preserves the requested paper subject when a follow-up mistakenly recorded rules and an unrelated draft', () => {
    const messages = [
      { role: 'user', content: '阅读 Senoo.pdf' }, { role: 'assistant', documentContext: { workspaceKey: 'A', paths: ['papers/Senoo.pdf'] } },
      { role: 'user', content: '本文单比特门详细讲解' }, { role: 'assistant', documentContext: { workspaceKey: 'A', paths: ['AGENTS.md', 'notes/CZ-draft.md'] } },
    ];
    expect(latestConversationDocumentContext(messages, 'A')?.paths).toEqual(['papers/Senoo.pdf']);
    expect(latestConversationDocumentContext([...messages, { role: 'user', content: '阅读当前文件' }, { role: 'assistant', documentContext: { workspaceKey: 'A', paths: ['AGENTS.md'] } }], 'A')?.paths).toEqual(['AGENTS.md']);
    expect(latestConversationDocumentContext([...messages, { role: 'user', content: '解释 Python 装饰器' }, { role: 'assistant', content: 'Decorator explanation' }], 'A')).toBeUndefined();
  });
  it.each(['本文中的“单比特门”详细讲解', '本文当前方法的局限是什么？', 'Explain the current limitations of this paper'])('keeps paper identity despite terms and a wrong auxiliary tool context: %s', content => {
    const messages = [{ role: 'user', content: 'Read Senoo.pdf' }, { role: 'assistant', documentContext: { workspaceKey: 'A', paths: ['Senoo.pdf'] } },
      { role: 'user', content }, { role: 'assistant', documentContext: { workspaceKey: 'A', paths: ['AGENTS.md', 'notes/单比特门.md'] } }];
    expect(latestConversationDocumentContext(messages, 'A')?.paths).toEqual(['Senoo.pdf']);
  });
  it('reuses a completed read for a follow-up without mutating the original checkpoint', () => {
    const previous = session();
    const reused = reusableDocumentReading('继续详细解释', [previous], [{ path: 'paper.pdf', version: 'sha-A' }], 'workspace-A');
    expect(reused?.objective).toEqual({ task: 'Explain', query: 'Explain' });
    reused!.state.checkpoint.summaries.push('Independent copy');
    expect(previous.documentResearch?.checkpoint.summaries).toEqual(['Verified summary']);
  });
  it('re-reads changed documents, new tasks, incomplete coverage and other workspaces', () => {
    const previous = session(), sources = [{ path: 'paper.pdf', version: 'sha-A' }];
    expect(reusableDocumentReading('继续', [previous], [{ ...sources[0], version: 'sha-B' }], 'workspace-A')).toBeNull();
    expect(reusableDocumentReading('继续', [previous], sources, 'workspace-B')).toBeNull();
    expect(reusableDocumentReading('分析另一项实验', [previous], sources, 'workspace-A')).toBeNull();
    previous.documentResearch!.checkpoint.coverage[0].pendingUnits = [1];
    expect(reusableDocumentReading('继续', [previous], sources, 'workspace-A')).toBeNull();
    previous.documentResearch!.checkpoint.queryKey = 'invalid';
    expect(checkpointObjective(previous.documentResearch!.checkpoint)).toBeUndefined();
  });
  it.each(['详细讲解，不是一句话', '请详细解释，不要只给结论', '请你详细讲解，不要只给结论', '说得太简略了，展开讲', 'Please explain in more detail, not just one sentence', 'Could you please explain in more detail?', '继续'])('reuses verified context for a natural depth follow-up: %s', question => {
    expect(reusableDocumentReading(question, [session()], [{ path: 'paper.pdf', version: 'sha-A' }], 'workspace-A')?.objective).toEqual({ task: 'Explain', query: 'Explain' });
  });
  it.each(['继续解释 Python 装饰器', '换个话题，详细讲解量子计算', '详细讲解第3页', '继续讲解这段选区', '继续分析另一篇论文', 'Now explain a different paper'])('does not reuse the prior reading objective for a new subject or focused excerpt: %s', question => {
    expect(reusableDocumentReading(question, [session()], [{ path: 'paper.pdf', version: 'sha-A' }], 'workspace-A')).toBeNull();
  });
  it.each(['failed', 'cancelled'] as const)('reuses verified reading after final synthesis ends as %s', status => {
    const previous = session();
    previous.status = status;
    expect(reusableDocumentReading('继续', [previous], [{ path: 'paper.pdf', version: 'sha-A' }], 'workspace-A')?.objective).toEqual({ task: 'Explain', query: 'Explain' });
  });
  it('never treats a reading with rejected evidence as a reusable complete cache', () => {
    const previous = session();
    previous.documentResearch!.checkpoint.evidenceIssues = [{ batch: 1, finding: 1, code: 'unknown_passage' }];
    expect(reusableDocumentReading('详细讲解，不是一句话', [previous], [{ path: 'paper.pdf', version: 'sha-A' }], 'workspace-A')).toBeNull();
  });
});
