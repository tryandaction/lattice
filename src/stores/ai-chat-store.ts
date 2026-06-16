import { create } from 'zustand';
import type {
  AiDraftSuggestion,
  AiFollowUpAction,
  AiMessage,
  AiModelInfo,
  AiPromptContext,
  EvidenceRef,
  SelectionAiOrigin,
} from '@/lib/ai/types';
import type { ResearchAgentWorkflowId } from '@/lib/ai/research-agent-workflows';
import { getStorageAdapter } from '@/lib/storage-adapter';

const AI_CHAT_STORAGE_KEY = 'lattice-ai-chat';

export interface ChatMessageUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentResultMetadata {
  sessionId: string;
  workflowLabel?: string;
  workflowInferred?: boolean;
  planSource?: string;
  approvalStatus?: string;
  recoverySummary?: string;
  contextSummary?: {
    omittedCount: number;
    omittedTokens: number;
    preview?: string;
    autoSummary?: string;
    modelSummary?: string;
    modelSummaryStatus?: string;
    modelSummaryQuality?: string;
    recoveryPlan?: string;
  };
  memorySummary?: {
    pendingSuggestionCount: number;
    pendingSuggestionTitles?: string[];
  };
  continuation?: AiChatContinuationContext;
  warnings?: string[];
  planSteps?: Array<{
    title: string;
    status: string;
    toolName?: string;
  }>;
  toolObservations?: Array<{
    stepId: string;
    toolName: string;
    status: string;
    preview: string;
    evidenceCount?: number;
    resultStatus?: string;
    resultSummary?: string;
    resultMetricsPreview?: string;
    resultArtifactsPreview?: string;
    resultDiagnosticsPreview?: string;
  }>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  usage?: ChatMessageUsage;
  model?: AiModelInfo;
  evidenceRefs?: EvidenceRef[];
  promptContext?: AiPromptContext;
  followUpActions?: AiFollowUpAction[];
  templateId?: string;
  promptRunId?: string;
  draftSuggestion?: AiDraftSuggestion;
  agentResult?: AgentResultMetadata;
  origin?: SelectionAiOrigin;
}

export interface AiChatContinuationContext {
  sourceSessionId: string;
  compactionId?: string;
  sourceSummary?: string;
}

export interface AiChatComposerDraft {
  text: string;
  mode?: 'chat' | 'agent';
  continuation?: AiChatContinuationContext;
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
  selectedResearchWorkflowId: ResearchAgentWorkflowId | null;
  composerDraft: AiChatComposerDraft | null;
}

interface AiChatActions {
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setResearchWorkflow: (workflowId: ResearchAgentWorkflowId | null) => void;
  setComposerDraft: (draft: string | AiChatComposerDraft | null) => void;
  consumeComposerDraft: () => AiChatComposerDraft | null;
  newConversation: () => string;
  setActiveConversation: (id: string) => void;
  addUserMessage: (content: string, metadata?: Partial<Pick<ChatMessage, 'origin' | 'templateId' | 'promptRunId'>>) => void;
  startAssistantMessage: (metadata?: Partial<Pick<ChatMessage, 'templateId' | 'promptRunId'>>) => string;
  appendToAssistantMessage: (messageId: string, text: string) => void;
  finishAssistantMessage: (messageId: string) => void;
  setAssistantError: (messageId: string, error: string) => void;
  setAssistantMetadata: (
    messageId: string,
    metadata: Partial<Pick<ChatMessage, 'model' | 'evidenceRefs' | 'promptContext' | 'followUpActions' | 'draftSuggestion' | 'agentResult' | 'origin' | 'templateId' | 'promptRunId'>>
  ) => void;
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
  selectedResearchWorkflowId: null,
  composerDraft: null,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (open) => set({ isOpen: open }),
  setResearchWorkflow: (workflowId) => set({ selectedResearchWorkflowId: workflowId }),
  setComposerDraft: (draft) => set({
    composerDraft: typeof draft === 'string' ? { text: draft } : draft,
  }),
  consumeComposerDraft: () => {
    const draft = get().composerDraft;
    if (draft !== null) {
      set({ composerDraft: null });
    }
    return draft;
  },

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

  addUserMessage: (content, metadata) => {
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
      ...metadata,
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

  startAssistantMessage: (metadata) => {
    const convId = get().activeConversationId;
    const msg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      ...metadata,
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

  setAssistantMetadata: (messageId, metadata) => {
    set((s) => ({
      conversations: s.conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === messageId ? { ...m, ...metadata } : m
        ),
      })),
    }));
    debouncedSave(get().conversations);
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
