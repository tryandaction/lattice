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
import type { ResearchAgentWorkflowId, NoteTakingSkillConfig } from '@/lib/ai/research-agent-workflows';
import { getStorageAdapter } from '@/lib/storage-adapter';
import { t } from '@/lib/i18n';
import type { AiRequestProgress } from '@/lib/ai/request-lifecycle';
import type { ConversationDocumentContext } from '@/lib/ai/conversation-documents';
import { installChatSessionCheckpointListeners, writeWebSessionCheckpoint } from '@/lib/ai/chat-session-persistence';
import { isLongInputCheckpoint, type LongInputCheckpoint } from '@/lib/ai/long-input';

const AI_CHAT_STORAGE_KEY = 'lattice-ai-chat';
const AI_WORKFLOW_CONFIG_KEY = 'lattice-ai-workflow-config-v1';
const WORKFLOW_CONFIG_VERSION = 1;
const WORKFLOW_IDS = new Set<ResearchAgentWorkflowId>(['markdown-research','reading-note','notebook-analysis','code-change-plan','literature-matrix','knowledge-organization','teaching-explain','paper-reading','pdf-annotation','notebook-from-paper']);
const LANGUAGES = new Set(['zh-CN', 'en-US']);
const NOTE_STYLES = new Set(['academic', 'concise', 'zotero-like', 'cornell', 'custom']);
const QUOTE_POLICIES = new Set(['short-quotes-only', 'paraphrase-first', 'evidence-table']);
let workflowConfigSaveTail: Promise<void> = Promise.resolve();
let workflowConfigRevision = 0;

function normalizeNoteConfigOverrides(value: unknown): Partial<NoteTakingSkillConfig> {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const overrides: Partial<NoteTakingSkillConfig> = {};
  if (typeof raw.annotationLimit === 'number' && Number.isInteger(raw.annotationLimit) && raw.annotationLimit >= 1 && raw.annotationLimit <= 30) overrides.annotationLimit = raw.annotationLimit;
  if (typeof raw.language === 'string' && LANGUAGES.has(raw.language)) overrides.language = raw.language as NoteTakingSkillConfig['language'];
  if (typeof raw.noteStyle === 'string' && NOTE_STYLES.has(raw.noteStyle)) overrides.noteStyle = raw.noteStyle as NoteTakingSkillConfig['noteStyle'];
  if (typeof raw.quotePolicy === 'string' && QUOTE_POLICIES.has(raw.quotePolicy)) overrides.quotePolicy = raw.quotePolicy as NoteTakingSkillConfig['quotePolicy'];
  if (Array.isArray(raw.sections) && raw.sections.every((item) => typeof item === 'string')) {
    const sections = raw.sections.map((item) => item.trim()).filter(Boolean);
    if (sections.length > 0) overrides.sections = sections;
  }
  if (typeof raw.template === 'string' && raw.template.trim()) overrides.template = raw.template;
  return overrides;
}

function normalizeWorkflowConfig(value: unknown): { selectedResearchWorkflowId: ResearchAgentWorkflowId | null; overrides: Partial<NoteTakingSkillConfig> } | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { version?: unknown; selectedResearchWorkflowId?: unknown; overrides?: unknown };
  if (candidate.version !== WORKFLOW_CONFIG_VERSION || !candidate.overrides || typeof candidate.overrides !== 'object') return null;
  const overrides = normalizeNoteConfigOverrides(candidate.overrides);
  const selected = candidate.selectedResearchWorkflowId;
  return { selectedResearchWorkflowId: typeof selected === 'string' && WORKFLOW_IDS.has(selected as ResearchAgentWorkflowId) ? selected as ResearchAgentWorkflowId : null, overrides };
}

function persistWorkflowConfig(selectedResearchWorkflowId: ResearchAgentWorkflowId | null, overrides: Partial<NoteTakingSkillConfig>): void {
  workflowConfigSaveTail = workflowConfigSaveTail.then(() => getStorageAdapter().set(AI_WORKFLOW_CONFIG_KEY, {
    version: WORKFLOW_CONFIG_VERSION,
    selectedResearchWorkflowId,
    overrides,
  })).catch((error) => console.error('Failed to save AI workflow config:', error));
}

export interface ChatMessageUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentResultMetadata {
  sessionId: string;
  inputCheckpoint?: LongInputCheckpoint;
  deliveryStatus?: 'partial' | 'ready_for_review';
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
  editedAt?: number;
  isStreaming?: boolean;
  isInterrupted?: boolean;
  historyStatus?: 'verified' | 'unverified';
  error?: string;
  documentContext?: ConversationDocumentContext;
  /** Original scope of unversioned saved citations; null means no scope was recorded. */
  legacySourceWorkspaceKey?: string | null;
  requestMode?: 'chat' | 'agent';
  usage?: ChatMessageUsage;
  model?: AiModelInfo;
  promptProfile?: { mode: 'chat' | 'agent'; prompt: string };
  evidenceRefs?: EvidenceRef[];
  promptContext?: AiPromptContext;
  followUpActions?: AiFollowUpAction[];
  templateId?: string;
  promptRunId?: string;
  draftSuggestion?: AiDraftSuggestion;
  workspaceDraftId?: string;
  agentResult?: AgentResultMetadata;
  origin?: SelectionAiOrigin;
  /** Local attachment references only; bytes are stored in the attachment database. */
  attachments?: import('@/lib/ai/chat-attachments').ChatAttachmentRef[];
}

