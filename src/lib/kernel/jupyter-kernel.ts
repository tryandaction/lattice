/**
 * Jupyter Kernel 实现
 *
 * 通过 WebSocket 与本地 Jupyter Server 通信
 */

import type {
  IKernelManager,
  ExecuteOptions,
  ExecutionResult,
  ExecutionOutput,
  VariableInfo,
  CompletionResult,
  InspectionResult,
  KernelStatus,
} from './kernel-manager';
import { JupyterWebSocketManager } from './jupyter-websocket';
import {
  createMessage,
  type JupyterMessage,
  type ExecuteReplyContent,
  type StreamContent,
  type DisplayDataContent,
  type ExecuteResultContent,
  type ErrorContent,
  type StatusContent,
  type CompleteReplyContent,
  type InspectReplyContent,
} from './jupyter-messages';

// ============================================================================
// Jupyter Kernel 配置
// ============================================================================

export interface JupyterKernelConfig {
  /** Jupyter Server URL */
  serverUrl: string;
  /** Kernel ID */
  kernelId: string;
  /** 会话 ID */
  sessionId?: string;
}

// ============================================================================
// Jupyter Kernel 实现
// ============================================================================

export class JupyterKernel implements IKernelManager {
  private config: JupyterKernelConfig;
  private wsManager: JupyterWebSocketManager | null = null;
  private status: KernelStatus = 'idle';
  private statusCallbacks: Set<(status: KernelStatus) => void> = new Set();
  private outputCallbacks: Set<(output: ExecutionOutput) => void> = new Set();
  private executionCount = 0;
  private pendingExecutions: Map<
    string,
    {
      resolve: (result: ExecutionResult) => void;
      reject: (error: Error) => void;
      outputs: ExecutionOutput[];
      startTime: number;
    }
  > = new Map();

  constructor(config: JupyterKernelConfig) {
    this.config = {
      ...config,
      sessionId: config.sessionId || this.generateSessionId(),
    };
  }

  /**
   * 初始化 Kernel
   */
  async initialize(): Promise<void> {
    try {
      this.setStatus('starting');

      // 创建 WebSocket 管理器
      this.wsManager = new JupyterWebSocketManager(
        this.config.serverUrl,
        this.config.kernelId
      );

      // 连接所有通道
      await this.wsManager.connect();

      // 设置消息监听器
      this.setupMessageHandlers();

      this.setStatus('idle');
    } catch (error) {
      this.setStatus('error');
      throw new Error(`Failed to initialize Jupyter Kernel: ${error}`);
    }
  }

  /**
   * 执行代码
   */
  async execute(code: string, options?: ExecuteOptions): Promise<ExecutionResult> {
    if (!this.wsManager) {
      throw new Error('Kernel not initialized');
    }

    const opts: Required<ExecuteOptions> = {
      silent: options?.silent ?? false,
      storeHistory: options?.storeHistory ?? true,
      allowStdin: options?.allowStdin ?? false,
      stopOnError: options?.stopOnError ?? true,
    };

    return new Promise((resolve, reject) => {
      const shellChannel = this.wsManager!.getShellChannel();

      // 创建执行请求消息
      const message = createMessage(
        'execute_request',
        {
          code,
          silent: opts.silent,
          store_history: opts.storeHistory,
          user_expressions: {},
          allow_stdin: opts.allowStdin,
          stop_on_error: opts.stopOnError,
        },
        this.config.sessionId!
      );

      const msgId = message.header.msg_id;
      const startTime = Date.now();

      // 存储待处理的执行
      this.pendingExecutions.set(msgId, {
        resolve,
        reject,
        outputs: [],
        startTime,
      });

      // 发送执行请求
      shellChannel.send(message);

      // 设置超时
      setTimeout(() => {
        const pending = this.pendingExecutions.get(msgId);
        if (pending) {
          this.pendingExecutions.delete(msgId);
          pending.reject(new Error('Execution timeout (60s)'));
        }
      }, 60000);
    });
  }

  /**
   * 重启 Kernel
   */
  async restart(): Promise<void> {
    if (!this.wsManager) {
      throw new Error('Kernel not initialized');
    }

    this.setStatus('restarting');

    const shellChannel = this.wsManager.getShellChannel();
    const message = createMessage(
      'shutdown_request',
      { restart: true },
      this.config.sessionId!
    );

    return new Promise((resolve, reject) => {
      const unsubscribe = shellChannel.on('shutdown_reply', (reply) => {
        unsubscribe();
        if (reply.content.status === 'ok') {
          this.executionCount = 0;
          this.setStatus('idle');
          resolve();
        } else {
          this.setStatus('error');
          reject(new Error('Failed to restart kernel'));
        }
      });

      shellChannel.send(message);
    });
  }

