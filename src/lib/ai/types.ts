// ============================================================================
// Context Types (preserved from v0.3)
// ============================================================================

export type AiContextItemType = 'system' | 'file' | 'annotations' | 'selection';

export interface AiContextItem {
  type: AiContextItemType;
  title: string;
  content: string;
  metadata?: Record<string, string>;
}

export interface AiContext {
  items: AiContextItem[];
  toPrompt: () => string;
  toMessages: () => AiMessage[];
}

// ============================================================================
// Provider Types
// ============================================================================

export type AiProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'openrouter'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'siliconflow'
  | 'azure-openai'
  | 'custom';

export type AiProtocol =
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'gemini-generate-content'
  | 'ollama-native';

export type AiAuthMode = 'bearer' | 'api-key' | 'x-api-key' | 'query-key' | 'none';
export type AiConnectionChannel = 'official' | 'custom';

export interface AiProfilePrivacy {
  sendCurrentFile: boolean;
  sendAnnotations: boolean;
  sendChatHistory: boolean;
  sendWorkspaceIndex: boolean;
}

export interface AiModelConfig {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  enabled: boolean;
  supportsStreaming?: boolean;
}

export interface AiProviderProfile {
  id: string;
  name: string;
  provider: AiProviderId;
  protocol: AiProtocol;
  channel?: AiConnectionChannel;
  baseUrl: string;
  model: string | null;
  defaultModelId: string | null;
  models: AiModelConfig[];
  /** Model ids explicitly removed by the user; remote discovery must not re-add them. */
  modelTombstones?: string[];
  enabled: boolean;
  isDefault: boolean;
  authMode: AiAuthMode;
  organization?: string;
  project?: string;
  timeoutMs: number;
  firstResponseTimeoutMs?: number;
  maxRequestDurationMs?: number;
  maxRetries: number;
  customHeaders: Record<string, string>;
  privacy: AiProfilePrivacy;
}

export type AiConnectionErrorCode =
  | 'missing_credentials'
  | 'cors_or_network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'server_error'
  | 'protocol_mismatch'
  | 'invalid_response'
  | 'unknown';

export interface AiModel {
  id: string;
  name: string;
  provider: AiProviderId;
  contextWindow: number;
  supportsStreaming: boolean;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | AiContentPart[];
  toolCallId?: string;
}

export interface AiContentPart {
  type: 'text' | 'image';
  text?: string;
  data?: string;        // base64 image data
  mimeType?: string;    // e.g. 'image/png'
}

/** Extract plain text from AiMessage content (string or parts array) */
export function getMessageText(content: string | AiContentPart[]): string {
  if (typeof content === 'string') return content;
  return content.filter(p => p.type === 'text').map(p => p.text ?? '').join('');
}

export interface AiStreamChunk {
  type: 'text' | 'done' | 'error';
  text?: string;
  error?: string;
  code?: 'output_limit' | 'refusal' | 'tool_calls' | 'incomplete_stream' | 'rate_limited' | 'quota_exceeded';
  retryAt?: number;
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

/** Content-free protocol metadata: never includes provider text, thoughts, signatures or URLs. */
export interface AiResponseDiagnostics {
  protocol: AiProtocol;
  mode: 'response' | 'stream';
  blockTypes: string[];
  visibleCharacters: number;
  stopReason?: string;
  finishReason?: AiGenerateResult['finishReason'];
  usage?: AiUsage;
}

export interface AiGenerateResult {
  text: string;
  model: string;
  usage?: AiUsage;
  responseDiagnostics?: AiResponseDiagnostics;
  /** Normalized provider completion status; absent for legacy providers. */
  finishReason?: 'stop' | 'length' | 'refusal' | 'tool_calls' | 'unknown';
}

export interface AiGenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** User-configured ceiling for bounded empty-output recovery; the model ceiling is also enforced by the provider. */
  recoveryMaxTokens?: number;
  /** Absolute deadline shared by the answer's segments, recovery and validation requests. */
  deadlineAt?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
  onProgress?: (progress: import('./request-lifecycle').AiRequestProgress) => void;
  onResponseDiagnostics?: (diagnostics: AiResponseDiagnostics) => void;
}

export interface AiConnectionTestResult {
  ok: boolean;
  message?: string;
  code?: AiConnectionErrorCode;
  httpStatus?: number;
  latencyMs?: number;
  requestId?: string;
  diagnostics?: string[];
}