export interface AiChatContinuationContext {
  approvalResume?: boolean;
  documentRestart?: boolean;
  sourceSessionId: string;
  documentResume?: boolean;
  compactionId?: string;
  sourceSummary?: string;
}

export interface AiChatComposerDraft {
  text: string;
  mode?: 'chat' | 'agent';
  continuation?: AiChatContinuationContext;
  submit?: boolean;
  attachmentIds?: string[];
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  draft?: AiChatComposerDraft | null;
  workspace?: ChatConversationWorkspace;
  sourcesValidation?: 'required' | 'verified';
  /** Run-local authorization results; never restored without revalidation. */
  validatedSourceMessageIds?: string[];
}

export interface ChatConversationWorkspace {
  workspaceKey: string;
  libraryId?: string | null;
  accountId?: string | null;
  permissionScope?: string | null;
}

interface AiChatState {
  hasHydratedConversations: boolean;
  persistenceError: string | null;
  hydrationError: string | null;
  requestProgress: AiRequestProgress | null;
  conversations: ChatConversation[];
  activeConversationId: string | null;
  isOpen: boolean;
  isGenerating: boolean;
  abortController: AbortController | null;
  activeAssistantMessageId: string | null;
  selectedResearchWorkflowId: ResearchAgentWorkflowId | null;
  noteConfigOverrides: Partial<NoteTakingSkillConfig>;
  composerDraft: AiChatComposerDraft | null;
  composerMode: 'chat' | 'agent';
}

interface AiChatActions {
  setConversationDraft: (draft: string | AiChatComposerDraft | null, conversationId?: string) => string;
  getConversationDraft: (conversationId?: string) => AiChatComposerDraft | null;
  setConversationWorkspace: (workspace: ChatConversationWorkspace, conversationId?: string) => void;
  markConversationSourcesValidated: (workspace: ChatConversationWorkspace, conversationId?: string, messageIds?: string[]) => boolean;
  invalidateConversationSources: (conversationId?: string) => void;
  setRequestProgress: (messageId: string, progress: AiRequestProgress) => void;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setResearchWorkflow: (workflowId: ResearchAgentWorkflowId | null) => void;
  setNoteConfigOverrides: (overrides: Partial<NoteTakingSkillConfig>) => void;
  clearNoteConfigOverride: (key: keyof NoteTakingSkillConfig) => void;
  loadWorkflowConfig: () => Promise<void>;
  setComposerDraft: (draft: string | AiChatComposerDraft | null) => void;
  setComposerMode: (mode: 'chat' | 'agent') => void;
  consumeComposerDraft: () => AiChatComposerDraft | null;
  newConversation: () => string;
  setActiveConversation: (id: string) => void;
  addUserMessage: (content: string, metadata?: Partial<Pick<ChatMessage, 'origin' | 'templateId' | 'promptRunId' | 'attachments'>>) => void;
  startAssistantMessage: (metadata?: Partial<Pick<ChatMessage, 'templateId' | 'promptRunId' | 'requestMode'>>) => string;
  appendToAssistantMessage: (messageId: string, text: string) => void;
  replaceAssistantDraft: (messageId: string, text: string) => void;
  finishAssistantMessage: (messageId: string, verifiedContent?: string) => void;
  updateAssistantMessage: (messageId: string, content: string, expectedContent?: string) => Promise<void>;
  setAssistantError: (messageId: string, error: string, retainedDraft?: string) => void;
  retainInterruptedAssistantDraft: (messageId: string, content: string) => void;
  setAssistantMetadata: (
    messageId: string,
    metadata: Partial<Pick<ChatMessage, 'model' | 'promptProfile' | 'evidenceRefs' | 'promptContext' | 'followUpActions' | 'draftSuggestion' | 'workspaceDraftId' | 'agentResult' | 'origin' | 'templateId' | 'promptRunId' | 'documentContext'>>
  ) => void;
  setGenerating: (generating: boolean, controller?: AbortController | null) => void;
  stopGenerating: () => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  clearAllHistory: () => void;
  getActiveConversation: () => ChatConversation | null;
  getMessagesForApi: (conversationId?: string) => AiMessage[];
  getLongInputResume: (assistantMessageId?: string, conversationId?: string) => { input: string; checkpoint: LongInputCheckpoint; assistantMessageId: string; conversationId: string } | null;
  setMessageUsage: (messageId: string, usage: ChatMessageUsage) => void;
  loadConversations: () => Promise<void>;
  flushConversations: () => Promise<void>;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const CHAT_SCHEMA_VERSION = 3;
interface ChatSessionSnapshot {
  version: number;
  conversations: ChatConversation[];
  activeConversationId: string | null;
  composerMode: 'chat' | 'agent';
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let maxSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSaveSnapshot: ChatSessionSnapshot | null = null;
let saveTail: Promise<void> = Promise.resolve();
let pendingBackgroundSave: { value: ChatSessionSnapshot } | null = null;
let hydrationFlight: Promise<void> | null = null;
let hydratedBaseSession: ChatSessionSnapshot | null = null;
let clearHistoryRevision = 0;
let webCheckpointRevision = 0;
let checkpointListenersInstalled = false;
const deletedConversationIds = new Set<string>();

function normalizeDraft(value: unknown): AiChatComposerDraft | null {
  if (!value || typeof value !== 'object' || typeof (value as AiChatComposerDraft).text !== 'string') return null;
  const draft = value as AiChatComposerDraft;
  const continuation = draft.continuation && typeof draft.continuation.sourceSessionId === 'string'
    ? { ...draft.continuation } : undefined;
  return { text: draft.text, ...(draft.mode === 'chat' || draft.mode === 'agent' ? { mode: draft.mode } : {}), ...(continuation ? { continuation } : {}),
    ...(Array.isArray(draft.attachmentIds) ? { attachmentIds: draft.attachmentIds.filter((id): id is string => typeof id === 'string').slice(0, 10) } : {}) };
}

function normalizeWorkspace(value: unknown): ChatConversationWorkspace | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.workspaceKey !== 'string') return undefined;
  const workspace: ChatConversationWorkspace = { workspaceKey: raw.workspaceKey };
  for (const key of ['libraryId', 'accountId', 'permissionScope'] as const) {
    if (typeof raw[key] === 'string' || raw[key] === null) workspace[key] = raw[key] as string | null;
  }
  return workspace;
}

