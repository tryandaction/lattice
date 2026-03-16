/**
 * Jupyter Messaging Protocol 5.0 类型定义
 *
 * 基于 Jupyter 官方消息协议规范
 * https://jupyter-client.readthedocs.io/en/stable/messaging.html
 */

import type { JsonValue, KernelMetadata, MimeData } from './kernel-types';

// ============================================================================
// 消息头
// ============================================================================

export interface MessageHeader {
  /** 消息唯一标识符 */
  msg_id: string;
  /** 消息类型 */
  msg_type: string;
  /** 用户名 */
  username: string;
  /** 会话 ID */
  session: string;
  /** 时间戳（ISO 8601 格式） */
  date: string;
  /** 协议版本 */
  version: string;
}

// ============================================================================
// 完整消息结构
// ============================================================================

export interface JupyterMessage<T = unknown> {
  /** 消息头 */
  header: MessageHeader;
  /** 父消息头（用于关联请求和响应） */
  parent_header: Partial<MessageHeader> | Record<string, never>;
  /** 元数据 */
  metadata: KernelMetadata;
  /** 消息内容 */
  content: T;
  /** 二进制缓冲区 */
  buffers?: ArrayBuffer[];
}

// ============================================================================
// 消息类型
// ============================================================================

export type MessageType =
  // Shell channel - 执行请求
  | 'execute_request'
  | 'execute_reply'
  | 'inspect_request'
  | 'inspect_reply'
  | 'complete_request'
  | 'complete_reply'
  | 'history_request'
  | 'history_reply'
  | 'is_complete_request'
  | 'is_complete_reply'
  | 'comm_info_request'
  | 'comm_info_reply'
  | 'kernel_info_request'
  | 'kernel_info_reply'
  | 'shutdown_request'
  | 'shutdown_reply'
  // IOPub channel - 输出流
  | 'stream'
  | 'display_data'
  | 'execute_input'
  | 'execute_result'
  | 'error'
  | 'status'
  | 'clear_output'
  // Stdin channel - 输入请求
  | 'input_request'
  | 'input_reply'
  // Control channel - 控制命令
  | 'interrupt_request'
  | 'interrupt_reply'
  | 'debug_request'
  | 'debug_reply';

// ============================================================================
// Execute Request/Reply
// ============================================================================

export interface ExecuteRequestContent {
  /** 要执行的代码 */
  code: string;
  /** 是否静默执行 */
  silent: boolean;
  /** 是否存储历史 */
  store_history: boolean;
  /** 用户表达式 */
  user_expressions?: Record<string, string>;
  /** 是否允许标准输入 */
  allow_stdin: boolean;
  /** 遇到错误时是否停止 */
  stop_on_error: boolean;
}

export interface ExecuteReplyContent {
  /** 执行状态 */
  status: 'ok' | 'error' | 'abort';
  /** 执行计数 */
  execution_count: number;
  /** 用户表达式结果（仅 status='ok' 时） */
  user_expressions?: Record<string, JsonValue>;
  /** 负载（仅 status='ok' 时） */
  payload?: JsonValue[];
  /** 错误名称（仅 status='error' 时） */
  ename?: string;
  /** 错误值（仅 status='error' 时） */
  evalue?: string;
  /** 错误回溯（仅 status='error' 时） */
  traceback?: string[];
}

// ============================================================================
// Stream Output
// ============================================================================

export interface StreamContent {
  /** 流名称 */
  name: 'stdout' | 'stderr';
  /** 文本内容 */
  text: string;
}

// ============================================================================
// Display Data
// ============================================================================

export interface DisplayDataContent {
  /** 数据字典（MIME 类型 -> 数据） */
  data: MimeBundle;
  /** 元数据 */
  metadata: KernelMetadata;
  /** 瞬态数据 */
  transient?: {
    display_id?: string;
  };
}

export type MimeBundle = MimeData;

// ============================================================================
// Execute Result
// ============================================================================

export interface ExecuteResultContent {
  /** 执行计数 */
  execution_count: number;
  /** 数据字典 */
  data: MimeBundle;
  /** 元数据 */
  metadata: KernelMetadata;
}

// ============================================================================
// Error Output
// ============================================================================

export interface ErrorContent {
  /** 错误名称 */
  ename: string;
  /** 错误值 */
  evalue: string;
  /** 错误回溯 */
  traceback: string[];
}

// ============================================================================
// Status
// ============================================================================

export interface StatusContent {
  /** 执行状态 */
  execution_state: 'busy' | 'idle' | 'starting';
}

// ============================================================================
// Execute Input
// ============================================================================

export interface ExecuteInputContent {
  /** 代码 */
  code: string;
  /** 执行计数 */
  execution_count: number;
}

