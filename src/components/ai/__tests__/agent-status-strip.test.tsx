/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AgentStatusStrip } from '../agent-status-strip';
import { createAgentSession } from '@/lib/ai/agent-session';
import { setLocale } from '@/lib/i18n';
import { normalizePersistedConversations, useAiChatStore } from '@/stores/ai-chat-store';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { useAiProviderProfileStore } from '@/stores/ai-provider-profile-store';
import type { DirectoryResearchCheckpoint } from '@/lib/ai/directory-research';

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => ({ get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) }),
}));

function restoreDelivery(deliveryStatus?: 'partial' | 'ready_for_review') {
  const session = { ...createAgentSession({ id: 'original', profile: 'research', task: 'Annotate and write a note' }), status: 'completed' as const };
  useAgentSessionStore.setState({ sessions: [session], activeSessionId: session.id });
  const persisted = JSON.parse(JSON.stringify({ conversations: [{ id: 'conversation', title: 'Original request', createdAt: 1, messages: [
    { id: 'answer', role: 'assistant', content: 'Review the generated note.', timestamp: 1, agentResult: { sessionId: session.id, deliveryStatus } },
  ] }] }));
  useAiChatStore.setState({ conversations: normalizePersistedConversations(persisted), activeConversationId: 'conversation' });
}

describe('AgentStatusStrip delivery state', () => {
  beforeEach(() => {
    setLocale('zh-CN');
    useAiProviderProfileStore.setState({ profiles: [], activeProfileId: null });
    useAiChatStore.setState({ conversations: [], activeConversationId: null, isGenerating: false, activeAssistantMessageId: null, composerMode: 'agent' });
    useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
  });

  it.each([
    ['partial', '部分结果待补全'],
    ['ready_for_review', '待审阅'],
    [undefined, '已完成'],
  ] as const)('shows persisted %s completion without claiming saved files', (status, label) => {
    restoreDelivery(status);
    render(<AgentStatusStrip />);
    expect(screen.getByTestId('agent-status-state').textContent).toBe(label);
  });

  it('prioritizes a current run and does not attach an old delivery status to a new reply', () => {
    restoreDelivery('partial');
    render(<AgentStatusStrip />);
    act(() => useAiChatStore.setState({ isGenerating: true, activeAssistantMessageId: 'answer' }));
    expect(screen.getByTestId('agent-status-state').textContent).toBe('运行中');
    act(() => {
      useAiChatStore.setState({ isGenerating: false, activeAssistantMessageId: null });
      useAiChatStore.getState().addUserMessage('New question');
      const id = useAiChatStore.getState().startAssistantMessage({ requestMode: 'chat' });
      useAiChatStore.getState().finishAssistantMessage(id, 'New reply');
    });
    expect(screen.getByTestId('agent-status-state').getAttribute('title')).toBe('idle');
    expect(screen.getByTestId('agent-status-state').textContent).not.toContain('部分结果');
  });

  it('updates the status strip when delivery changes on the same completed session', () => {
    restoreDelivery('partial');
    render(<AgentStatusStrip />);
    act(() => useAiChatStore.getState().setAssistantMetadata('answer', { agentResult: { sessionId: 'original', deliveryStatus: 'ready_for_review' } }));
    expect(screen.getByTestId('agent-status-state').textContent).toBe('待审阅');
  });

  function directoryState(completeDiscovery = true): DirectoryResearchCheckpoint {
    return { version: 2, workspaceKey: 'A', task: 'All papers', query: 'Read', selections: [{ kind: 'folder', path: '.' }], files: [
      { path: 'read.pdf', status: 'complete', size: 1, lastModified: 1 },
      { path: 'unopened.pdf', status: 'pending', size: 1, lastModified: 1 },
      { path: 'broken.pdf', status: 'failed', size: 1, lastModified: 1 },
    ], reductions: [], removedPaths: [], calls: 1, phase: 'ready', manifest: { version: 1, workspaceKey: 'A', selections: [{ kind: 'folder', path: '.' }], roots: [{ kind: 'folder', path: '' }],
      directories: [], files: [], pendingDirectories: [], complete: completeDiscovery, revision: 1, changedPaths: [], removedPaths: [] } };
  }

  it.each(['zh-CN', 'en-US'] as const)('uses directory file coverage rather than opened page coverage (%s)', locale => {
    setLocale(locale); restoreDelivery();
    const current = useAgentSessionStore.getState().sessions[0];
    current.documentResearch = { status: 'ready', directory: directoryState(), checkpoint: { version: 1, queryKey: 'x', summaries: [], findings: [], completedBatches: 1, sources: [],
      coverage: [{ path: 'read.pdf', kind: 'pdf', unitLabel: 'page', totalUnits: 2, readUnits: [1, 2], pendingUnits: [], emptyUnits: [], unreadableUnits: [] }] } };
    render(<AgentStatusStrip />);
    expect(screen.getByTestId('agent-status-context').textContent).toContain(locale === 'zh-CN' ? '目录 1/3 文件' : 'Directory 1/3 files');
    expect(screen.getByTestId('agent-status-state').textContent).toContain(locale === 'zh-CN' ? '部分结果待补全' : 'Partial result');
    expect(screen.getByTestId('agent-status-context').getAttribute('title')).toMatch(locale === 'zh-CN' ? /失败 1/ : /failed 1/);
  });

  it('does not present a discovered-so-far denominator as complete and identifies directory phases', () => {
    restoreDelivery();
    const current = useAgentSessionStore.getState().sessions[0];
    current.status = 'running';
    const directory = directoryState(false); directory.files = directory.files.slice(0, 1); directory.phase = 'discovering';
    current.documentResearch = { status: 'reading', directory, checkpoint: { version: 1, queryKey: 'x', summaries: [], findings: [], completedBatches: 0, sources: [], coverage: [] } };
    useAiChatStore.setState({ isGenerating: true, activeAssistantMessageId: 'answer' });
    const view = render(<AgentStatusStrip />);
    expect(screen.getByTestId('agent-status-state').textContent).toBe('正在发现目录文件');
    expect(screen.getByTestId('agent-status-context').textContent).toBe('已读 1 文件 · 仍在发现');
    directory.phase = 'reducing'; directory.manifest!.complete = true;
    view.rerender(<AgentStatusStrip />);
    expect(screen.getByTestId('agent-status-state').textContent).toBe('正在汇总目录笔记');
  });
});
