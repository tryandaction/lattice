import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => ({ get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) }) }));
import { useAiChatStore } from '../ai-chat-store';

beforeEach(() => { useAiChatStore.setState({ conversations: [], activeConversationId: null, activeAssistantMessageId: null, isGenerating: false, abortController: null }); });
it('corrects an interim item snapshot without ending the running task', () => {
  const chat = useAiChatStore.getState();
  chat.newConversation();
  const id = chat.startAssistantMessage();
  chat.setGenerating(true, new AbortController());
  chat.appendToAssistantMessage(id, '晚到的工作进度');
  chat.replaceAssistantDraft(id, '');
  expect(chat.getActiveConversation()?.messages.at(-1)).toMatchObject({ content: '', isStreaming: true, historyStatus: 'unverified' });
  expect(useAiChatStore.getState().isGenerating).toBe(true);
  chat.appendToAssistantMessage(id, '真正的最终结论');
  chat.replaceAssistantDraft(id, '完整最终结论');
  chat.finishAssistantMessage(id);
  expect(chat.getActiveConversation()?.messages.at(-1)).toMatchObject({ content: '完整最终结论', isStreaming: false });
});
it('never changes a stopped or completed message with a late native snapshot', () => {
  const chat = useAiChatStore.getState();
  chat.newConversation();
  const id = chat.startAssistantMessage();
  chat.setGenerating(true, new AbortController());
  chat.appendToAssistantMessage(id, '保留的草稿');
  chat.stopGenerating();
  chat.replaceAssistantDraft(id, '迟到内容');
  expect(chat.getActiveConversation()?.messages.at(-1)?.content).toBe('保留的草稿');
  const next = chat.startAssistantMessage();
  chat.finishAssistantMessage(next, '完成内容');
  chat.replaceAssistantDraft(next, '不能改写');
  expect(chat.getActiveConversation()?.messages.at(-1)?.content).toBe('完成内容');
});