function sameWorkspace(a?: ChatConversationWorkspace, b?: ChatConversationWorkspace): boolean {
  return Boolean(a && b && a.workspaceKey === b.workspaceKey && (a.libraryId ?? null) === (b.libraryId ?? null)
    && (a.accountId ?? null) === (b.accountId ?? null) && (a.permissionScope ?? null) === (b.permissionScope ?? null));
}

function hasMessageSources(message: ChatMessage): boolean {
  return Boolean(message.documentContext?.paths?.length || message.evidenceRefs?.length || message.promptContext?.evidenceRefs?.length);
}

function messageSourceIdentity(message: ChatMessage): string {
  return JSON.stringify({ documentContext: message.documentContext, evidenceRefs: message.evidenceRefs, promptEvidence: message.promptContext?.evidenceRefs });
}

function captureSession(): ChatSessionSnapshot {
  const state = useAiChatStore.getState();
  return { version: CHAT_SCHEMA_VERSION, conversations: state.conversations, activeConversationId: state.activeConversationId, composerMode: state.composerMode };
}

function mergeHydratedBoundary(boundary: ChatSessionSnapshot): ChatSessionSnapshot {
  if (!hydratedBaseSession) return boundary;
  const ids = new Set(boundary.conversations.map(conversation => conversation.id));
  return { ...boundary, conversations: [...boundary.conversations, ...hydratedBaseSession.conversations.filter(conversation => !ids.has(conversation.id))],
    activeConversationId: boundary.activeConversationId ?? hydratedBaseSession.activeConversationId,
    composerMode: boundary.conversations.length ? boundary.composerMode : hydratedBaseSession.composerMode };
}

function installSessionCheckpoints(): void {
  if (checkpointListenersInstalled || typeof window === 'undefined') return;
  checkpointListenersInstalled = true;
  installChatSessionCheckpointListeners(
    () => useAiChatStore.getState().flushConversations(),
    () => {
      const state = useAiChatStore.getState();
      // A pending hydration may contain older history we have not read yet.
      if (!state.hasHydratedConversations || state.hydrationError) return;
      const snapshot = captureSession();
      if (writeWebSessionCheckpoint(AI_CHAT_STORAGE_KEY, { ...snapshot, conversations: normalizePersistedConversations(snapshot) })) webCheckpointRevision += 1;
    },
    error => useAiChatStore.setState({ persistenceError: error instanceof Error ? error.message : String(error) }),
  );
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ChatMessage>;
  if ((candidate.role !== "user" && candidate.role !== "assistant") || typeof candidate.content !== "string") {
    return null;
  }
  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : generateId();
  const timestampValue = typeof candidate.timestamp === "number" || typeof candidate.timestamp === "string"
    ? Number(candidate.timestamp)
    : Number.NaN;
  const timestamp = Number.isFinite(timestampValue)
    ? timestampValue
    : Date.now();
  const interrupted = candidate.role === 'assistant' && (candidate.isStreaming === true || candidate.isInterrupted === true);
  const inputCheckpoint = candidate.agentResult?.inputCheckpoint;
  return {
    ...candidate,
    id,
    role: candidate.role,
    content: interrupted && !candidate.content.trim() ? t('chat.generationStopped') : candidate.content,
    timestamp,
    editedAt: typeof candidate.editedAt === 'number' && Number.isFinite(candidate.editedAt) ? candidate.editedAt : undefined,
    isStreaming: false,
    ...(interrupted ? { isInterrupted: true } : {}),
    ...(interrupted && isLongInputCheckpoint(inputCheckpoint) && inputCheckpoint.status === 'processing'
      ? { agentResult: { ...candidate.agentResult!, inputCheckpoint: { ...inputCheckpoint, status: 'interrupted' } } } : {}),
  } as ChatMessage;
}