export interface AiProvider {
  id: AiProviderId;
  name: string;
  requestTimeouts?: import('./request-lifecycle').AiRequestTimeouts;
  /** Configured ceiling also enforced by the provider's wire adapter. */
  getMaxOutputTokens?: (model?: string | null) => number | undefined;
  isConfigured: () => boolean;
  testConnection: () => Promise<AiConnectionTestResult>;
  getAvailableModels: () => Promise<AiModel[]>;
  generate: (messages: AiMessage[], options?: AiGenerateOptions) => Promise<AiGenerateResult>;
  stream: (messages: AiMessage[], options?: AiGenerateOptions) => AsyncIterable<AiStreamChunk>;
  estimateTokens: (text: string) => number;
}

// ============================================================================
// AI-Native Workbench Types
// ============================================================================

export type EvidenceKind =
  | 'file'
  | 'heading'
  | 'pdf_page'
  | 'pdf_annotation'
  | 'code_line'
  | 'notebook_cell';

export interface EvidenceAnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface EvidenceAnchor {
  offsets?: {
    start: number;
    end: number;
  };
  lineStart?: number;
  lineEnd?: number;
  cellId?: string;
  cellIndex?: number;
  page?: number;
  rects?: EvidenceAnchorRect[];
  snippet?: string;
  blockLabel?: string;
  heading?: string;
}

export interface EvidenceRef {
  kind: EvidenceKind;
  label: string;
  locator: string;
  preview?: string;
  anchor?: EvidenceAnchor;
  /** Cloud identity is never a filesystem path; access is rechecked by its provider. */
  cloudIdentity?: { resourceId: string; libraryId: string; itemId: string; versionId?: string; version: string; role: import('../shared-library/domain').LibraryRole; name: string };
}

export type SelectionAiMode = 'chat' | 'agent' | 'plan';
export type SelectionSourceKind = 'markdown' | 'code' | 'notebook' | 'pdf' | 'html' | 'word';

export interface SelectionAiOrigin {
  kind: 'selection-ai';
  mode: SelectionAiMode;
  sourceKind: SelectionSourceKind;
  sourceLabel: string;
  selectionPreview: string;
}

export type AiModelSource = 'local' | 'cloud';

export interface AiModelInfo {
  providerId: AiProviderId;
  providerName: string;
  model: string | null;
  source: AiModelSource;
}

export type AiDraftArtifactType =
  | 'research_summary'
  | 'paper_note'
  | 'annotation_digest'
  | 'formula_explainer'
  | 'code_explainer'
  | 'experiment_note'
  | 'comparison_summary'
  | 'task_plan';

export type AiDraftTemplateId =
  | 'reading-note'
  | 'comparison-summary'
  | 'code-note'
  | 'research-summary'
  | 'task-plan';

export type AiDraftArtifactStatus = 'draft' | 'approved' | 'applied' | 'discarded';
export type AiDraftWriteMode = 'create' | 'append' | 'update';

export interface AiPdfChildTarget {
  sourcePath: string;
  suggestedTargetPath: string;
  workspaceKey?: string;
  parentItemId?: string;
  parentVersion?: string;
}

export interface AiDraftArtifact {
  id: string;
  type: AiDraftArtifactType;
  templateId?: AiDraftTemplateId;
  promptRunId?: string;
  title: string;
  sourceRefs: EvidenceRef[];
  content: string;
  status: AiDraftArtifactStatus;
  createdAt: number;
  targetPath?: string;
  pdfChildTarget?: AiPdfChildTarget;
  cloudPdfChildProposal?: import('./lattice-skills/cloud-pdf-child-skill').CloudPdfChildProposal;
  cloudFileProposal?: import('./harness/cloud-file-proposal').CloudFileProposal;
  contentFormat?: 'raw';
  fileChange?: { targetPath: string; expectedContent?: string; workspaceKey?: string };
  writeMode?: AiDraftWriteMode;
  originMessageId?: string;
  originProposalId?: string;
}

export interface AiPlannedWrite {
  targetPath: string;
  mode: 'create' | 'append' | 'update';
  contentPreview: string;
}

export interface AiTaskProposalStep {
  id: string;
  title: string;
  description: string;
}