  /**
   * 中断执行
   */
  async interrupt(): Promise<void> {
    if (!this.wsManager) {
      throw new Error('Kernel not initialized');
    }

    const controlChannel = this.wsManager.getControlChannel();
    const message = createMessage(
      'interrupt_request',
      {},
      this.config.sessionId!
    );

    return new Promise((resolve, reject) => {
      const unsubscribe = controlChannel.on('interrupt_reply', (reply) => {
        unsubscribe();
        if (reply.content.status === 'ok') {
          resolve();
        } else {
          reject(new Error('Failed to interrupt kernel'));
        }
      });

      controlChannel.send(message);
    });
  }

  /**
   * 获取变量
   */
  async getVariables(): Promise<Record<string, VariableInfo>> {
    // 通过执行 Python 代码获取变量
    const code = `
import json
import sys

def get_variables():
    variables = {}
    for name, value in list(globals().items()):
        if not name.startswith('_') and name not in ['In', 'Out', 'get_ipython', 'exit', 'quit', 'get_variables']:
            try:
                var_type = type(value).__name__
                var_value = str(value)
                var_size = sys.getsizeof(value)

                # 截断长字符串
                if len(var_value) > 100:
                    var_value = var_value[:100] + '...'

                # 获取形状（如果是数组或 DataFrame）
                shape = None
                if hasattr(value, 'shape'):
                    shape = list(value.shape)

                variables[name] = {
                    'name': name,
                    'type': var_type,
                    'value': var_value,
                    'size': var_size,
                    'shape': shape,
                }
            except:
                pass
    return variables

print(json.dumps(get_variables()))
`;

    const result = await this.execute(code, { silent: true });

    if (result.status === 'ok' && result.outputs.length > 0) {
      const output = result.outputs[0];
      if (output.type === 'stream') {
        const streamContent = output.content as import('./kernel-manager').StreamOutput;
        if (streamContent.name === 'stdout') {
          try {
            const variables = JSON.parse(streamContent.text);
            return variables;
          } catch {
            // Ignore malformed stdout and fall back to an empty variable snapshot.
          }
        }
      }
    }

    return {};
  }

  /**
   * 代码补全
   */
  async complete(code: string, cursorPos: number): Promise<CompletionResult> {
    if (!this.wsManager) {
      throw new Error('Kernel not initialized');
    }

    const shellChannel = this.wsManager.getShellChannel();
    const message = createMessage(
      'complete_request',
      {
        code,
        cursor_pos: cursorPos,
      },
      this.config.sessionId!
    );

    return new Promise((resolve, reject) => {
      const unsubscribe = shellChannel.on('complete_reply', (reply) => {
        unsubscribe();
        const content = reply.content as CompleteReplyContent;

        if (content.status === 'ok') {
          resolve({
            matches: content.matches.map((text) => ({ text })),
            cursorStart: content.cursor_start,
            cursorEnd: content.cursor_end,
            metadata: content.metadata,
          });
        } else {
          reject(new Error('Completion failed'));
        }
      });

      shellChannel.send(message);
    });
  }

  /**
   * 代码检查
   */
  async inspect(code: string, cursorPos: number): Promise<InspectionResult> {
    if (!this.wsManager) {
      throw new Error('Kernel not initialized');
    }

    const shellChannel = this.wsManager.getShellChannel();
    const message = createMessage(
      'inspect_request',
      {
        code,
        cursor_pos: cursorPos,
        detail_level: 1,
      },
      this.config.sessionId!
    );

    return new Promise((resolve, reject) => {
      const unsubscribe = shellChannel.on('inspect_reply', (reply) => {
        unsubscribe();
        const content = reply.content as InspectReplyContent;

        if (content.status === 'ok') {
          resolve({
            found: content.found,
            data: content.data,
            metadata: content.metadata,
          });
        } else {
          reject(new Error('Inspection failed'));
        }
      });

      shellChannel.send(message);
    });
  }

  /**
   * 获取状态
   */
  getStatus(): KernelStatus {
    return this.status;
  }

