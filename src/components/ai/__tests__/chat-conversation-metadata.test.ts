import { describe, expect, it, vi } from 'vitest';
import type { ChatConversation, ChatMessage } from '@/stores/ai-chat-store';
import type { AiContextNode, AiPromptContext } from '@/lib/ai/types';
import { createConversationMetadataSelector } from '../chat-conversation-metadata';

function message(id: string, context?: AiPromptContext): ChatMessage {
  return { id, role: 'assistant', content: 'answer', timestamp: 1, promptContext: context };
}

function conversation(messages: ChatMessage[], id = 'conversation'): ChatConversation {
  return { id, title: 'Research', createdAt: 1, messages };
}

describe('conversation metadata subscription', () => {
  it('tracks delivery-only updates and clears their status for the next request', () => {
    const select = createConversationMetadataSelector();
    const partial = { ...message('reply'), agentResult: { sessionId: 'task', deliveryStatus: 'partial' as const } };
    const first = select({ conversations: [conversation([partial])], activeConversationId: 'conversation' });
    expect(first).toMatchObject({ messageSessionId: 'task', deliveryStatus: 'partial' });
    const ready = { ...partial, agentResult: { sessionId: 'task', deliveryStatus: 'ready_for_review' as const } };
    const updated = select({ conversations: [conversation([ready])], activeConversationId: 'conversation' });
    expect(updated).not.toBe(first);
    expect(updated.deliveryStatus).toBe('ready_for_review');
    const newQuestion = { id: 'next-user', role: 'user' as const, content: 'New topic', timestamp: 2 };
    expect(select({ conversations: [conversation([ready, newQuestion])], activeConversationId: 'conversation' })).toMatchObject({ messageSessionId: null, deliveryStatus: null });
    expect(select({ conversations: [conversation([ready, newQuestion, message('new-answer')])], activeConversationId: 'conversation' })).toMatchObject({ messageSessionId: null, deliveryStatus: null });
  });
  it('does not attach an older Agent failure to a newer Chat response', () => {
    const select = createConversationMetadataSelector();
    const messages = [{ ...message('old-agent'), requestMode: 'agent' as const, agentResult: { sessionId: 'old-task' } }, { ...message('new-chat'), requestMode: 'chat' as const }];
    expect(select({ conversations: [conversation(messages)], activeConversationId: 'conversation' }).messageSessionId).toBeNull();
  });
  it('does not read context node contents again for token-only updates', () => {
    const readEvidence = vi.fn(() => ({ kind: 'pdf_page' as const, locator: 'paper.pdf#page=1', label: 'Paper, page 1' }));
    const node: AiContextNode = { id: 'node', kind: 'pdf_page', label: 'Page', content: 'quote', priority: 1,
      get evidenceRef() { return readEvidence(); },
    };
    const context = { nodes: [node], prompt: '', evidenceRefs: [], truncated: false };
    const initial = conversation([message('history', context), message('live')]);
    const select = createConversationMetadataSelector();
    const first = select({ conversations: [initial], activeConversationId: initial.id });
    expect(first.contextCount).toBe(1);
    readEvidence.mockClear();
    for (let index = 0; index < 100; index += 1) {
      const updated = conversation([initial.messages[0], { ...initial.messages[1], content: `chunk${index}` }]);
      expect(select({ conversations: [updated], activeConversationId: updated.id })).toBe(first);
    }
    expect(readEvidence).not.toHaveBeenCalled();
  });

  it('updates evidence/context counts, follow-ups and session identity when metadata changes', () => {
    const select = createConversationMetadataSelector();
    const first = conversation([message('reply')]);
    const empty = select({ conversations: [first], activeConversationId: first.id });
    const updated = conversation([{ ...first.messages[0],
      evidenceRefs: [{ kind: 'pdf_page', locator: 'paper.pdf#page=2', label: 'Paper, page 2' }],
      promptContext: { nodes: [{ id: 'p2', kind: 'pdf_page', label: 'Page 2', content: 'source', priority: 1 }], prompt: '', evidenceRefs: [], truncated: false },
      followUpActions: [{ id: 'follow', label: 'Read', kind: 'propose_task' }],
      agentResult: { sessionId: 'task-2', planSource: 'default', warnings: [], planSteps: [] },
    }]);
    expect(select({ conversations: [updated], activeConversationId: updated.id })).toEqual({
      conversationId: 'conversation', contextCount: 1, sourceCount: 1, evidenceMessageCount: 1, workbenchActionCount: 1, messageSessionId: 'task-2', deliveryStatus: null,
    });
    const restored = select({ conversations: [first], activeConversationId: first.id });
    expect(restored).toEqual(empty);
    expect(select({ conversations: [], activeConversationId: null }).conversationId).toBeNull();
  });

  it('counts cited documents without requiring context nodes and deduplicates their pages', () => {
    const select = createConversationMetadataSelector();
    const refs = [1, 2, 2].map(page => ({ kind: 'pdf_page' as const, locator: `paper.pdf#page=${page}`, label: `Page ${page}` }));
    const initial = { ...message('reply'), evidenceRefs: refs };
    const first = select({ conversations: [conversation([initial])], activeConversationId: 'conversation' });
    expect(first).toMatchObject({ contextCount: 0, sourceCount: 1, evidenceMessageCount: 1 });
    expect(select({ conversations: [conversation([{ ...initial, content: 'token update' }])], activeConversationId: 'conversation' })).toBe(first);
    const updated = { ...initial, evidenceRefs: [...refs, { kind: 'file' as const, locator: 'second.md', label: 'Second source' }] };
    expect(select({ conversations: [conversation([updated])], activeConversationId: 'conversation' }).sourceCount).toBe(2);
  });
});
