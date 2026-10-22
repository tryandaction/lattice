import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestProgress } from '../request-progress';
import { useAiChatStore } from '@/stores/ai-chat-store';
import { setLocale } from '@/lib/i18n';

afterEach(() => { cleanup(); vi.useRealTimers(); useAiChatStore.setState({ isGenerating: false, requestProgress: null, activeAssistantMessageId: null, conversations: [], activeConversationId: null }); });
describe('request progress', () => {
  it('shows elapsed work for the current conversation and hides another conversation request', () => {
    vi.useFakeTimers(); setLocale('zh-CN');
    useAiChatStore.setState({ conversations: [{ id: 'A', title: 'A', createdAt: 1, messages: [{ id: 'reply', role: 'assistant', content: '', timestamp: 1, isStreaming: true }] }], activeConversationId: 'A', activeAssistantMessageId: 'reply', isGenerating: true, requestProgress: { phase: 'waiting', startedAt: Date.now() - 45000, lastActivityAt: Date.now(), attempt: 2 } });
    render(<RequestProgress />);
    expect(screen.getByRole('status').textContent).toContain('正在等待模型输出');
    expect(screen.getByRole('status').textContent).toContain('0:45');
    act(() => useAiChatStore.setState({ activeConversationId: 'B' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