  /**
   * 关闭 Kernel
   */
  async shutdown(): Promise<void> {
    if (this.wsManager) {
      this.wsManager.close();
      this.wsManager = null;
    }
    this.setStatus('dead');
  }

  /**
   * 监听状态变化
   */
  onStatusChange(callback: (status: KernelStatus) => void): () => void {
    this.statusCallbacks.add(callback);
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  /**
   * 监听输出
   */
  onOutput(callback: (output: ExecutionOutput) => void): () => void {
    this.outputCallbacks.add(callback);
    return () => {
      this.outputCallbacks.delete(callback);
    };
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 设置消息处理器
   */
  private setupMessageHandlers(): void {
    if (!this.wsManager) return;

    const iopubChannel = this.wsManager.getIOPubChannel();
    const shellChannel = this.wsManager.getShellChannel();

    // 监听状态变化
    iopubChannel.on('status', (message) => {
      const content = message.content as StatusContent;
      const state = content.execution_state;

      if (state === 'busy') {
        this.setStatus('busy');
      } else if (state === 'idle') {
        this.setStatus('idle');
      }
    });

    // 监听输出流
    iopubChannel.on('stream', (message) => {
      this.handleStreamOutput(message);
    });

    iopubChannel.on('display_data', (message) => {
      this.handleDisplayData(message);
    });

    iopubChannel.on('execute_result', (message) => {
      this.handleExecuteResult(message);
    });

    iopubChannel.on('error', (message) => {
      this.handleError(message);
    });

    // 监听执行回复
    shellChannel.on('execute_reply', (message) => {
      this.handleExecuteReply(message);
    });
  }

  /**
   * 处理流输出
   */
  private handleStreamOutput(message: JupyterMessage<StreamContent>): void {
    const parentMsgId = message.parent_header.msg_id;
    if (!parentMsgId) return;

    const pending = this.pendingExecutions.get(parentMsgId);
    if (pending) {
      const output: ExecutionOutput = {
        type: 'stream',
        content: message.content,
      };
      pending.outputs.push(output);
      this.notifyOutput(output);
    }
  }

  /**
   * 处理显示数据
   */
  private handleDisplayData(message: JupyterMessage<DisplayDataContent>): void {
    const parentMsgId = message.parent_header.msg_id;
    if (!parentMsgId) return;

    const pending = this.pendingExecutions.get(parentMsgId);
    if (pending) {
      const output: ExecutionOutput = {
        type: 'display_data',
        content: message.content,
      };
      pending.outputs.push(output);
      this.notifyOutput(output);
    }
  }

  /**
   * 处理执行结果
   */
  private handleExecuteResult(message: JupyterMessage<ExecuteResultContent>): void {
    const parentMsgId = message.parent_header.msg_id;
    if (!parentMsgId) return;

    const pending = this.pendingExecutions.get(parentMsgId);
    if (pending) {
      const output: ExecutionOutput = {
        type: 'execute_result',
        content: message.content,
      };
      pending.outputs.push(output);
      this.notifyOutput(output);
    }
  }

  /**
   * 处理错误
   */
  private handleError(message: JupyterMessage<ErrorContent>): void {
    const parentMsgId = message.parent_header.msg_id;
    if (!parentMsgId) return;

    const pending = this.pendingExecutions.get(parentMsgId);
    if (pending) {
      const output: ExecutionOutput = {
        type: 'error',
        content: message.content,
      };
      pending.outputs.push(output);
      this.notifyOutput(output);
    }
  }

  /**
   * 处理执行回复
   */
  private handleExecuteReply(message: JupyterMessage<ExecuteReplyContent>): void {
    const msgId = message.parent_header.msg_id;
    if (!msgId) return;

    const pending = this.pendingExecutions.get(msgId);
    if (!pending) return;

    this.pendingExecutions.delete(msgId);

    const content = message.content;
    const executionTime = Date.now() - pending.startTime;

    if (content.execution_count) {
      this.executionCount = content.execution_count;
    }

    const result: ExecutionResult = {
      status: content.status,
      executionCount: content.execution_count,
      outputs: pending.outputs,
      executionTime,
    };

    pending.resolve(result);
  }

  /**
   * 设置状态
   */
  private setStatus(status: KernelStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.statusCallbacks.forEach((callback) => callback(status));
    }
  }

  /**
   * 通知输出
   */
  private notifyOutput(output: ExecutionOutput): void {
    this.outputCallbacks.forEach((callback) => callback(output));
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    return `lattice-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