function normalizeConversation(value: unknown, keepEmpty = false): ChatConversation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ChatConversation>;
  if (typeof candidate.id !== "string" || !candidate.id.trim() || !Array.isArray(candidate.messages)) return null;
  const messages = candidate.messages.map(normalizeMessage).filter((message): message is ChatMessage => Boolean(message));
  const draft = normalizeDraft(candidate.draft);
  if (messages.length === 0 && !draft && !candidate.workspace && !keepEmpty) return null;
  const firstUser = messages.find((message) => message.role === "user");
  const title = typeof candidate.title === "string" && candidate.title.trim()
    ? candidate.title.trim()
    : firstUser?.content.slice(0, 50) || "New Chat";
  return {
    id: candidate.id,
    title,
    messages,
    createdAt: (typeof candidate.createdAt === "number" || typeof candidate.createdAt === "string") && Number.isFinite(Number(candidate.createdAt))
      ? Number(candidate.createdAt)
      : messages[0]?.timestamp ?? Date.now(),
    ...(draft ? { draft } : {}),
    ...(normalizeWorkspace(candidate.workspace) ? { workspace: normalizeWorkspace(candidate.workspace) } : {}),
    ...(candidate.sourcesValidation === 'verified' || candidate.sourcesValidation === 'required' ? { sourcesValidation: candidate.sourcesValidation } : {}),
  };
}

export function normalizePersistedConversations(value: unknown): ChatConversation[] {
  const keepEmpty = Boolean(value && typeof value === 'object' && (value as { version?: unknown }).version === CHAT_SCHEMA_VERSION);
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { conversations?: unknown }).conversations)
      ? (value as { conversations: unknown[] }).conversations
      : [];
  return raw
    .map(conversation => normalizeConversation(conversation, keepEmpty))
    .filter((conversation): conversation is ChatConversation => Boolean(conversation));
}

function saveConversations(value: ChatSessionSnapshot, strict = false): Promise<void> {
  if (!strict && pendingBackgroundSave) {
    pendingBackgroundSave.value = value;
    return saveTail;
  }
  const snapshot = { value };
  const checkpointAtQueue = webCheckpointRevision;
  // A strict flush is an ordering boundary. Later background updates must not
  // change the snapshot queued before that flush or overwrite it out of order.
  pendingBackgroundSave = strict ? null : snapshot;
  const saving = saveTail.then(async () => {
    if (pendingBackgroundSave === snapshot) pendingBackgroundSave = null;
    if (useAiChatStore.getState().hydrationError) throw new Error(useAiChatStore.getState().hydrationError!);
    // A synchronous exit checkpoint already contains newer state. Queued Web
    // writes must not overwrite it while the page is being torn down.
    if (checkpointAtQueue < webCheckpointRevision) return;
    const storage = getStorageAdapter();
    // Normalize only the snapshot that is actually written, not every state
    // superseded while a slow storage/IPC operation holds up the queue.
    const saved = { ...snapshot.value, conversations: normalizePersistedConversations(snapshot.value) };
    // Even background checkpoints must report adapter failures instead of using
    // adapters whose best-effort writes swallow quota or IPC errors.
    if (storage.setStrict) await storage.setStrict(AI_CHAT_STORAGE_KEY, saved);
    else await storage.set(AI_CHAT_STORAGE_KEY, saved);
    useAiChatStore.setState({ persistenceError: null });
  });
  // Keep the queue usable after a failed critical write, while returning that
  // write's original rejection to its caller instead of reporting durability.
  saveTail = saving.catch((error) => {
    useAiChatStore.setState({ persistenceError: error instanceof Error ? error.message : String(error) });
    if (!strict) console.error('Failed to save AI chat conversations:', error);
  });
  return strict ? saving : saveTail;
}

