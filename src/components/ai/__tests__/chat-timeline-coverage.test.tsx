/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ChatTimeline } from '../chat-timeline';
import { useAiChatStore, type ChatMessage } from '@/stores/ai-chat-store';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { createAgentSession, type AgentSession } from '@/lib/ai/agent-session';
import { setLocale } from '@/lib/i18n';
import type { Locale } from '@/types/settings';

vi.mock('@/components/renderers/markdown-renderer', () => ({ MarkdownRenderer: ({ content }: { content: string }) => <p>{content}</p> }));
vi.mock('../pdf-companion-review', () => ({ PdfCompanionReview: () => null }));
vi.mock('../diff-preview', () => ({ DiffPreview: () => null }));
vi.mock('../assistant-message-editor', () => ({ AssistantMessageEditor: () => null }));
vi.mock('../copy-answer-button', () => ({ CopyAnswerButton: () => null }));
vi.mock('../workbench-queue', () => ({ SelectionOriginBadge: () => null }));

function readingSession(complete: boolean): AgentSession {
  return { ...createAgentSession({ id: 'coverage-ui-session', profile: 'research', task: '讲解本文' }), status: 'completed', documentResearch: {
    status: 'ready', workspaceKey: 'synthetic-workspace', workflowId: 'paper-reading', checkpoint: {
      version: 1, queryKey: 'synthetic-task', completedBatches: 7, summaries: ['Synthetic summary'], findings: [],
      sources: [{ path: 'paper.pdf', version: 'synthetic-v1', totalUnits: 15, completedUnits: complete ? Array.from({ length: 15 }, (_, index) => index + 1) : [1], offsets: {} }],
      coverage: [{ path: 'paper.pdf', kind: 'pdf', unitLabel: 'page', totalUnits: 15,
        readUnits: complete ? Array.from({ length: 15 }, (_, index) => index + 1) : [1],
        pendingUnits: complete ? [] : Array.from({ length: 14 }, (_, index) => index + 2), emptyUnits: [], unreadableUnits: [] }],
    },
  } };
}
function mount(session: AgentSession) {
  const message: ChatMessage = { id: 'answer', role: 'assistant', timestamp: 2, content: 'Synthetic answer',
    agentResult: { sessionId: session.id }, promptContext: { prompt: 'Selected excerpts', nodes: [], evidenceRefs: [], truncated: true } };
  useAgentSessionStore.setState({ sessions: [session], activeSessionId: session.id });
  useAiChatStore.setState({ conversations: [{ id: 'coverage-chat', title: 'Synthetic', createdAt: 1, messages: [message] }], activeConversationId: 'coverage-chat', isGenerating: false });
  render(<ChatTimeline onOpenEvidence={vi.fn()} selectedEvidenceMessageId={null} isEvidencePanelOpen={false} />);
  return message;
}
beforeEach(() => { setLocale('zh-CN'); });

it('renders a readable cloud source label with the natural question while preserving ordinary local messages and stored text', () => {
  const original = '@cloud:internal-library-uuid:internal-file-uuid Explain this experiment';
  const local = 'Keep @local.md and line formatting\n  Indented line';
  useAiChatStore.setState({ conversations: [{ id: 'cloud-user-ui', title: 'Cloud', createdAt: 1, messages: [
    { id: 'cloud-user', role: 'user', timestamp: 1, content: original },
    { id: 'local-user', role: 'user', timestamp: 2, content: local },
  ] }], activeConversationId: 'cloud-user-ui', isGenerating: false });
  const { container } = render(<ChatTimeline onOpenEvidence={vi.fn()} selectedEvidenceMessageId={null} isEvidencePanelOpen={false} />);
  const bubbles = container.querySelectorAll('[data-message-role="user"]');
  expect(bubbles[0].textContent).toContain('云文件');
  expect(bubbles[0].textContent).toContain('Explain this experiment');
  expect(bubbles[0].textContent).not.toContain('@cloud:');
  expect(bubbles[0].textContent).not.toContain('internal-file-uuid');
  expect(bubbles[1].textContent).toContain(local);
  expect(useAiChatStore.getState().getActiveConversation()?.messages[0].content).toBe(original);
  act(() => setLocale('en-US'));
  expect(bubbles[0].textContent).toContain('Cloud file');
});