export type AiTaskProposalStatus = 'pending' | 'approved' | 'discarded';

export interface AiTaskProposal {
  id: string;
  summary: string;
  promptRunId?: string;
  steps: AiTaskProposalStep[];
  requiredApprovals: string[];
  plannedWrites: AiPlannedWrite[];
  sourceRefs: EvidenceRef[];
  status: AiTaskProposalStatus;
  confirmedApprovals: string[];
  approvedWrites: string[];
  generatedDraftTargets: string[];
  createdAt: number;
  origin?: SelectionAiOrigin;
}

export interface AiActionApproval {
  proposalId: string;
  approved: boolean;
  approvedWrites?: string[];
}

export type AiTaskType =
  | 'chat'
  | 'inline'
  | 'research'
  | 'pdf_summary'
  | 'pdf_qa'
  | 'notebook_assist'
  | 'code_explain'
  | 'knowledge_organize'
  | 'task_proposal';

export interface ModelRouterPolicy {
  taskType: AiTaskType;
  preferredProvider: AiProviderId | null;
  fallbackProvider: AiProviderId | null;
  maxContextTokens: number;
  evidenceRequired: boolean;
}

export interface AiRuntimeSettings {
  aiEnabled: boolean;
  providerId: AiProviderId | null;
  model: string | null;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  preferLocal?: boolean;
  agentOmittedSummaryEnabled?: boolean;
  profileId?: string | null;
}

export interface AiContextNode {
  id: string;
  kind: 'selection' | 'file' | 'heading' | 'annotation' | 'code_symbol' | 'notebook_cell' | 'workspace_chunk' | 'pdf_page';
  label: string;
  content: string;
  priority: number;
  evidenceRef?: EvidenceRef;
}

export interface AiPromptContext {
  nodes: AiContextNode[];
  prompt: string;
  evidenceRefs: EvidenceRef[];
  truncated: boolean;
}

export interface AiReferenceInput {
  path: string;
  content: string;
}

export interface AiResearchContextInput {
  /** Disable implicit global-index context when the request has an explicit source scope. */
  includeWorkspaceContext?: boolean;
  filePath?: string;
  content?: string;
  selection?: string;
  references?: AiReferenceInput[];
  annotations?: Array<{
    id: string;
    target: {
      type: 'pdf' | 'image' | 'text_anchor' | 'code_line';
      page?: number;
      line?: number;
    };
    content?: string;
    comment?: string;
  }>;
  query?: string;
  explicitEvidenceRefs?: EvidenceRef[];
}

export interface AiChatRequest extends AiResearchContextInput {
  prompt: string;
  history?: AiMessage[];
  settings: AiRuntimeSettings;
  signal?: AbortSignal;
  availableDocuments?: string[];
  images?: AiContentPart[];
  onProgress?: AiGenerateOptions['onProgress'];
}

export interface AiInlineActionRequest extends AiResearchContextInput {
  action:
    | 'summarize'
    | 'translate'
    | 'explain_formula'
    | 'improve_writing'
    | 'continue_writing';
  input: string;
  settings: AiRuntimeSettings;
}

export interface AiResearchActionRequest extends AiResearchContextInput {
  action:
    | 'summarize_paper'
    | 'extract_findings'
    | 'answer_question'
    | 'digest_annotations'
    | 'explain_code'
    | 'interpret_output';
  prompt: string;
  settings: AiRuntimeSettings;
}

export interface AiTaskProposalRequest extends AiResearchContextInput {
  prompt: string;
  settings: AiRuntimeSettings;
}

export interface AiFollowUpAction {
  id: string;
  label: string;
  kind: 'create_draft' | 'propose_task';
}

export interface AiDraftSuggestion {
  type: AiDraftArtifactType;
  templateId?: AiDraftTemplateId;
  title: string;
  content?: string;
  targetPath?: string;
  pdfChildTarget?: AiPdfChildTarget;
  cloudPdfChildProposal?: import('./lattice-skills/cloud-pdf-child-skill').CloudPdfChildProposal;
  writeMode?: AiDraftWriteMode;
}

export interface AiRunResult {
  text: string;
  evidenceRefs: EvidenceRef[];
  context: AiPromptContext;
  model: AiModelInfo;
  followUpActions: AiFollowUpAction[];
  draftSuggestion?: AiDraftSuggestion;
}
