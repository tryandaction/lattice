/**
 * Kernel Manager - 抽象接口定义
 *
 * 统一 Pyodide 和 Jupyter Kernel 的接口，支持运行时切换
 */

// ============================================================================
// 执行选项
// ============================================================================

export interface ExecuteOptions {
  /** 是否静默执行（不显示输出） */
  silent?: boolean;
  /** 是否存储到历史记录 */
  storeHistory?: boolean;
  /** 是否允许标准输入 */
  allowStdin?: boolean;
  /** 遇到错误时是否停止 */
  stopOnError?: boolean;
}

// ============================================================================
// 执行结果
// ============================================================================

export interface ExecutionResult {
  /** 执行状态 */
  status: 'ok' | 'error' | 'abort';
  /** 执行计数 */
  executionCount: number;
  /** 输出列表 */
  outputs: ExecutionOutput[];
  /** 执行时间（毫秒） */
  executionTime: number;
  /** 变量快照（可选） */
  variables?: Record<string, VariableInfo>;
}

export interface ExecutionOutput {
  /** 输出类型 */
  type: 'stream' | 'display_data' | 'execute_result' | 'error';
  /** 输出内容 */
  content: OutputContent;
}

export type OutputContent =
  | StreamOutput
  | DisplayDataOutput
  | ExecuteResultOutput
  | ErrorOutput;

export interface StreamOutput {
  name: 'stdout' | 'stderr';
  text: string;
}

export interface DisplayDataOutput {
  data: {
    'text/plain'?: string;
    'text/html'?: string;
    'image/png'?: string;
    'image/jpeg'?: string;
    'image/svg+xml'?: string;
    'application/json'?: any;
  };
  metadata?: Record<string, any>;
}

export interface ExecuteResultOutput {
  data: {
    'text/plain'?: string;
    'text/html'?: string;
    'image/png'?: string;
    'image/jpeg'?: string;
    'image/svg+xml'?: string;
    'application/json'?: any;
  };
  metadata?: Record<string, any>;
  execution_count: number;
}

export interface ErrorOutput {
  ename: string;
  evalue: string;
  traceback: string[];
}

// ============================================================================
// 变量信息
// ============================================================================

export interface VariableInfo {
  /** 变量名 */
  name: string;
  /** 类型 */
  type: string;
  /** 值的字符串表示 */
  value: string;
  /** 大小（字节） */
  size?: number;
  /** 形状（数组/DataFrame） */
  shape?: number[];
  /** 是否可展开 */
  expandable?: boolean;
  /** 子项（嵌套对象） */
  children?: VariableInfo[];
}

// ============================================================================
// 代码补全
// ============================================================================

export interface CompletionItem {
  /** 补全文本 */
  text: string;
  /** 显示文本 */
  displayText?: string;
  /** 类型（function, class, variable, etc.） */
  type?: string;
  /** 文档字符串 */
  documentation?: string;
  /** 函数签名 */
  signature?: string;
}

export interface CompletionResult {
  /** 补全项列表 */
  matches: CompletionItem[];
  /** 光标起始位置 */
  cursorStart: number;
  /** 光标结束位置 */
  cursorEnd: number;
  /** 元数据 */
  metadata?: Record<string, any>;
}

// ============================================================================
// 代码检查
// ============================================================================

export interface InspectionResult {
  /** 是否找到 */
  found: boolean;
  /** 数据 */
  data?: {
    'text/plain'?: string;
    'text/html'?: string;
  };
  /** 元数据 */
  metadata?: Record<string, any>;
}

// ============================================================================
// Kernel 状态
// ============================================================================

export type KernelStatus =
  | 'idle'       // 空闲
  | 'busy'       // 忙碌
  | 'starting'   // 启动中
  | 'restarting' // 重启中
  | 'dead'       // 已停止
  | 'error';     // 错误

// ============================================================================
// Kernel Manager 接口
// ============================================================================

export interface IKernelManager {
  /**
   * 初始化 Kernel
   */
  initialize(): Promise<void>;

  /**
   * 执行代码
   * @param code 要执行的代码
   * @param options 执行选项
   * @returns 执行结果
   */
  execute(code: string, options?: ExecuteOptions): Promise<ExecutionResult>;

  /**
   * 重启 Kernel
   */
  restart(): Promise<void>;

  /**
   * 中断当前执行
   */
  interrupt(): Promise<void>;

  /**
   * 获取所有变量
   * @returns 变量字典
   */
  getVariables(): Promise<Record<string, VariableInfo>>;

  /**
   * 代码补全
   * @param code 代码文本
   * @param cursorPos 光标位置
   * @returns 补全结果
   */
  complete(code: string, cursorPos: number): Promise<CompletionResult>;

  /**
   * 代码检查（查看文档）
   * @param code 代码文本
   * @param cursorPos 光标位置
   * @returns 检查结果
   */
  inspect(code: string, cursorPos: number): Promise<InspectionResult>;

  /**
   * 获取 Kernel 状态
   */
  getStatus(): KernelStatus;

  /**
   * 关闭 Kernel
   */
  shutdown(): Promise<void>;

  /**
   * 监听状态变化
   * @param callback 回调函数
   * @returns 取消监听函数
   */
  onStatusChange(callback: (status: KernelStatus) => void): () => void;

  /**
   * 监听输出
   * @param callback 回调函数
   * @returns 取消监听函数
   */
  onOutput(callback: (output: ExecutionOutput) => void): () => void;
}

// ============================================================================
// Kernel 类型
// ============================================================================

export type KernelType = 'pyodide' | 'jupyter';

export interface KernelInfo {
  /** Kernel 类型 */
  type: KernelType;
  /** 显示名称 */
  displayName: string;
  /** 语言 */
  language: string;
  /** 版本 */
  version?: string;
  /** 是否可用 */
  available: boolean;
  /** 描述 */
  description?: string;
}