it('keeps a source-only cloud folder message readable without exposing IDs or altering the stored prompt', () => {
  const original = '@cloud-folder:internal-library-uuid:internal-folder-uuid';
  useAiChatStore.setState({ conversations: [{ id: 'cloud-folder-ui', title: 'Cloud folder', createdAt: 1, messages: [
    { id: 'folder-user', role: 'user', timestamp: 1, content: original },
  ] }], activeConversationId: 'cloud-folder-ui', isGenerating: false });
  const { container } = render(<ChatTimeline onOpenEvidence={vi.fn()} selectedEvidenceMessageId={null} isEvidencePanelOpen={false} />);
  const bubble = container.querySelector('[data-message-role="user"]')!;
  expect(bubble.textContent).toContain('云文件夹');
  expect(bubble.textContent).not.toContain('internal-folder-uuid');
  expect(bubble.textContent).not.toContain('@cloud-folder:');
  expect(useAiChatStore.getState().getActiveConversation()?.messages[0].content).toBe(original);
});

it.each<Locale>(['zh-CN', 'en-US'])('distinguishes completed source reading from excerpt-limited answer context (%s)', locale => {
  setLocale(locale);
  const message = mount(readingSession(true));
  const notice = screen.getByTestId('ai-chat-context-truncated');
  expect(notice.textContent).toContain(locale === 'zh-CN' ? '回答使用已读材料中的相关摘录／摘要' : 'The answer uses relevant excerpts or summaries from the material read');
  expect(notice.textContent).not.toContain(locale === 'zh-CN' ? '本次仅使用了部分材料' : 'Only part of the material was used');
  expect(notice.textContent).toContain(locale === 'zh-CN' ? '不代表所有结论均已核实' : 'does not mean every conclusion has been verified');
  expect(message.promptContext?.truncated).toBe(true);
});

it('keeps the partial-material warning for pending or unreadable pages and updates on actual checkpoint completion', () => {
  const session = readingSession(false);
  mount(session);
  expect(screen.getByTestId('ai-chat-context-truncated').textContent).toContain('本次仅使用了部分材料');
  const completed = readingSession(true);
  completed.documentResearch!.checkpoint.coverage[0].unreadableUnits = [{ unit: 8, reason: 'synthetic-read-error' }];
  act(() => { useAgentSessionStore.setState({ sessions: [completed] }); });
  expect(screen.getByTestId('ai-chat-context-truncated').textContent).toContain('本次仅使用了部分材料');
  act(() => { useAgentSessionStore.setState({ sessions: [readingSession(true)] }); });
  expect(screen.getByTestId('ai-chat-context-truncated').textContent).toContain('回答使用已读材料中的相关摘录／摘要');
});

it('retains evidence-gap warnings after all pages were read', () => {
  const session = readingSession(true);
  session.documentResearch!.checkpoint.evidenceIssues = [{ batch: 1, finding: 0, code: 'unverified_quote', sourcePath: 'paper.pdf', unit: 1 }];
  mount(session);
  expect(screen.getByTestId('ai-chat-context-truncated').textContent).toContain('回答使用已读材料中的相关摘录／摘要');
  expect(screen.getByTestId('document-reading-progress').textContent).toContain('证据存在缺口');
  expect(screen.getByTestId('document-reading-progress').textContent).toContain('1 条发现未通过原文校验');
});

it.each(['missing-session', 'duplicate-pages', 'out-of-range-pages', 'zero-total'])(
  'does not infer full reading from an unverifiable ledger (%s)', reason => {
  const session = readingSession(true);
  const coverage = session.documentResearch!.checkpoint.coverage[0];
  if (reason === 'duplicate-pages') coverage.readUnits = Array(15).fill(1);
  if (reason === 'out-of-range-pages') coverage.readUnits = Array.from({ length: 15 }, (_, index) => index + 2);
  if (reason === 'zero-total') { coverage.totalUnits = 0; coverage.readUnits = []; }
  mount(session);
  if (reason === 'missing-session') act(() => { useAgentSessionStore.setState({ sessions: [] }); });
  expect(screen.getByTestId('ai-chat-context-truncated').textContent).toContain('本次仅使用了部分材料');
});

it.each([false, true])('requires complete directory discovery before showing excerpt-based context (discovered: %s)', discovered => {
  const session = readingSession(true);
  session.documentResearch!.directory = { version: 2, workspaceKey: 'synthetic-workspace', selections: [{ kind: 'folder', path: 'papers' }],
    task: '讲解所有文档', query: '讲解所有文档', calls: 7, phase: discovered ? 'ready' : 'discovering', removedPaths: [], reductions: [],
    files: [{ path: 'paper.pdf', size: 100, lastModified: 1, status: 'complete', checkpoint: session.documentResearch!.checkpoint }],
    manifest: { version: 1, workspaceKey: 'synthetic-workspace', selections: [], roots: [], files: [], directories: [],
      pendingDirectories: discovered ? [] : ['papers/subfolder'], complete: discovered, revision: 1, changedPaths: [], removedPaths: [] } };
  mount(session);
  expect(screen.getByTestId('ai-chat-context-truncated').textContent).toContain(discovered ? '回答使用已读材料中的相关摘录／摘要' : '本次仅使用了部分材料');
});
