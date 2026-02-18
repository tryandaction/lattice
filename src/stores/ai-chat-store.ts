import { create } from 'zustand';
import type { AiMessage } from '@/lib/ai/types';
import { getStorageAdapter } from '@/lib/storage-adapter';

const AI_CHAT_STORAGE_KEY = 'lattice-ai-chat';

export interface ChatMessageUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  usage?: ChatMessageUsage;
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
  setMessageUsage: (messageId: string, usage: ChatMessageUsage) => void;
  loadConversations: () => Promise<void>;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(conversations: ChatConversation[]) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const storage = getStorageAdapter();
      const clean = conversations.map((c) => ({
        ...c,
        messages: c.messages.filter((m) => !m.isStreaming),
      }));
      await storage.set(AI_CHAT_STORAGE_KEY, { conversations: clean });
    } catch (err) {
      console.error('Failed to save AI chat conversations:', err);
    }
  }, 1000);
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
    debouncedSave(get().conversations);
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
    debouncedSave(get().conversations);
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
    debouncedSave(get().conversations);
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
    debouncedSave(get().conversations);
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

  setMessageUsage: (messageId, usage) => {
    set((s) => ({
      conversations: s.conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === messageId ? { ...m, usage } : m
        ),
      })),
    }));
    debouncedSave(get().conversations);
  },

  loadConversations: async () => {
    try {
      const storage = getStorageAdapter();
      const saved = await storage.get<{ conversations: ChatConversation[] }>(AI_CHAT_STORAGE_KEY);
      if (saved?.conversations?.length) {
        set({
          conversations: saved.conversations,
          activeConversationId: saved.conversations[0]?.id ?? null,
        });
      }
    } catch (err) {
      console.error('Failed to load AI chat conversations:', err);
    }
  },
}));
