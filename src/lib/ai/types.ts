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

export type AiProviderId = 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';

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

export interface AiProvider {
  id: AiProviderId;
  name: string;
  isConfigured: () => boolean;
  testConnection: () => Promise<boolean>;
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
