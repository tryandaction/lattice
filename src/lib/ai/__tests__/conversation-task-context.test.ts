import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/stores/ai-chat-store';
import { createAgentSession, type AgentSession } from '../agent-session';
import { documentContinuationForReply, recentDocumentTaskSessions, resolveResearchContinuation } from '../conversation-task-context';
import type { DirectoryResearchCheckpoint } from '../directory-research';
import { reusableDocumentReading } from '../document-followup';

function readingSession(id: string): AgentSession {
  return { ...createAgentSession({ profile: 'research', task: 'Read the paper' }), id, status: 'completed', documentResearch: {
    status: 'ready', workflowId: 'paper-reading', workspaceKey: 'workspace-A', checkpoint: {
      version: 1, queryKey: '["Read the paper","Explain all mechanisms"]', completedBatches: 1, summaries: ['Verified full reading'], findings: [],
      sources: [{ path: 'paper.pdf', version: 'sha-A', totalUnits: 1, completedUnits: [1], offsets: {} }],
      coverage: [{ path: 'paper.pdf', kind: 'pdf', unitLabel: 'page', totalUnits: 1, readUnits: [1], pendingUnits: [], emptyUnits: [], unreadableUnits: [] }],
    },
  } };
}
const user = (content: string): ChatMessage => ({ id: content, role: 'user', content, timestamp: 1 });
const assistant = (sessionId?: string): ChatMessage => ({ id: sessionId ?? 'ordinary-answer', role: 'assistant', content: 'Answer', timestamp: 2, ...(sessionId ? { agentResult: { sessionId } } : {}) });

describe('recent document task context', () => {
  const saved = readingSession('paper-read');
  const lookup = (id: string): AgentSession | null => id === saved.id ? saved : null;

  it('keeps the original objective through repeated accepted next steps', () => {
    const history = [user('BB1是什么？'), { ...assistant(), content: '下一步可以检索原文定义。' }, user('做'),
      { ...assistant(), content: '已定位定义；下一步可以解释复合脉冲的相位。' }];
    const result = resolveResearchContinuation('继续', history);
    expect(result?.task).toBe('BB1是什么？');
    expect(result?.nextAction).toContain('解释复合脉冲的相位');
    expect(result?.sourceIntentQuery).toBe('BB1是什么？\n继续');
    expect(resolveResearchContinuation('继续', [...history, user('解释Python装饰器'), { ...assistant(), content: '下一步可以解释参数。' }])?.task).toBe('解释Python装饰器');
  });

  it('keeps verified full reading available for a natural depth follow-up', () => {
    const candidates = recentDocumentTaskSessions([user('通读论文并解释原理'), assistant(saved.id)], lookup);
    expect(reusableDocumentReading('详细讲解，不是一句话', candidates, [{ path: 'paper.pdf', version: 'sha-A' }], 'workspace-A')?.objective)
      .toEqual({ task: 'Read the paper', query: 'Explain all mechanisms' });
  });

  it('does not cross a newer non-document topic even while the paper identity is remembered', () => {
    const messages = [user('Read paper'), assistant(saved.id), user('解释 Python 装饰器'), { ...assistant(), documentContext: { workspaceKey: 'workspace-A', paths: ['paper.pdf'] } }];
    expect(recentDocumentTaskSessions(messages, lookup)).toEqual([]);
  });

  it('does not fall back to an older paper when the newest task has no recoverable session', () => {
    expect(recentDocumentTaskSessions([user('Read paper'), assistant(saved.id), user('Read another paper'), assistant('missing-session')], lookup)).toEqual([]);
  });

  it('skips greeting and acknowledgement turns without discarding the preceding substantive task', () => {
    expect(recentDocumentTaskSessions([user('Read paper'), assistant(saved.id), user('谢谢'), assistant(), user('hi'), assistant()], lookup)).toEqual([saved]);
  });

  it('uses only the latest document reply within the latest substantive turn', () => {
    const latest = { ...readingSession('new-read'), status: 'failed' as const };
    const sessions = recentDocumentTaskSessions([user('Read paper'), assistant(saved.id), user('Read again'), assistant(saved.id), assistant(latest.id)], id => id === latest.id ? latest : lookup(id));
    expect(sessions).toEqual([latest]);
    expect(reusableDocumentReading('继续', sessions, [{ path: 'paper.pdf', version: 'sha-A' }], 'workspace-A')).not.toBeNull();
  });

  it('does not invent a task from assistant-only history or an unanswered user message', () => {
    expect(recentDocumentTaskSessions([assistant(saved.id)], lookup)).toEqual([]);
    expect(recentDocumentTaskSessions([user('Read paper'), assistant(saved.id), user('New task')], lookup)).toEqual([]);
    expect(recentDocumentTaskSessions([], lookup)).toEqual([]);
  });
});