// ============================================================================
// Clear Output
// ============================================================================

export interface ClearOutputContent {
  /** 是否等待下一个输出 */
  wait: boolean;
}

// ============================================================================
// Complete Request/Reply
// ============================================================================

export interface CompleteRequestContent {
  /** 代码 */
  code: string;
  /** 光标位置 */
  cursor_pos: number;
}

export interface CompleteReplyContent {
  /** 匹配列表 */
  matches: string[];
  /** 光标起始位置 */
  cursor_start: number;
  /** 光标结束位置 */
  cursor_end: number;
  /** 元数据 */
  metadata: KernelMetadata;
  /** 状态 */
  status: 'ok' | 'error';
}

// ============================================================================
// Inspect Request/Reply
// ============================================================================

export interface InspectRequestContent {
  /** 代码 */
  code: string;
  /** 光标位置 */
  cursor_pos: number;
  /** 详细级别（0 或 1） */
  detail_level: 0 | 1;
}

export interface InspectReplyContent {
  /** 状态 */
  status: 'ok' | 'error';
  /** 是否找到 */
  found: boolean;
  /** 数据字典 */
  data: MimeBundle;
  /** 元数据 */
  metadata: KernelMetadata;
}

// ============================================================================
// Kernel Info Request/Reply
// ============================================================================

export type KernelInfoRequestContent = Record<string, never>;

export interface KernelInfoReplyContent {
  /** 状态 */
  status: 'ok' | 'error';
  /** 协议版本 */
  protocol_version: string;
  /** 实现名称 */
  implementation: string;
  /** 实现版本 */
  implementation_version: string;
  /** 语言信息 */
  language_info: {
    name: string;
    version: string;
    mimetype: string;
    file_extension: string;
    pygments_lexer?: string;
    codemirror_mode?: string | KernelMetadata;
    nbconvert_exporter?: string;
  };
  /** Banner */
  banner: string;
  /** 调试器支持 */
  debugger?: boolean;
  /** 帮助链接 */
  help_links?: Array<{
    text: string;
    url: string;
  }>;
}

// ============================================================================
// Interrupt Request/Reply
// ============================================================================

export type InterruptRequestContent = Record<string, never>;

export interface InterruptReplyContent {
  /** 状态 */
  status: 'ok' | 'error';
}

// ============================================================================
// Shutdown Request/Reply
// ============================================================================

export interface ShutdownRequestContent {
  /** 是否重启 */
  restart: boolean;
}

export interface ShutdownReplyContent {
  /** 状态 */
  status: 'ok' | 'error';
  /** 是否重启 */
  restart: boolean;
}

// ============================================================================
// Input Request/Reply
// ============================================================================

export interface InputRequestContent {
  /** 提示文本 */
  prompt: string;
  /** 是否为密码输入 */
  password: boolean;
}

export interface InputReplyContent {
  /** 用户输入 */
  value: string;
}

// ============================================================================
// 消息内容类型映射
// ============================================================================

export interface MessageContentMap {
  execute_request: ExecuteRequestContent;
  execute_reply: ExecuteReplyContent;
  stream: StreamContent;
  display_data: DisplayDataContent;
  execute_result: ExecuteResultContent;
  error: ErrorContent;
  status: StatusContent;
  execute_input: ExecuteInputContent;
  clear_output: ClearOutputContent;
  complete_request: CompleteRequestContent;
  complete_reply: CompleteReplyContent;
  inspect_request: InspectRequestContent;
  inspect_reply: InspectReplyContent;
  kernel_info_request: KernelInfoRequestContent;
  kernel_info_reply: KernelInfoReplyContent;
  interrupt_request: InterruptRequestContent;
  interrupt_reply: InterruptReplyContent;
  shutdown_request: ShutdownRequestContent;
  shutdown_reply: ShutdownReplyContent;
  input_request: InputRequestContent;
  input_reply: InputReplyContent;
}

// ============================================================================
// 工具函数类型
// ============================================================================

/**
 * 创建消息头
 */
export function createMessageHeader(
  msgType: MessageType,
  session: string,
  username: string = 'lattice'
): MessageHeader {
  return {
    msg_id: generateMessageId(),
    msg_type: msgType,
    username,
    session,
    date: new Date().toISOString(),
    version: '5.3',
  };
}

/**
 * 创建完整消息
 */
export function createMessage<T extends keyof MessageContentMap>(
  msgType: T,
  content: MessageContentMap[T],
  session: string,
  parentHeader?: Partial<MessageHeader>
): JupyterMessage<MessageContentMap[T]> {
  return {
    header: createMessageHeader(msgType as MessageType, session),
    parent_header: parentHeader || {},
    metadata: {},
    content,
    buffers: [],
  };
}

/**
 * 生成消息 ID
 */
function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
