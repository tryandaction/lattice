import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = {
  get: vi.fn(),
  set: vi.fn(),
  setStrict: undefined as ReturnType<typeof vi.fn> | undefined,
  remove: vi.fn(),
  clear: vi.fn(),
};

vi.mock("@/lib/storage-adapter", () => ({
  getStorageAdapter: () => storage,
}));

import { useAiChatStore } from "../ai-chat-store";

describe("ai chat history", () => {
  it('preserves the original legacy source workspace when subsequent requests change storage scope', async () => {
    const store = useAiChatStore.getState();
    useAiChatStore.setState({ hasHydratedConversations: true, activeConversationId: 'legacy-scope', conversations: [{ id: 'legacy-scope', title: 'Legacy', createdAt: 1, workspace: { workspaceKey: 'A' }, messages: [
      { id: 'old', role: 'assistant', content: 'Old paper', timestamp: 1, evidenceRefs: [{ kind: 'pdf_page', label: 'Senoo', locator: 'papers/Senoo.pdf#page=61' }] },
    ] }] });
    store.setConversationWorkspace({ workspaceKey: 'B' });
    expect(store.getActiveConversation()?.messages[0].legacySourceWorkspaceKey).toBe('A');
    await store.flushConversations();
    storage.get.mockResolvedValue(storage.set.mock.calls.at(-1)![1]);
    useAiChatStore.setState({ conversations: [], activeConversationId: null, hasHydratedConversations: false });
    await store.loadConversations();
    expect(store.getActiveConversation()?.workspace?.workspaceKey).toBe('B');
    expect(store.getActiveConversation()?.messages[0].legacySourceWorkspaceKey).toBe('A');
  });
  it('restores the second selected conversation instead of the first persisted row', async () => {
    const store = useAiChatStore.getState();
    const second = store.newConversation();
    store.addUserMessage('Second selected history');
    store.newConversation();
    store.addUserMessage('First visible row');
    store.setActiveConversation(second);
    await store.flushConversations();
    storage.get.mockResolvedValue(storage.set.mock.calls.at(-1)![1]);
    useAiChatStore.setState({ conversations: [], activeConversationId: null, hasHydratedConversations: false });
    await store.loadConversations();
    expect(useAiChatStore.getState().activeConversationId).toBe(second);
    expect(store.getActiveConversation()?.messages[0].content).toBe('Second selected history');
  });

  it('persists a 50K ordinary draft in an otherwise empty conversation without auto-submitting on restore', async () => {
    const store = useAiChatStore.getState();
    const text = '长输入 English $\\alpha$\n'.repeat(3000).slice(0, 50000);
    store.setComposerDraft({ text, mode: 'agent', submit: true, continuation: { sourceSessionId: 'resume-1' } });
    store.consumeComposerDraft();
    await store.flushConversations();
    const saved = storage.set.mock.calls.at(-1)![1];
    expect(saved.conversations[0]?.draft).toMatchObject({ text, mode: 'agent' });
    expect(saved.conversations[0]?.draft.submit).not.toBe(true);
    storage.get.mockResolvedValue(saved);
    useAiChatStore.setState({ conversations: [], activeConversationId: null, composerDraft: null, hasHydratedConversations: false });
    await store.loadConversations();
    expect(store.getActiveConversation()).toMatchObject({ draft: { text, mode: 'agent' } });
    expect(useAiChatStore.getState().composerDraft).toBeNull();
  });

  it('merges stored history without overwriting a conversation created while hydration is pending', async () => {
    let resolveLoad!: (value: unknown) => void;
    storage.get.mockReturnValue(new Promise(resolve => { resolveLoad = resolve; }));
    const store = useAiChatStore.getState();
    const loading = store.loadConversations();
    const localId = store.newConversation();
    store.addUserMessage('New local question');
    resolveLoad({ version: 2, conversations: [{ id: 'stored', title: 'Stored', createdAt: 1, messages: [{ id: 'stored-user', role: 'user', content: 'Stored question', timestamp: 1 }] }] });
    await loading;
    expect(useAiChatStore.getState().activeConversationId).toBe(localId);
    expect(store.getActiveConversation()?.messages[0]?.content).toBe('New local question');
    expect(useAiChatStore.getState().conversations.some(conversation => conversation.id === 'stored')).toBe(true);
  });

  it('uses a single hydration flight across the AppLayout and AI panel entry points', async () => {
    let resolveLoad!: (value: unknown) => void;
    storage.get.mockReturnValue(new Promise(resolve => { resolveLoad = resolve; }));
    const store = useAiChatStore.getState();
    const layoutLoad = store.loadConversations();
    const panelLoad = store.loadConversations();
    resolveLoad([{ id: 'stored', title: 'Stored', createdAt: 1, messages: [{ id: 'stored-user', role: 'user', content: 'Stored question', timestamp: 1 }] }]);
    await Promise.all([layoutLoad, panelLoad]);
    expect(storage.get).toHaveBeenCalledTimes(1);
    const newId = store.newConversation();
    storage.get.mockResolvedValue(null);
    await store.loadConversations();
    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(useAiChatStore.getState().activeConversationId).toBe(newId);
  });

  it('reads stored history before the first local edit can checkpoint over an unhydrated session', async () => {
    storage.get.mockResolvedValue([{ id: 'existing-before-start', title: 'Existing', createdAt: 1, messages: [{ id: 'existing-user', role: 'user', content: 'Earlier saved history', timestamp: 1 }] }]);
    const store = useAiChatStore.getState();
    store.addUserMessage('User typed before AppLayout hydration');
    await vi.advanceTimersByTimeAsync(1000);
    const saved = storage.set.mock.calls.at(-1)?.[1];
    expect(saved?.conversations.some((conversation: { id: string }) => conversation.id === 'existing-before-start')).toBe(true);
    expect(store.getActiveConversation()?.messages[0]?.content).toBe('User typed before AppLayout hydration');
  });

  it('keeps a strict flush boundary stable while merging a pending hydration', async () => {
    let resolveLoad!: (value: unknown) => void;
    storage.get.mockReturnValue(new Promise(resolve => { resolveLoad = resolve; }));
    const store = useAiChatStore.getState();
    const id = store.setConversationDraft('Before strict boundary');
    const flushing = store.flushConversations();
    store.setConversationDraft('After strict boundary', id);
    resolveLoad([{ id: 'older-from-disk', title: 'Older', createdAt: 1, messages: [{ id: 'old-user', role: 'user', content: 'Stored old history', timestamp: 1 }] }]);
    await flushing;
    const saved = storage.set.mock.calls.at(-1)![1];
    expect(saved.conversations.find((conversation: { id: string }) => conversation.id === id)?.draft.text).toBe('Before strict boundary');
    expect(saved.conversations.some((conversation: { id: string }) => conversation.id === 'older-from-disk')).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.set.mock.calls.at(-1)![1].conversations.find((conversation: { id: string }) => conversation.id === id)?.draft.text).toBe('After strict boundary');
  });

  it('does not allow a background hydration waiter to capture edits beyond a later strict boundary', async () => {
    let resolveLoad!: (value: unknown) => void;
    storage.get.mockReturnValue(new Promise(resolve => { resolveLoad = resolve; }));
    const store = useAiChatStore.getState();
    const id = store.setConversationDraft('Background boundary');
    await vi.advanceTimersByTimeAsync(1000);
    store.setConversationDraft('Strict boundary', id);
    const flushing = store.flushConversations();
    store.setConversationDraft('After strict boundary', id);
    resolveLoad(null);
    await flushing;
    expect(storage.set.mock.calls[0]?.[1].conversations[0].draft.text).toBe('Background boundary');
    expect(storage.set.mock.calls[1]?.[1].conversations[0].draft.text).toBe('Strict boundary');
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.set.mock.calls.at(-1)![1].conversations[0].draft.text).toBe('After strict boundary');
  });

  it('keeps a cleared history empty when an older hydration completes', async () => {
    let resolveLoad!: (value: unknown) => void;
    storage.get.mockReturnValue(new Promise(resolve => { resolveLoad = resolve; }));
    const store = useAiChatStore.getState();
    const loading = store.loadConversations();
    store.clearAllHistory();
    resolveLoad([{ id: 'stored', title: 'Stored', createdAt: 1, messages: [{ id: 'stored-user', role: 'user', content: 'Stored question', timestamp: 1 }] }]);
    await loading;
    expect(useAiChatStore.getState().conversations).toEqual([]);
    expect(useAiChatStore.getState().activeConversationId).toBeNull();
  });

  it('checkpoints a loaded Web session synchronously on pagehide before a process can exit', async () => {
    localStorage.removeItem('lattice-ai-chat');
    const store = useAiChatStore.getState();
    await store.loadConversations();
    const id = store.setConversationDraft('Draft typed immediately before exit');
    window.dispatchEvent(new Event('pagehide'));
    const checkpoint = JSON.parse(localStorage.getItem('lattice-ai-chat') ?? 'null');
    expect(checkpoint?.activeConversationId).toBe(id);
    expect(checkpoint?.conversations[0]?.draft?.text).toBe('Draft typed immediately before exit');
    await vi.advanceTimersByTimeAsync(0);
  });

  it('excludes an entire turn when source authorization is attached to its user message', () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Read the authorized source');
    const id = store.startAssistantMessage();
    store.finishAssistantMessage(id, 'Facts from the source');
    const conversation = store.getActiveConversation()!;
    useAiChatStore.setState({ conversations: [{ ...conversation, sourcesValidation: 'required', messages: conversation.messages.map((message, index) => index === 0 ? { ...message, documentContext: { workspaceKey: 'workspace-a', paths: ['paper.md'] } } : message) }] });
    expect(store.getMessagesForApi()).toEqual([]);
    expect(store.getActiveConversation()?.messages).toHaveLength(2);
  });

  it('blocks history writes after a future schema is detected instead of destroying it', async () => {
    const future = { version: 99, activeConversationId: 'future', conversations: [] };
    storage.get.mockResolvedValue(future);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = useAiChatStore.getState();
    await store.loadConversations();
    store.setConversationDraft('Local draft');
    await expect(store.flushConversations()).rejects.toThrow(/newer Lattice/);
    expect(storage.set).not.toHaveBeenCalled();
    expect(store.getConversationDraft()?.text).toBe('Local draft');
  });

  it('retains the failed response when a late completion attempts to replace it', () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Question');
    const id = store.startAssistantMessage();
    store.appendToAssistantMessage(id, 'Retained draft');
    store.setAssistantError(id, 'Storage fixture provider failure');
    store.finishAssistantMessage(id, 'Late replacement');
    expect(store.getActiveConversation()?.messages.at(-1)?.content).toBe('Retained draft');
    expect(store.getMessagesForApi()).toEqual([]);
  });

  it('does not send a legacy live user turn while its assistant is still streaming', () => {
    useAiChatStore.setState({ activeConversationId: 'live', conversations: [{ id: 'live', title: 'Live', createdAt: 1, messages: [
      { id: 'u', role: 'user', content: 'Unfinished question', timestamp: 1 },
      { id: 'a', role: 'assistant', content: 'Partial output', timestamp: 2, isStreaming: true },
    ] }] });
    expect(useAiChatStore.getState().getMessagesForApi()).toEqual([]);
  });

  it('keeps ordinary drafts and external continuation commands scoped to their own conversations', async () => {
    const store = useAiChatStore.getState();
    const first = store.setConversationDraft({ text: 'First draft', mode: 'agent', continuation: { sourceSessionId: 'source-first' } });
    const second = store.newConversation();
    expect(store.getConversationDraft()).toBeNull();
    store.setComposerDraft({ text: 'Second draft', submit: true });
    expect(store.consumeComposerDraft()?.submit).toBe(true);
    expect(store.consumeComposerDraft()).toBeNull();
    expect(store.getConversationDraft()?.text).toBe('Second draft');
    store.setComposerDraft({ text: 'Late command' });
    store.setActiveConversation(first);
    expect(store.consumeComposerDraft()).toBeNull();
    expect(store.getConversationDraft()).toMatchObject({ text: 'First draft', continuation: { sourceSessionId: 'source-first' } });
    store.setConversationDraft(null, second);
    expect(store.getConversationDraft(first)?.text).toBe('First draft');
    expect(store.getConversationDraft(second)).toBeNull();
    await store.flushConversations();
  });

  it('persists continuous edits within two seconds without truncating the stored 50K draft', async () => {
    const store = useAiChatStore.getState();
    const text = '中 English \\[x^2\\]\n'.repeat(4000).slice(0, 50000);
    for (let index = 0; index < 30; index += 1) {
      store.setConversationDraft(text + index);
      await vi.advanceTimersByTimeAsync(100);
    }
    const checkpointAtTwoSeconds = storage.set.mock.calls[0]?.[1];
    expect(checkpointAtTwoSeconds?.conversations[0]?.draft?.text.length).toBe(50002);
    await store.flushConversations();
    const saved = storage.set.mock.calls.at(-1)![1];
    expect(saved.conversations[0].draft.text === text + '29').toBe(true);
    expect(storage.set.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('reports a background strict checkpoint failure and retries the complete latest snapshot', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storage.setStrict = vi.fn().mockRejectedValueOnce(new Error('Quota exceeded')).mockResolvedValue(undefined);
    const store = useAiChatStore.getState();
    const id = store.setConversationDraft('Draft that failed to save');
    await vi.advanceTimersByTimeAsync(1000);
    expect(useAiChatStore.getState().persistenceError).toBe('Quota exceeded');
    expect(store.getConversationDraft()?.text).toBe('Draft that failed to save');
    store.setConversationDraft('Recovered latest draft', id);
    await store.flushConversations();
    expect(useAiChatStore.getState().persistenceError).toBeNull();
    expect(storage.setStrict.mock.calls.at(-1)![1]).toMatchObject({ activeConversationId: id, conversations: [expect.objectContaining({ draft: { text: 'Recovered latest draft' } })] });
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('revalidates restored source history against workspace, library, account and permission identity', async () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Source question');
    const id = store.startAssistantMessage();
    store.setAssistantMetadata(id, { documentContext: { workspaceKey: 'workspace-a', paths: ['nested/paper.md'] } });
    store.finishAssistantMessage(id, 'Verified source answer');
    const binding = { workspaceKey: 'workspace-a', libraryId: 'library-a', accountId: 'account-a', permissionScope: 'read-v1' };
    store.setConversationWorkspace(binding);
    expect(store.getMessagesForApi()).toEqual([]);
    expect(store.markConversationSourcesValidated(binding)).toBe(true);
    expect(store.getMessagesForApi()).toEqual([{ role: 'user', content: 'Source question' }, { role: 'assistant', content: 'Verified source answer' }]);
    await store.flushConversations();
    storage.get.mockResolvedValue(storage.set.mock.calls.at(-1)![1]);
    useAiChatStore.setState({ conversations: [], activeConversationId: null, hasHydratedConversations: false });
    await store.loadConversations();
    expect(store.getActiveConversation()?.workspace).toEqual(binding);
    expect(store.getMessagesForApi()).toEqual([]);
    expect(store.markConversationSourcesValidated({ ...binding, accountId: 'wrong-account' })).toBe(false);
    expect(store.markConversationSourcesValidated(binding)).toBe(true);
    store.setConversationWorkspace({ ...binding, permissionScope: 'revoked' });
    expect(store.getMessagesForApi()).toEqual([]);
    expect(store.getActiveConversation()?.sourcesValidation).toBe('required');
    store.invalidateConversationSources();
    expect(store.getActiveConversation()?.messages.at(-1)?.content).toBe('Verified source answer');
  });

  it('returns history for the requested conversation while a different one is active', () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('First question');
    const first = useAiChatStore.getState().activeConversationId!;
    store.newConversation();
    store.addUserMessage('Second question');
    expect(store.getMessagesForApi(first)).toEqual([{ role: 'user', content: 'First question' }]);
    expect(store.getMessagesForApi()).toEqual([{ role: 'user', content: 'Second question' }]);
  });

  it('excludes one invalid old source turn while allowing a newly validated source turn', () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Old source question');
    const old = store.startAssistantMessage();
    store.setAssistantMetadata(old, { documentContext: { workspaceKey: 'workspace-a', paths: ['removed.md'] } });
    store.finishAssistantMessage(old, 'Old source facts');
    store.addUserMessage('New source question');
    const current = store.startAssistantMessage();
    store.setAssistantMetadata(current, { documentContext: { workspaceKey: 'workspace-a', paths: ['new.md'] } });
    store.finishAssistantMessage(current, 'New source facts');
    const binding = { workspaceKey: 'workspace-a' };
    store.setConversationWorkspace(binding);
    expect(store.markConversationSourcesValidated(binding, undefined, [current])).toBe(true);
    expect(store.getMessagesForApi()).toEqual([{ role: 'user', content: 'New source question' }, { role: 'assistant', content: 'New source facts' }]);
    expect(store.getActiveConversation()?.sourcesValidation).toBe('required');
    store.setConversationWorkspace({ ...binding, accountId: 'changed' });
    expect(store.getMessagesForApi()).toEqual([]);
  });

  it('invalidates only the changed source message after a source snapshot is replaced', () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('First source question');
    const first = store.startAssistantMessage();
    store.setAssistantMetadata(first, { documentContext: { workspaceKey: 'workspace-a', paths: ['first.md'] } });
    store.finishAssistantMessage(first, 'First source facts');
    store.addUserMessage('Second source question');
    const second = store.startAssistantMessage();
    store.setAssistantMetadata(second, { documentContext: { workspaceKey: 'workspace-a', paths: ['second.md'] } });
    store.finishAssistantMessage(second, 'Second source facts');
    const binding = { workspaceKey: 'workspace-a' };
    store.setConversationWorkspace(binding);
    store.markConversationSourcesValidated(binding);
    store.setAssistantMetadata(first, { documentContext: { workspaceKey: 'workspace-a', paths: ['changed.md'] } });
    expect(store.getMessagesForApi()).toEqual([{ role: 'user', content: 'Second source question' }, { role: 'assistant', content: 'Second source facts' }]);
  });

  it('finds the exact original user input for a stored long-input checkpoint', () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Actual original input');
    const id = store.startAssistantMessage();
    const checkpoint = { version: 1 as const, input: { revision: 'sha256:test', length: 21 }, instructionRevision: 'sha256:task', modelId: 'fixture', contextWindow: 512,
      outputReserveTokens: 64, summaryTokens: 64, ranges: [{ start: 0, end: 21 }], completed: [], compressions: [], status: 'interrupted' as const };
    store.setAssistantMetadata(id, { agentResult: { sessionId: 'input-session', inputCheckpoint: checkpoint } });
    store.stopGenerating();
    const conversationId = useAiChatStore.getState().activeConversationId!;
    store.newConversation();
    expect(store.getLongInputResume(id, conversationId)).toEqual({ input: 'Actual original input', checkpoint, assistantMessageId: id, conversationId });
    expect(store.getLongInputResume(id)).toBeNull();
  });

  it('ignores a corrupted persisted long-input checkpoint instead of crashing the resume action', async () => {
    storage.get.mockResolvedValue([{ id: 'corrupt-checkpoint', title: 'Corrupt', createdAt: 1, messages: [
      { id: 'u-corrupt', role: 'user', content: 'Original', timestamp: 1 },
      { id: 'a-corrupt', role: 'assistant', content: 'Partial', timestamp: 2, agentResult: { sessionId: 'session', inputCheckpoint: {} } },
    ] }]);
    const store = useAiChatStore.getState();
    await store.loadConversations();
    expect(store.getLongInputResume()).toBeNull();
  });

  it('restores a crashed long-input checkpoint as interrupted without changing its live processing state', async () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Actual original input');
    const id = store.startAssistantMessage();
    const checkpoint = { version: 1 as const, input: { revision: 'sha256:test', length: 21 }, instructionRevision: 'sha256:task', modelId: 'fixture', contextWindow: 512,
      outputReserveTokens: 64, summaryTokens: 64, ranges: [{ start: 0, end: 21 }], completed: [], compressions: [], status: 'processing' as const };
    store.setAssistantMetadata(id, { agentResult: { sessionId: 'input-session', inputCheckpoint: checkpoint } });
    await store.flushConversations();
    expect(store.getLongInputResume(id)?.checkpoint.status).toBe('processing');
    storage.get.mockResolvedValue(storage.set.mock.calls.at(-1)![1]);
    useAiChatStore.setState({ conversations: [], activeConversationId: null, activeAssistantMessageId: null, hasHydratedConversations: false });
    await store.loadConversations();
    expect(store.getLongInputResume(id)?.checkpoint.status).toBe('interrupted');
  });

  it('checkpoints a live stream at a bounded rate without waiting for generation to finish', async () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Long task');
    const id = store.startAssistantMessage();
    for (let n = 0; n < 30; n++) {
      store.appendToAssistantMessage(id, 'part-' + n + ' ');
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(2000);
    expect(storage.set.mock.calls.length).toBeGreaterThan(0);
    expect(storage.set.mock.calls.length).toBeLessThanOrEqual(3);
    const saved = storage.set.mock.calls.at(-1)![1].conversations[0].messages.at(-1);
    expect(saved).toMatchObject({ id, isStreaming: false, isInterrupted: true });
    expect(saved.content).toContain('part-29');
    expect(store.getActiveConversation()!.messages.at(-1)!.isStreaming).toBe(true);
  });

  it.each(['', 'Unverified partial response'])('restores an unfinished request as an interrupted draft: %s', async (partial) => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Explain this paper');
    const id = store.startAssistantMessage({ requestMode: 'chat' });
    if (partial) store.appendToAssistantMessage(id, partial);
    await store.flushConversations();
    const persisted = storage.set.mock.calls.at(-1)![1];
    // The persistence snapshot must not change the still-running live message.
    expect(store.getActiveConversation()!.messages.at(-1)!.isStreaming).toBe(true);
    storage.get.mockResolvedValue(persisted);
    useAiChatStore.setState({ conversations: [], activeConversationId: null, isGenerating: false, activeAssistantMessageId: null, hasHydratedConversations: false });
    await store.loadConversations();
    const restored = store.getActiveConversation()!.messages.at(-1)!;
    expect(restored).toMatchObject({ id, isStreaming: false, isInterrupted: true });
    if (partial) expect(restored.content).toBe(partial);
    else expect(restored.content).toMatch(/stopped|已停止/i);
    expect(store.getMessagesForApi()).toEqual([]);
  });

  it('keeps a failed partial answer visible but excludes its failed turn from model history', () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Explain the paper');
    const id = store.startAssistantMessage({ requestMode: 'chat' });
    store.appendToAssistantMessage(id, 'The first part of the explanation.');
    store.setAssistantError(id, 'AI request idle timed out');
    expect(store.getActiveConversation()?.messages.at(-1)).toMatchObject({ content: 'The first part of the explanation.', error: 'AI request idle timed out', isStreaming: false });
    expect(store.getMessagesForApi()).toEqual([]);
  });

  it('keeps an empty failed response empty so the provider error is shown once', () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Explain this');
    const id = store.startAssistantMessage();
    store.setAssistantError(id, 'Synthetic provider error');
    expect(store.getActiveConversation()?.messages.at(-1)).toMatchObject({ content: '', error: 'Synthetic provider error', isStreaming: false });
  });

  it('does not present legacy provider errors as assistant knowledge or pending user requests', () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Analyze this document');
    const id = store.startAssistantMessage();
    store.finishAssistantMessage(id, 'Error: Provider request timed out');
    expect(store.getMessagesForApi()).toEqual([]);
    expect(store.getActiveConversation()?.messages).toHaveLength(2);
  });
  it('retains a non-streaming incomplete answer without treating it as successful history', () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('详细讲解');
    const id = store.startAssistantMessage();
    store.setAssistantError(id, 'Continuation budget exhausted', 'The completed first two sections.');
    expect(store.getActiveConversation()?.messages.at(-1)).toMatchObject({ content: 'The completed first two sections.', error: 'Continuation budget exhausted', isStreaming: false });
    expect(store.getMessagesForApi()).toEqual([]);
  });
  it('saves received continuation bytes after stopping without reviving generation or accepting a replacement', () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Explain this');
    const id = store.startAssistantMessage();
    store.setGenerating(true, new AbortController());
    store.appendToAssistantMessage(id, 'First segment. ');
    store.stopGenerating();
    store.retainInterruptedAssistantDraft(id, 'First segment. Received continuation.');
    expect(store.getActiveConversation()?.messages.at(-1)).toMatchObject({ content: 'First segment. Received continuation.', isInterrupted: true, isStreaming: false });
    expect(useAiChatStore.getState().isGenerating).toBe(false);
    store.retainInterruptedAssistantDraft(id, 'A new unrelated replacement that is longer.');
    store.appendToAssistantMessage(id, 'Late post-abort text');
    expect(store.getActiveConversation()?.messages.at(-1)?.content).toBe('First segment. Received continuation.');
    expect(store.getMessagesForApi()).toEqual([]);
  });
  it("persists a visible stopped status for an empty Agent response and rejects late results", async () => {
    const store = useAiChatStore.getState();
    store.addUserMessage('Read and annotate the paper');
    const id = store.startAssistantMessage({ requestMode: 'agent' });
    store.setGenerating(true, new AbortController());
    store.stopGenerating();
    const stopped = store.getActiveConversation()!.messages.at(-1)!;
    expect(stopped.content).toMatch(/stopped|已停止/i);
    expect(stopped).toMatchObject({ isStreaming: false, isInterrupted: true });
    store.appendToAssistantMessage(id, 'Late provider output');
    store.finishAssistantMessage(id, 'Late verified result');
    expect(store.getActiveConversation()!.messages.at(-1)!.content).toBe(stopped.content);
    expect(store.getMessagesForApi()).toEqual([]);
    await store.flushConversations();
    expect(storage.set).toHaveBeenLastCalledWith('lattice-ai-chat', expect.objectContaining({ conversations: [expect.objectContaining({ messages: expect.arrayContaining([expect.objectContaining({ id, content: stopped.content })]) })] }));
  });
  it("keeps cancelled unverified drafts out of history and ignores late repair writes", () => {
    const store = useAiChatStore.getState();
    store.addUserMessage("Question");
    const id = store.startAssistantMessage();
    store.setGenerating(true, new AbortController());
    store.appendToAssistantMessage(id, "Unverified draft");
    store.stopGenerating();
    const next = store.startAssistantMessage();
    store.setGenerating(true, new AbortController());
    store.appendToAssistantMessage(id, " late delta");
    store.finishAssistantMessage(id, "Late repaired result");
    expect(store.getActiveConversation()?.messages[1]).toMatchObject({ content: "Unverified draft", isInterrupted: true, isStreaming: false });
    expect(store.getMessagesForApi()).toEqual([]);
    expect(useAiChatStore.getState().activeAssistantMessageId).toBe(next);
    expect(useAiChatStore.getState().isGenerating).toBe(true);
  });
  it("replaces the streamed draft with the verified final answer atomically", () => {
    const store = useAiChatStore.getState();
    store.addUserMessage("Research question");
    const messageId = store.startAssistantMessage();
    store.appendToAssistantMessage(messageId, "Draft with invalid citation");
    store.finishAssistantMessage(messageId, "Verified repaired answer");
    expect(store.getActiveConversation()?.messages[1]).toMatchObject({ content: "Verified repaired answer", isStreaming: false });
    expect(useAiChatStore.getState().isGenerating).toBe(false);
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    storage.get.mockResolvedValue(null);
    storage.set.mockReset().mockResolvedValue(undefined);
    storage.setStrict = undefined;
    useAiChatStore.setState({
      hasHydratedConversations: false,
      persistenceError: null,
      hydrationError: null,
      conversations: [],
      activeConversationId: null,
      isOpen: false,
      isGenerating: false,
      abortController: null,
      activeAssistantMessageId: null,
      selectedResearchWorkflowId: null,
      noteConfigOverrides: {},
      composerDraft: null,
      composerMode: "chat",
    });
  });

  it("edits and durably reloads a completed assistant response without losing evidence", async () => {
    storage.setStrict = vi.fn().mockResolvedValue(undefined);
    const store = useAiChatStore.getState();
    store.addUserMessage("Research question");
    const messageId = store.startAssistantMessage();
    store.appendToAssistantMessage(messageId, "Original answer");
    const evidenceRefs = [{ kind: "pdf_page" as const, locator: "paper.pdf#page=3", label: "p.3", preview: "original quote" }];
    store.setAssistantMetadata(messageId, { evidenceRefs, agentResult: { sessionId: "original-session" } });
    store.finishAssistantMessage(messageId);
    const edited = "# Revised\n\n$x^2$\n\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |";
    await store.updateAssistantMessage(messageId, edited, "Original answer");
    const saved = storage.setStrict.mock.calls[0]?.[1];
    expect(saved.conversations[0].messages[1]).toMatchObject({
      content: edited, editedAt: expect.any(Number), evidenceRefs,
      agentResult: { sessionId: "original-session" },
    });
    storage.get.mockResolvedValue(saved);
    useAiChatStore.setState({ conversations: [], activeConversationId: null, hasHydratedConversations: false });
    await store.loadConversations();
    expect(useAiChatStore.getState().getActiveConversation()?.messages[1]).toMatchObject({ content: edited, editedAt: expect.any(Number), evidenceRefs });
    expect(useAiChatStore.getState().composerDraft).toBeNull();
    expect(useAiChatStore.getState().isGenerating).toBe(false);
  });

  it("rejects edits of streaming/user responses, stale drafts, and empty Markdown", async () => {
    const store = useAiChatStore.getState();
    store.addUserMessage("Question");
    const userId = store.getActiveConversation()!.messages[0].id;
    await expect(store.updateAssistantMessage(userId, "New")).rejects.toThrow(/completed assistant/);
    const messageId = store.startAssistantMessage();
    await expect(store.updateAssistantMessage(messageId, "New")).rejects.toThrow(/completed assistant/);
    store.appendToAssistantMessage(messageId, "Original");
    store.finishAssistantMessage(messageId);
    await expect(store.updateAssistantMessage(messageId, "New", "Stale")).rejects.toThrow(/changed/);
    await expect(store.updateAssistantMessage(messageId, " \n ", "Original")).rejects.toThrow(/empty/);
    expect(store.getActiveConversation()?.messages[1].content).toBe("Original");
  });

  it("rolls back only a failed message edit while retaining a concurrently opened conversation", async () => {
    let rejectSave!: (error: Error) => void;
    storage.setStrict = vi.fn().mockReturnValue(new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    const store = useAiChatStore.getState();
    store.addUserMessage("Original conversation");
    const firstConversation = useAiChatStore.getState().activeConversationId;
    const messageId = store.startAssistantMessage();
    store.appendToAssistantMessage(messageId, "Original answer");
    store.finishAssistantMessage(messageId);
    const edit = store.updateAssistantMessage(messageId, "Edited answer", "Original answer");
    const rejected = expect(edit).rejects.toThrow("disk full");
    await Promise.resolve();
    const newConversation = store.newConversation();
    store.addUserMessage("New parallel question");
    rejectSave(new Error("disk full"));
    await rejected;
    const state = useAiChatStore.getState();
    expect(state.activeConversationId).toBe(newConversation);
    expect(state.getActiveConversation()?.messages[0].content).toBe("New parallel question");
    expect(state.conversations.find((conversation) => conversation.id === firstConversation)?.messages[1])
      .toMatchObject({ content: "Original answer", editedAt: undefined });
  });

  it("renames and clears persisted conversations without leaving an active id", async () => {
    const id = useAiChatStore.getState().newConversation();
    useAiChatStore.getState().renameConversation(id, "  Literature review  ");
    expect(useAiChatStore.getState().getActiveConversation()?.title).toBe("Literature review");

    useAiChatStore.getState().clearAllHistory();
    expect(useAiChatStore.getState().conversations).toEqual([]);
    expect(useAiChatStore.getState().activeConversationId).toBeNull();
    vi.runAllTimers();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.set).toHaveBeenLastCalledWith("lattice-ai-chat", { version: 3, conversations: [], activeConversationId: null, composerMode: 'chat' });
  });

  it("persists versioned note workflow overrides and restores them", async () => {
    useAiChatStore.getState().setNoteConfigOverrides({ language: "en-US", noteStyle: "concise", quotePolicy: "short-quotes-only" });
    await Promise.resolve();
    expect(storage.set).toHaveBeenCalledWith("lattice-ai-workflow-config-v1", expect.objectContaining({ version: 1 }));
    useAiChatStore.setState({ selectedResearchWorkflowId: null, noteConfigOverrides: {} });
    storage.get.mockResolvedValue({ version: 1, overrides: { language: "en-US", sections: ["Summary"] } });
    await useAiChatStore.getState().loadWorkflowConfig();
    expect(useAiChatStore.getState().noteConfigOverrides).toEqual({ language: "en-US", sections: ["Summary"] });
  });

  it("restores valid writing preferences while ignoring a persisted manual workflow", async () => {
    storage.get.mockResolvedValue({ version: 1, selectedResearchWorkflowId: "reading-note", overrides: { language: "bad", noteStyle: "academic", sections: ["Summary", 2], quotePolicy: "bad", template: "# Note", unknown: true } });
    await useAiChatStore.getState().loadWorkflowConfig();
    expect(useAiChatStore.getState().selectedResearchWorkflowId).toBeNull();
    expect(useAiChatStore.getState().noteConfigOverrides).toEqual({ noteStyle: "academic", template: "# Note" });
    storage.get.mockResolvedValue({ version: 99, overrides: { language: "en-US" } });
    await useAiChatStore.getState().loadWorkflowConfig();
    expect(useAiChatStore.getState().noteConfigOverrides).toEqual({ noteStyle: "academic", template: "# Note" });
  });

  it("rejects invalid runtime overrides before they can reach the runner", () => {
    useAiChatStore.getState().setNoteConfigOverrides({
      language: "invalid" as "en-US",
      noteStyle: "invalid" as "academic",
      quotePolicy: "invalid" as "paraphrase-first",
      sections: ["", "  "],
      template: "   ",
      approvalMode: "auto-draft-only",
    });
    useAiChatStore.getState().setResearchWorkflow("invalid" as "reading-note");
    expect(useAiChatStore.getState().noteConfigOverrides).toEqual({});
    expect(useAiChatStore.getState().selectedResearchWorkflowId).toBeNull();
  });

  it("does not let late hydration overwrite a user change", async () => {
    let resolveLoad!: (value: unknown) => void;
    storage.get.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
    const loading = useAiChatStore.getState().loadWorkflowConfig();
    useAiChatStore.getState().setNoteConfigOverrides({ language: "en-US" });
    resolveLoad({ version: 1, selectedResearchWorkflowId: null, overrides: { language: "zh-CN" } });
    await loading;
    expect(useAiChatStore.getState().noteConfigOverrides.language).toBe("en-US");
  });

  it("preserves a manual next-request choice made while stored preferences are loading", async () => {
    let resolveLoad!: (value: unknown) => void;
    storage.get.mockReturnValue(new Promise(resolve => { resolveLoad = resolve; }));
    const loading = useAiChatStore.getState().loadWorkflowConfig();
    useAiChatStore.getState().setResearchWorkflow("code-change-plan");
    useAiChatStore.getState().setNoteConfigOverrides({ language: "en-US" });
    resolveLoad({ version: 1, selectedResearchWorkflowId: "paper-reading", overrides: { language: "zh-CN", noteStyle: "academic" } });
    await loading;
    expect(useAiChatStore.getState().selectedResearchWorkflowId).toBe("code-change-plan");
    expect(useAiChatStore.getState().noteConfigOverrides).toEqual({ language: "en-US" });
  });

  it("preserves an explicit return to automatic workflow during hydration", async () => {
    let resolveLoad!: (value: unknown) => void;
    storage.get.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
    const loading = useAiChatStore.getState().loadWorkflowConfig();
    useAiChatStore.getState().setResearchWorkflow("reading-note");
    useAiChatStore.getState().setResearchWorkflow(null);
    resolveLoad({ version: 1, selectedResearchWorkflowId: "paper-reading", overrides: {} });
    await loading;
    expect(useAiChatStore.getState().selectedResearchWorkflowId).toBeNull();
  });

  it("rejects coercible non-string enums restored from storage", async () => {
    storage.get.mockResolvedValue({ version: 1, overrides: {
      language: ["en-US"], noteStyle: ["academic"], quotePolicy: ["paraphrase-first"],
      approvalMode: "auto-draft-only",
    } });
    await useAiChatStore.getState().loadWorkflowConfig();
    expect(useAiChatStore.getState().noteConfigOverrides).toEqual({});
  });

  it("migrates legacy arrays and ignores corrupted or empty history entries", async () => {
    storage.get.mockResolvedValue([
      { id: "legacy", title: "Old", createdAt: 10, messages: [{ id: "m1", role: "user", content: "Hello", timestamp: 11 }] },
      { id: "empty", title: "Empty", createdAt: 12, messages: [] },
      { broken: true },
    ]);

    await useAiChatStore.getState().loadConversations();

    expect(useAiChatStore.getState().conversations).toEqual([
      expect.objectContaining({ id: "legacy", title: "Old", messages: [expect.objectContaining({ content: "Hello" })] }),
    ]);
    expect(useAiChatStore.getState().activeConversationId).toBe("legacy");
  });

  it("migrates version zero envelopes and keeps message metadata usable", async () => {
    storage.get.mockResolvedValue({
      version: 0,
      conversations: [{
        id: "legacy-envelope",
        title: "Legacy",
        createdAt: "20",
        messages: [{ id: "legacy-message", role: "assistant", content: "Answer", timestamp: "21", isStreaming: true }],
      }],
    });
    await useAiChatStore.getState().loadConversations();
    expect(useAiChatStore.getState().getActiveConversation()).toEqual(expect.objectContaining({
      id: "legacy-envelope",
      createdAt: 20,
      messages: [expect.objectContaining({ id: "legacy-message", timestamp: 21, isStreaming: false })],
    }));
  });

  it("updates only the target assistant message during streaming", () => {
    const targetConversation = {
      id: "target-conversation",
      title: "Target",
      createdAt: 1,
      messages: [{ id: "assistant-target", role: "assistant" as const, content: "A", timestamp: 1, isStreaming: true }],
    };
    const otherConversation = {
      id: "other-conversation",
      title: "Other",
      createdAt: 2,
      messages: [{ id: "assistant-other", role: "assistant" as const, content: "B", timestamp: 2 }],
    };
    useAiChatStore.setState({
      conversations: [targetConversation, otherConversation],
      activeConversationId: targetConversation.id,
    });

    const before = useAiChatStore.getState().conversations;
    useAiChatStore.getState().appendToAssistantMessage("assistant-target", " chunk");
    const after = useAiChatStore.getState().conversations;

    expect(after[0]?.messages[0]?.content).toBe("A chunk");
    expect(after[1]).toBe(before[1]);
    expect(after[1]?.messages[0]).toBe(before[1]?.messages[0]);
  });

  it("persists assistant errors so recovery feedback survives reload", async () => {
    useAiChatStore.setState({
      conversations: [{
        id: "error-conversation",
        title: "Error",
        createdAt: 1,
        messages: [{ id: "assistant-error", role: "assistant", content: "", timestamp: 1, isStreaming: true }],
      }],
      activeConversationId: "error-conversation",
    });

    useAiChatStore.getState().setAssistantError("assistant-error", "Provider unavailable");
    vi.runAllTimers();
    await vi.advanceTimersByTimeAsync(0);

    expect(storage.set).toHaveBeenLastCalledWith("lattice-ai-chat", expect.objectContaining({
      conversations: [expect.objectContaining({
        messages: [expect.objectContaining({ content: "", error: "Provider unavailable", isStreaming: false })],
      })],
    }));
  });

  it("does not let a stopped request clear a newer generation", () => {
    const oldController = new AbortController();
    const newController = new AbortController();
    useAiChatStore.setState({
      conversations: [{
        id: "stop-race-conversation",
        title: "Stop race",
        createdAt: 1,
        messages: [
          { id: "assistant-old", role: "assistant", content: "partial", timestamp: 1, isStreaming: true },
          { id: "assistant-new", role: "assistant", content: "", timestamp: 2, isStreaming: true },
        ],
      }],
      activeConversationId: "stop-race-conversation",
      isGenerating: true,
      abortController: oldController,
      activeAssistantMessageId: "assistant-old",
    });

    useAiChatStore.getState().stopGenerating();
    expect(oldController.signal.aborted).toBe(true);
    expect(useAiChatStore.getState().getActiveConversation()?.messages[0]?.isStreaming).toBe(false);

    useAiChatStore.setState({
      isGenerating: true,
      abortController: newController,
      activeAssistantMessageId: "assistant-new",
    });
    useAiChatStore.getState().finishAssistantMessage("assistant-old");

    expect(useAiChatStore.getState().isGenerating).toBe(true);
    expect(useAiChatStore.getState().abortController).toBe(newController);
    expect(useAiChatStore.getState().getActiveConversation()?.messages[1]?.isStreaming).toBe(true);
  });

  it("flushes the recovery message anchor immediately before the debounce fires", async () => {
    storage.setStrict = vi.fn().mockResolvedValue(undefined);
    const store = useAiChatStore.getState();
    store.addUserMessage("Read the entire document");
    const messageId = store.startAssistantMessage({ requestMode: "agent" });
    store.setAssistantMetadata(messageId, { agentResult: { sessionId: "document-session-1" } });

    await store.flushConversations();

    expect(storage.setStrict).toHaveBeenCalledOnce();
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.setStrict).toHaveBeenCalledWith("lattice-ai-chat", {
      version: 3,
      activeConversationId: useAiChatStore.getState().activeConversationId,
      composerMode: 'chat',
      conversations: [expect.objectContaining({ messages: [
        expect.objectContaining({ role: "user", content: "Read the entire document" }),
        expect.objectContaining({ id: messageId, role: "assistant", content: expect.stringMatching(/stopped|已停止/i), isStreaming: false, isInterrupted: true, agentResult: { sessionId: "document-session-1" } }),
      ] })],
    });
  });

  it("cancels the old debounced snapshot so it cannot overwrite the flushed state", async () => {
    const store = useAiChatStore.getState();
    store.addUserMessage("Read the entire document");
    const messageId = store.startAssistantMessage({ requestMode: "agent" });
    store.appendToAssistantMessage(messageId, "Current progress");
    await store.flushConversations();
    await vi.advanceTimersByTimeAsync(1500);

    expect(storage.set).toHaveBeenCalledOnce();
    expect(storage.set).toHaveBeenCalledWith("lattice-ai-chat", expect.objectContaining({
      conversations: [expect.objectContaining({ messages: expect.arrayContaining([
        expect.objectContaining({ id: messageId, content: "Current progress" }),
      ]) })],
    }));
  });

  it("propagates strict write failures without falling back or poisoning later saves", async () => {
    const failure = new Error("Disk is full");
    storage.setStrict = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const store = useAiChatStore.getState();
    store.addUserMessage("Keep a resumable reading task");

    await expect(store.flushConversations()).rejects.toBe(failure);
    expect(storage.set).not.toHaveBeenCalled();
    await expect(store.flushConversations()).resolves.toBeUndefined();
    expect(storage.setStrict).toHaveBeenCalledTimes(2);
  });

  it("propagates failures from adapters without strict-write support", async () => {
    const failure = new Error("Storage unavailable");
    storage.set.mockRejectedValueOnce(failure);
    useAiChatStore.getState().addUserMessage("Read source");
    await expect(useAiChatStore.getState().flushConversations()).rejects.toBe(failure);
  });

  it("coalesces background history snapshots while a storage write is blocked", async () => {
    let releaseWrite!: () => void;
    storage.set.mockReturnValueOnce(new Promise<void>((resolve) => { releaseWrite = resolve; }));
    const store = useAiChatStore.getState();
    store.addUserMessage("Initial round");
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.set).toHaveBeenCalledTimes(1);
    for (let round = 1; round <= 12; round += 1) {
      store.addUserMessage(`Follow-up round ${round}`);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(storage.set).toHaveBeenCalledTimes(1);
    releaseWrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.set).toHaveBeenCalledTimes(2);
    expect(storage.set).toHaveBeenLastCalledWith("lattice-ai-chat", expect.objectContaining({
      conversations: [expect.objectContaining({ messages: expect.arrayContaining([
        expect.objectContaining({ content: "Follow-up round 12" }),
      ]) })],
    }));
  });

  it("does not coalesce a later background state across a strict flush boundary", async () => {
    let releaseWrite!: () => void;
    storage.set.mockReturnValueOnce(new Promise<void>((resolve) => { releaseWrite = resolve; }));
    const store = useAiChatStore.getState();
    store.addUserMessage("First");
    await vi.advanceTimersByTimeAsync(1000);
    storage.setStrict = vi.fn().mockResolvedValue(undefined);
    store.addUserMessage("Before strict flush");
    await vi.advanceTimersByTimeAsync(1000);
    const flushed = store.flushConversations();
    store.addUserMessage("After strict flush");
    await vi.advanceTimersByTimeAsync(1000);
    releaseWrite();
    await flushed;
    await vi.advanceTimersByTimeAsync(0);
    const strictValue = storage.setStrict.mock.calls.at(-2)?.[1] as { conversations: Array<{ messages: Array<{ content: string }> }> };
    expect(strictValue.conversations[0].messages.map((message) => message.content)).toEqual(["First", "Before strict flush"]);
    const finalValue = storage.setStrict.mock.calls.at(-1)?.[1] as { conversations: Array<{ messages: Array<{ content: string }> }> };
    expect(finalValue.conversations[0].messages.at(-1)?.content).toBe("After strict flush");
  });

  it("persists a cleared history after a failed old write without resurrecting queued messages", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let failOldWrite!: (error: Error) => void;
    let persisted: unknown = null;
    storage.set.mockImplementation(async (_key: string, value: unknown) => { persisted = value; });
    storage.set.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { failOldWrite = reject; }));
    storage.get.mockImplementation(async () => persisted);
    const store = useAiChatStore.getState();
    store.addUserMessage("Old conversation");
    await vi.advanceTimersByTimeAsync(1000);
    store.addUserMessage("Queued message");
    await vi.advanceTimersByTimeAsync(1000);
    store.clearAllHistory();
    await vi.advanceTimersByTimeAsync(1000);
    failOldWrite(new Error("Previous write failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.set).toHaveBeenCalledTimes(2);
    expect(persisted).toEqual({ version: 3, conversations: [], activeConversationId: null, composerMode: 'chat' });
    await store.loadConversations();
    expect(useAiChatStore.getState().conversations).toEqual([]);
    expect(useAiChatStore.getState().activeConversationId).toBeNull();
  });

  it("serializes a flush after an already running background save", async () => {
    let finishBackgroundSave!: () => void;
    storage.set.mockReturnValueOnce(new Promise<void>(resolve => { finishBackgroundSave = resolve; }));
    const store = useAiChatStore.getState();
    store.addUserMessage("Before flush");
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.set).toHaveBeenCalledOnce();
    storage.setStrict = vi.fn().mockResolvedValue(undefined);

    store.addUserMessage("Latest message");
    const flushing = store.flushConversations();
    await Promise.resolve();
    expect(storage.setStrict).not.toHaveBeenCalled();
    finishBackgroundSave();
    await flushing;

    expect(storage.setStrict).toHaveBeenCalledWith("lattice-ai-chat", expect.objectContaining({
      conversations: [expect.objectContaining({ messages: expect.arrayContaining([
        expect.objectContaining({ content: "Latest message" }),
      ]) })],
    }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(storage.setStrict).toHaveBeenCalledOnce();
    expect(storage.set).toHaveBeenCalledOnce();
  });
});