describe('unfinished directory reply continuation', () => {
  const directorySession = (phase: DirectoryResearchCheckpoint['phase']): AgentSession => {
    const session = readingSession('directory-read');
    session.status = 'cancelled';
    session.documentResearch!.status = 'paused';
    session.documentResearch!.directory = {
      version: 2, workspaceKey: 'workspace-A', selections: [{ kind: 'folder', path: 'papers/original-scope' }],
      task: 'Read all papers', query: 'Compare all methods', files: [], reductions: [], removedPaths: [], calls: 48, phase,
      manifest: { version: 1, workspaceKey: 'workspace-A', selections: [{ kind: 'folder', path: 'papers/original-scope' }],
        roots: [{ kind: 'folder', path: 'papers/original-scope' }], files: [], directories: [], pendingDirectories: [],
        complete: true, revision: 1, changedPaths: [], removedPaths: [] },
    };
    return session;
  };
  const continuation = (query: string, session: AgentSession, messages: ChatMessage[] = [user('Read all papers'), assistant(session.id)]) =>
    documentContinuationForReply(query, messages, id => id === session.id ? session : null);

  it.each(['做', '继续', 'go on'])('resumes discovery with no opened-file page coverage after %s', query => {
    const session = directorySession('discovering');
    session.documentResearch!.checkpoint.coverage = [];
    session.documentResearch!.directory!.manifest!.complete = false;
    expect(continuation(query, session)).toEqual({ sourceSessionId: session.id, documentResume: true });
  });

  it.each(['reading', 'reducing', 'paused'] as const)('resumes unfinished directory %s when the v1 projection has no pending pages', phase => {
    const session = directorySession(phase);
    expect(session.documentResearch!.checkpoint.coverage.every(file => file.pendingUnits.length === 0)).toBe(true);
    expect(continuation('继续', session)).toEqual({ sourceSessionId: session.id, documentResume: true });
  });

  it.each(['pending', 'reading', 'failed'] as const)('resumes the original directory ledger with %s files', status => {
    const session = directorySession('ready');
    session.documentResearch!.status = 'ready';
    session.documentResearch!.directory!.files = [{ path: 'papers/original-scope/unopened.pdf', size: 100, lastModified: 1, status }];
    const before = structuredClone(session);
    expect(continuation('做', session)).toEqual({ sourceSessionId: session.id, documentResume: true });
    expect(session).toEqual(before);
  });

  it('resumes an interrupted directory discovery before a manifest has been committed', () => {
    const session = directorySession('discovering');
    delete session.documentResearch!.directory!.manifest;
    expect(continuation('继续', session)?.sourceSessionId).toBe(session.id);
  });

  it('recovers the last directory checkpoint after interruption without replacing its saved scope', () => {
    const session = directorySession('reducing');
    session.documentResearch!.status = 'reading';
    session.status = 'failed';
    const reply = { ...assistant(session.id), documentContext: { workspaceKey: 'workspace-A', paths: ['notes/new-active-file.md'] } };
    expect(continuation('继续', session, [user('Read all papers'), reply])).toEqual({ sourceSessionId: session.id, documentResume: true });
    expect(session.documentResearch!.directory!.selections).toEqual([{ kind: 'folder', path: 'papers/original-scope' }]);
  });

  it('keeps complete reading out of resume but treats an explicit continuation as a retry of empty-text files', () => {
    const session = directorySession('ready');
    session.documentResearch!.directory!.files = [{ path: 'papers/a.pdf', size: 100, lastModified: 1, status: 'complete' }];
    expect(continuation('继续', session)).toBeUndefined();
    session.documentResearch!.directory!.files[0].status = 'no_text';
    expect(continuation('继续', session)).toEqual({ sourceSessionId: session.id, documentResume: true });
    expect(continuation('hi', session)).toBeUndefined();
    expect(continuation('分析另一篇论文', directorySession('paused'))).toBeUndefined();
  });

  it('does not jump to an older unfinished task or an actively streaming reply', () => {
    const session = directorySession('paused');
    expect(continuation('继续', session, [user('Read all'), assistant(session.id), user('New task')])).toBeUndefined();
    expect(continuation('继续', session, [user('Read all'), assistant(session.id), user('New task'), assistant('missing')])).toBeUndefined();
    expect(continuation('继续', session, [{ ...assistant(session.id), isStreaming: true }])).toBeUndefined();
  });

  it.each(['queued', 'running', 'waiting_approval'] as const)('does not convert %s work into a new reading run', status => {
    const session = directorySession('paused'); session.status = status;
    expect(continuation('继续', session)).toBeUndefined();
  });

  it('does not turn a natural acknowledgement into tool approval', () => {
    const session = directorySession('paused');
    session.pendingApprovals = [{ id: 'write-approval', status: 'pending' } as AgentSession['pendingApprovals'][number]];
    expect(continuation('做', session)).toBeUndefined();
    session.pendingApprovals[0].status = 'executing';
    expect(continuation('继续', session)).toBeUndefined();
  });

  it.each(['paused', 'failed'] as const)('preserves legacy v1 %s page continuation', status => {
    const session = readingSession('legacy-read'); session.status = 'failed'; session.documentResearch!.status = status;
    session.documentResearch!.checkpoint.coverage[0].pendingUnits = [2];
    expect(continuation('继续', session)).toEqual({ sourceSessionId: session.id, documentResume: true });
    session.documentResearch!.checkpoint.coverage[0].pendingUnits = [];
    session.documentResearch!.checkpoint.coverage[0].unreadableUnits = [{ unit: 2, reason: 'temporary read failure' }];
    expect(continuation('继续', session)?.documentResume).toBe(true);
  });
});