function debouncedSave(_conversations: ChatConversation[], resetTimer = true) {
  const state = useAiChatStore.getState();
  // Toolbar/external draft actions can precede AppLayout's startup effect.
  // Read and merge existing history before their first checkpoint can replace it.
  if (!state.hasHydratedConversations && !hydrationFlight && !state.hydrationError) void state.loadConversations();
  pendingSaveSnapshot = captureSession();
  if (saveTimer && resetTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (saveTimer) return;
  const persistPending = () => {
    if (saveTimer) clearTimeout(saveTimer);
    if (maxSaveTimer) clearTimeout(maxSaveTimer);
    saveTimer = null;
    maxSaveTimer = null;
    const snapshot = pendingSaveSnapshot;
    pendingSaveSnapshot = null;
    if (snapshot) {
      if (hydrationFlight) void hydrationFlight.then(() => saveConversations(mergeHydratedBoundary(snapshot)));
      else void saveConversations(snapshot);
    }
  };
  saveTimer = setTimeout(persistPending, resetTimer ? 1000 : 2000);
  if (!maxSaveTimer) maxSaveTimer = setTimeout(persistPending, 2000);
}

function updateMessage(
  conversations: ChatConversation[],
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): ChatConversation[] {
  const conversationIndex = conversations.findIndex((conversation) =>
    conversation.messages.some((message) => message.id === messageId),
  );
  if (conversationIndex < 0) return conversations;

  const conversation = conversations[conversationIndex];
  const messageIndex = conversation.messages.findIndex((message) => message.id === messageId);
  if (messageIndex < 0) return conversations;

  const messages = conversation.messages.slice();
  messages[messageIndex] = updater(messages[messageIndex]);
  const next = conversations.slice();
  next[conversationIndex] = { ...conversation, messages };
  return next;
}

export const useAiChatStore = create<AiChatState & AiChatActions>((set, get) => ({
  hasHydratedConversations: false,
  persistenceError: null,
  hydrationError: null,
  requestProgress: null,
  setRequestProgress: (messageId, progress) => {
    const state = get();
    if (!state.isGenerating || state.activeAssistantMessageId !== messageId || state.abortController?.signal.aborted) return;
    set({ requestProgress: progress });
  },
  conversations: [],
  activeConversationId: null,
  isOpen: false,
  isGenerating: false,
  abortController: null,
  activeAssistantMessageId: null,
  selectedResearchWorkflowId: null,
  noteConfigOverrides: {},
  composerDraft: null,
  composerMode: 'chat',

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (open) => set({ isOpen: open }),
  setResearchWorkflow: (workflowId) => {
    workflowConfigRevision += 1;
    const normalizedWorkflowId = workflowId && WORKFLOW_IDS.has(workflowId) ? workflowId : null;
    set({ selectedResearchWorkflowId: normalizedWorkflowId });
    persistWorkflowConfig(normalizedWorkflowId, get().noteConfigOverrides);
  },
  setNoteConfigOverrides: (overrides) => {
    workflowConfigRevision += 1;
    const normalized = normalizeNoteConfigOverrides(overrides);
    set((state) => ({ noteConfigOverrides: { ...state.noteConfigOverrides, ...normalized } }));
    persistWorkflowConfig(get().selectedResearchWorkflowId, get().noteConfigOverrides);
  },
  clearNoteConfigOverride: (key) => {
    workflowConfigRevision += 1;
    const next = { ...get().noteConfigOverrides };
    delete next[key];
    set({ noteConfigOverrides: next });
    persistWorkflowConfig(get().selectedResearchWorkflowId, next);
  },
  loadWorkflowConfig: async () => {
    const revisionAtStart = workflowConfigRevision;
    const selectedAtStart = get().selectedResearchWorkflowId;
    const overridesAtStart = get().noteConfigOverrides;
    try {
      const config = normalizeWorkflowConfig(await getStorageAdapter().get<unknown>(AI_WORKFLOW_CONFIG_KEY));
      if (!config || workflowConfigRevision !== revisionAtStart || get().selectedResearchWorkflowId !== selectedAtStart || get().noteConfigOverrides !== overridesAtStart) return;
      // A remembered strategy must not silently override a new natural task.
      // Keep writing preferences; manual workflow choices apply to one request.
      set({ selectedResearchWorkflowId: null, noteConfigOverrides: config.overrides });
    } catch (error) {
      console.error('Failed to load AI workflow config:', error);
    }
  },
  setConversationDraft: (draft, conversationId) => {
    const normalized = normalizeDraft(typeof draft === 'string' ? { text: draft } : draft);
    const id = conversationId ?? get().activeConversationId ?? get().newConversation();
    if (!get().conversations.some(conversation => conversation.id === id)) return id;
    set(state => ({ conversations: state.conversations.map(conversation => conversation.id === id ? { ...conversation, draft: normalized } : conversation) }));
    debouncedSave(get().conversations);
    return id;
  },
  getConversationDraft: (conversationId) => get().conversations.find(conversation => conversation.id === (conversationId ?? get().activeConversationId))?.draft ?? null,
  setConversationWorkspace: (workspace, conversationId) => {
    const normalized = normalizeWorkspace(workspace);
    const id = conversationId ?? get().activeConversationId;
    if (!normalized || !id) return;
    set(state => ({ conversations: state.conversations.map(conversation => conversation.id !== id || sameWorkspace(conversation.workspace, normalized)
      ? conversation : { ...conversation, workspace: normalized, sourcesValidation: 'required', validatedSourceMessageIds: [],
        messages: conversation.messages.map(message => !message.documentContext?.paths.length && hasMessageSources(message) && message.legacySourceWorkspaceKey === undefined
          ? { ...message, legacySourceWorkspaceKey: conversation.workspace?.workspaceKey ?? null } : message) }) }));
    debouncedSave(get().conversations);
  },
  markConversationSourcesValidated: (workspace, conversationId, messageIds) => {
    const id = conversationId ?? get().activeConversationId;
    const conversation = get().conversations.find(item => item.id === id);
    if (!conversation || !sameWorkspace(conversation.workspace, normalizeWorkspace(workspace))) return false;
    const sourceIds = conversation.messages.filter(hasMessageSources).map(message => message.id);
    const validatedSourceMessageIds = [...new Set((messageIds ?? sourceIds).filter(messageId => sourceIds.includes(messageId)))];
    const sourcesValidation = sourceIds.every(messageId => validatedSourceMessageIds.includes(messageId)) ? 'verified' as const : 'required' as const;
    set(state => ({ conversations: state.conversations.map(item => item.id === id ? { ...item, sourcesValidation, validatedSourceMessageIds } : item) }));
    debouncedSave(get().conversations);
    return true;
  },
  invalidateConversationSources: (conversationId) => {
    const id = conversationId ?? get().activeConversationId;
    set(state => ({ conversations: state.conversations.map(item => item.id === id ? { ...item, sourcesValidation: 'required', validatedSourceMessageIds: [] } : item) }));
    debouncedSave(get().conversations);
  },
  setComposerDraft: (draft) => {
    if (draft !== null) get().setConversationDraft(draft);
    set({ composerDraft: typeof draft === 'string' ? { text: draft } : draft });
  },
  setComposerMode: (mode) => {
    set({ composerMode: mode });
    debouncedSave(get().conversations);
  },
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
      composerDraft: null,
    }));
    debouncedSave(get().conversations);
    return id;
  },

  setActiveConversation: (id) => {
    if (!get().conversations.some(conversation => conversation.id === id)) return;
    set({ activeConversationId: id, composerDraft: null });
    debouncedSave(get().conversations);
  },

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
      historyStatus: 'unverified',
      ...metadata,
    };
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, msg] } : c
      ),
      activeAssistantMessageId: msg.id,
    }));
    debouncedSave(get().conversations, false);
    return msg.id;
  },

  appendToAssistantMessage: (messageId, text) => {
    set((s) => ({
      conversations: updateMessage(s.conversations, messageId, (message) => !message.isStreaming || message.isInterrupted || message.error ? message : ({
        ...message,
        content: message.content + text,
      })),
    }));
    debouncedSave(get().conversations, false);
  },

  replaceAssistantDraft: (messageId, text) => {
    set((s) => ({
      conversations: updateMessage(s.conversations, messageId, (message) => !message.isStreaming || message.isInterrupted || message.error ? message : ({
        ...message,
        content: text,
      })),
    }));
    debouncedSave(get().conversations, false);
  },

  finishAssistantMessage: (messageId, verifiedContent) => {
    const isCurrentRequest = get().activeAssistantMessageId === messageId;
    const interrupted = isCurrentRequest && Boolean(get().abortController?.signal.aborted);
    set((s) => ({
      conversations: updateMessage(s.conversations, messageId, (message) => ({
        ...message,
        ...(verifiedContent !== undefined && !message.isInterrupted && !interrupted && !message.error ? { content: verifiedContent } : {}),
        ...(interrupted ? { isInterrupted: true } : {}),
        ...((message.isInterrupted || interrupted) && !message.content.trim() ? { content: t('chat.generationStopped') } : {}),
        isStreaming: false,
        historyStatus: message.isInterrupted || interrupted || message.error || message.agentResult?.deliveryStatus === 'partial' ? 'unverified' : 'verified',
      })),
      ...(isCurrentRequest ? {
        requestProgress: null,
        isGenerating: false,
        abortController: null,
        activeAssistantMessageId: null,
      } : {}),
    }));
    debouncedSave(get().conversations);
  },

  retainInterruptedAssistantDraft: (messageId, content) => {
    if (!content.trim()) return;
    const cancelled = get().activeAssistantMessageId === messageId && Boolean(get().abortController?.signal.aborted);
    set(state => ({ conversations: updateMessage(state.conversations, messageId, message => {
      if (message.role !== 'assistant' || message.editedAt || (!message.isInterrupted && !cancelled)) return message;
      const existing = message.content === t('chat.generationStopped') ? '' : message.content;
      if (!content.startsWith(existing) || content.length <= existing.length) return message;
      return { ...message, content, isInterrupted: true, isStreaming: false };
    }) }));
    debouncedSave(get().conversations);
  },

  setAssistantError: (messageId, error, retainedDraft) => {
    const isCurrentRequest = get().activeAssistantMessageId === messageId;
    set((s) => ({
      conversations: updateMessage(s.conversations, messageId, (message) => message.isInterrupted ? message : ({
        ...message,
        content: retainedDraft?.trim() ? retainedDraft : message.content,
        error,
        isStreaming: false,
      })),
      ...(isCurrentRequest ? {
        requestProgress: null,
        isGenerating: false,
        abortController: null,
        activeAssistantMessageId: null,
      } : {}),
    }));
    debouncedSave(get().conversations);
  },

  updateAssistantMessage: async (messageId, content, expectedContent) => {
    const previous = get().conversations
      .find((conversation) => conversation.messages.some((message) => message.id === messageId))
      ?.messages.find((message) => message.id === messageId);
    if (!previous || previous.role !== 'assistant' || previous.isStreaming) {
      throw new Error('Only completed assistant responses can be edited.');
    }
    if (!content.trim()) throw new Error('Assistant response cannot be empty.');
    if (expectedContent !== undefined && previous.content !== expectedContent) {
      throw new Error('This response changed while you were editing. Reopen the editor to use its latest content.');
    }
    const editedAt = Date.now();
    set((state) => ({
      conversations: updateMessage(state.conversations, messageId, (message) => ({
        ...message, content, editedAt,
      })),
    }));
    try {
      await get().flushConversations();
    } catch (error) {
      // Keep the user's draft in the editor, and restore only this edit without
      // reverting concurrent conversation additions or evidence metadata updates.
      set((state) => ({
        conversations: updateMessage(state.conversations, messageId, (message) =>
          message.content === content && message.editedAt === editedAt
            ? { ...message, content: previous.content, editedAt: previous.editedAt }
            : message,
        ),
      }));
      debouncedSave(get().conversations);
      throw error;
    }
  },

  setAssistantMetadata: (messageId, metadata) => {
    set((state) => {
      let sourcesChanged = false;
      const conversations = updateMessage(state.conversations, messageId, (message) => {
        const updated = { ...message, ...metadata };
        sourcesChanged = messageSourceIdentity(message) !== messageSourceIdentity(updated);
        return updated;
      });
      return { conversations: sourcesChanged ? conversations.map(conversation => conversation.messages.some(message => message.id === messageId)
        ? { ...conversation, sourcesValidation: 'required', validatedSourceMessageIds: (conversation.validatedSourceMessageIds ?? []).filter(id => id !== messageId) }
        : conversation) : conversations };
    });
    debouncedSave(get().conversations);
  },

  setGenerating: (generating, controller) =>
    set({
      requestProgress: generating ? { phase: 'preparing', startedAt: Date.now(), lastActivityAt: Date.now(), attempt: 1 } : null,
      isGenerating: generating,
      abortController: controller ?? null,
      ...(generating ? {} : { activeAssistantMessageId: null }),
    }),

  stopGenerating: () => {
    const { abortController, activeAssistantMessageId } = get();
    if (abortController) abortController.abort();
    set((s) => ({
      requestProgress: null,
      conversations: activeAssistantMessageId
        ? updateMessage(s.conversations, activeAssistantMessageId, (message) => ({ ...message, content: message.content.trim() ? message.content : t('chat.generationStopped'), isStreaming: false, isInterrupted: true }))
        : s.conversations,
      isGenerating: false,
      abortController: null,
      activeAssistantMessageId: null,
    }));
    debouncedSave(get().conversations);
  },

  deleteConversation: (id) => {
    deletedConversationIds.add(id);
    set((s) => {
      const filtered = s.conversations.filter((c) => c.id !== id);
      return {
        conversations: filtered,
        activeConversationId: s.activeConversationId === id
          ? (filtered[0]?.id ?? null)
          : s.activeConversationId,
        ...(s.activeConversationId === id ? { composerDraft: null } : {}),
      };
    });
    debouncedSave(get().conversations);
  },

  renameConversation: (id, title) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return;
    set((s) => ({
      conversations: s.conversations.map((conversation) => conversation.id === id
        ? { ...conversation, title: normalizedTitle }
        : conversation),
    }));
    debouncedSave(get().conversations);
  },

  clearAllHistory: () => {
    clearHistoryRevision += 1;
    const controller = get().abortController;
    if (controller) controller.abort();
    set({
      conversations: [],
      hasHydratedConversations: true,
      hydrationError: null,
      persistenceError: null,
      activeConversationId: null,
      isGenerating: false,
      abortController: null,
      activeAssistantMessageId: null,
      composerDraft: null,
    });
    debouncedSave([]);
  },

  getActiveConversation: () => {
    const { conversations, activeConversationId } = get();
    return conversations.find((c) => c.id === activeConversationId) ?? null;
  },

  getMessagesForApi: (conversationId) => {
    const conv = get().conversations.find(conversation => conversation.id === (conversationId ?? get().activeConversationId));
    if (!conv) return [];
    const history: AiMessage[] = [];
    let turnStart = 0;
    let invalidTurn = false;
    for (const message of conv.messages) {
      if (message.role === 'user') { turnStart = history.length; invalidTurn = false; }
      const failed = message.role === 'assistant' && (message.error || (!message.editedAt && message.content.startsWith('Error: ')));
      const unverified = message.role === 'assistant' && (message.isStreaming || message.historyStatus === 'unverified' || message.agentResult?.deliveryStatus === 'partial');
      const unvalidatedSources = hasMessageSources(message) && ((conv.sourcesValidation !== 'verified' && !conv.validatedSourceMessageIds?.includes(message.id))
        || (message.documentContext && message.documentContext.workspaceKey !== conv.workspace?.workspaceKey));
      if (failed || message.isInterrupted || unverified || unvalidatedSources) {
        // Keep the full turn in the UI, but do not turn failed requests into
        // pending instructions by merging consecutive user messages at the API.
        history.splice(turnStart);
        invalidTurn = true;
        continue;
      }
      if (!invalidTurn && !message.isStreaming) history.push({ role: message.role, content: message.content });
    }
    return history;
  },

  getLongInputResume: (assistantMessageId, conversationId) => {
    const conversation = get().conversations.find(item => item.id === (conversationId ?? get().activeConversationId));
    if (!conversation) return null;
    const index = assistantMessageId ? conversation.messages.findIndex(message => message.id === assistantMessageId)
      : conversation.messages.findLastIndex(message => Boolean(message.agentResult?.inputCheckpoint));
    const assistant = conversation.messages[index];
    const checkpoint = assistant?.agentResult?.inputCheckpoint;
    if (assistant?.role !== 'assistant' || !isLongInputCheckpoint(checkpoint)) return null;
    const user = conversation.messages.slice(0, index).findLast(message => message.role === 'user');
    if (!user || user.content.length !== checkpoint.input.length) return null;
    return { input: user.content, checkpoint, assistantMessageId: assistant.id, conversationId: conversation.id };
  },

  setMessageUsage: (messageId, usage) => {
    set((s) => ({
      conversations: updateMessage(s.conversations, messageId, (message) => ({
        ...message,
        usage,
      })),
    }));
    debouncedSave(get().conversations);
  },

  flushConversations: async () => {
    const boundary = captureSession();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (maxSaveTimer) { clearTimeout(maxSaveTimer); maxSaveTimer = null; }
    pendingSaveSnapshot = null;
    let snapshot = boundary;
    const state = get();
    if (!state.hasHydratedConversations && !hydrationFlight && !state.hydrationError) void state.loadConversations();
    if (hydrationFlight) {
      await hydrationFlight;
      snapshot = mergeHydratedBoundary(boundary);
    }
    await saveConversations(snapshot, true);
  },

  loadConversations: () => {
    installSessionCheckpoints();
    if (hydrationFlight) return hydrationFlight;
    if (get().hasHydratedConversations) return Promise.resolve();
    const activeAtStart = get().activeConversationId;
    const clearRevisionAtStart = clearHistoryRevision;
    const modeAtStart = get().composerMode;
    const loading = (async () => { try {
      const storage = getStorageAdapter();
      const saved = storage.getStrict ? await storage.getStrict<unknown>(AI_CHAT_STORAGE_KEY) : await storage.get<unknown>(AI_CHAT_STORAGE_KEY);
      const envelope = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Partial<ChatSessionSnapshot> : null;
      if (typeof envelope?.version === 'number' && envelope.version > CHAT_SCHEMA_VERSION) throw new Error('This chat history was saved by a newer Lattice version.');
      const persisted = clearHistoryRevision !== clearRevisionAtStart ? [] : normalizePersistedConversations(saved)
        .filter(conversation => !deletedConversationIds.has(conversation.id))
        .map(conversation => ({ ...conversation, ...(conversation.messages.some(hasMessageSources) ? { sourcesValidation: 'required' as const } : {}) }));
      hydratedBaseSession = { version: CHAT_SCHEMA_VERSION, conversations: persisted,
        activeConversationId: persisted.some(conversation => conversation.id === envelope?.activeConversationId) ? envelope!.activeConversationId! : persisted[0]?.id ?? null,
        composerMode: envelope?.composerMode === 'agent' ? 'agent' : 'chat' };
      const current = get();
      const localIds = new Set(current.conversations.map(conversation => conversation.id));
      const conversations = [...current.conversations, ...persisted.filter(conversation => !localIds.has(conversation.id))];
      const preferredId = current.activeConversationId !== activeAtStart || current.activeConversationId !== null
        ? current.activeConversationId : envelope?.activeConversationId;
      const activeConversationId = conversations.some(conversation => conversation.id === preferredId) ? preferredId! : conversations[0]?.id ?? null;
      set({ conversations, activeConversationId, hasHydratedConversations: true, persistenceError: null, hydrationError: null,
        ...(current.composerMode === modeAtStart && (envelope?.composerMode === 'agent' || envelope?.composerMode === 'chat') ? { composerMode: envelope.composerMode } : {}) });
      if (pendingSaveSnapshot) pendingSaveSnapshot = captureSession();
    } catch (err) {
      set({ persistenceError: err instanceof Error ? err.message : String(err), hydrationError: err instanceof Error ? err.message : String(err) });
      console.error('Failed to load AI chat conversations:', err);
    } })();
    hydrationFlight = loading.finally(() => { hydrationFlight = null; });
    return hydrationFlight;
  },
}));
