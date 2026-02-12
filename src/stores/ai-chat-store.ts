import { create } from 'zustand';
import type { AiMessage } from '@/lib/ai/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
}

interface AiChatState {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  isOpen: boolean;
  isGenerating: boolean;
  abortController: AbortController | null;
}

interface AiChatActions {
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  newConversation: () => string;
  setActiveConversation: (id: string) => void;
  addUserMessage: (content: string) => void;
  startAssistantMessage: () => string;
  appendToAssistantMessage: (messageId: string, text: string) => void;
  finishAssistantMessage: (messageId: string) => void;
  setAssistantError: (messageId: string, error: string) => void;
  setGenerating: (generating: boolean, controller?: AbortController | null) => void;
  stopGenerating: () => void;
  deleteConversation: (id: string) => void;
  getActiveConversation: () => ChatConversation | null;
  getMessagesForApi: () => AiMessage[];
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useAiChatStore = create<AiChatState & AiChatActions>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  isOpen: false,
  isGenerating: false,
  abortController: null,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (open) => set({ isOpen: open }),

  newConversation: () => {
    const id = generateId();
    const conv: ChatConversation = {
      id,
      title: 'New Chat',
      messages: [],
      createdAt: Date.now(),
    };
    set((s) => ({
      conversations: [conv, ...s.conversations],
      activeConversationId: id,
    }));
    return id;
  },

  setActiveConversation: (id) => set({ activeConversationId: id }),

  addUserMessage: (content) => {
    const state = get();
    let convId = state.activeConversationId;
    if (!convId) {
      convId = get().newConversation();
    }
    const msg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== convId) return c;
        const updated = { ...c, messages: [...c.messages, msg] };
        // Auto-title from first message
        if (c.messages.length === 0) {
          updated.title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
        }
        return updated;
      }),
    }));
  },

  startAssistantMessage: () => {
    const convId = get().activeConversationId;
    const msg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    };
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, msg] } : c
      ),
    }));
    return msg.id;
  },

  appendToAssistantMessage: (messageId, text) => {
    set((s) => ({
      conversations: s.conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === messageId ? { ...m, content: m.content + text } : m
        ),
      })),
    }));
  },

  finishAssistantMessage: (messageId) => {
    set((s) => ({
      conversations: s.conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === messageId ? { ...m, isStreaming: false } : m
        ),
      })),
      isGenerating: false,
      abortController: null,
    }));
  },

  setAssistantError: (messageId, error) => {
    set((s) => ({
      conversations: s.conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === messageId ? { ...m, content: `Error: ${error}`, isStreaming: false } : m
        ),
      })),
      isGenerating: false,
      abortController: null,
    }));
  },

  setGenerating: (generating, controller) =>
    set({ isGenerating: generating, abortController: controller ?? null }),

  stopGenerating: () => {
    const { abortController } = get();
    if (abortController) abortController.abort();
    set({ isGenerating: false, abortController: null });
  },

  deleteConversation: (id) => {
    set((s) => {
      const filtered = s.conversations.filter((c) => c.id !== id);
      return {
        conversations: filtered,
        activeConversationId: s.activeConversationId === id
          ? (filtered[0]?.id ?? null)
          : s.activeConversationId,
      };
    });
  },

  getActiveConversation: () => {
    const { conversations, activeConversationId } = get();
    return conversations.find((c) => c.id === activeConversationId) ?? null;
  },

  getMessagesForApi: () => {
    const conv = get().getActiveConversation();
    if (!conv) return [];
    return conv.messages
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }));
  },
}));
