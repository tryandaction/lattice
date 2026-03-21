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
  | 'custom';

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
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiGenerateResult {
  text: string;
  model: string;
  usage?: AiUsage;
}

export interface AiGenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}

export interface AiConnectionTestResult {
  ok: boolean;
  message?: string;
}

export interface AiProvider {
  id: AiProviderId;
  name: string;
  isConfigured: () => boolean;
  testConnection: () => Promise<AiConnectionTestResult>;
  getAvailableModels: () => Promise<AiModel[]>;
  generate: (messages: AiMessage[], options?: AiGenerateOptions) => Promise<AiGenerateResult>;
  stream: (messages: AiMessage[], options?: AiGenerateOptions) => AsyncIterable<AiStreamChunk>;
  estimateTokens: (text: string) => number;
}

// ============================================================================
// Function Calling / Tool Use
// ============================================================================

export interface AiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiToolResult {
  toolCallId: string;
  content: string;
}

// ============================================================================
// Agent Types
// ============================================================================

export interface AgentStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'response';
  content: string;
  toolCall?: AiToolCall;
  toolResult?: AiToolResult;
  timestamp: number;
}

export interface AgentTask {
  id: string;
  description: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  steps: AgentStep[];
  result?: string;
  error?: string;
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
export type AiDraftWriteMode = 'create' | 'append';

export interface AiDraftArtifact {
  id: string;
  type: AiDraftArtifactType;
  templateId?: AiDraftTemplateId;
  title: string;
  sourceRefs: EvidenceRef[];
  content: string;
  status: AiDraftArtifactStatus;
  createdAt: number;
  targetPath?: string;
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
}

export interface AiContextNode {
  id: string;
  kind: 'selection' | 'file' | 'heading' | 'annotation' | 'code_symbol' | 'notebook_cell' | 'workspace_chunk';
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

export interface AiRunResult {
  text: string;
  evidenceRefs: EvidenceRef[];
  context: AiPromptContext;
  model: AiModelInfo;
  followUpActions: AiFollowUpAction[];
  draftSuggestion?: {
    type: AiDraftArtifactType;
    templateId?: AiDraftTemplateId;
    title: string;
  };
}
