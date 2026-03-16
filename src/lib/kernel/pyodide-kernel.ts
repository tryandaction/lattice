/**
 * Pyodide Kernel 实现
 *
 * 基于 Pyodide (WebAssembly Python) 的 Kernel 实现
 * 重构自 python-worker-manager.ts
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
import type { MimeData } from './kernel-types';

// ============================================================================
// Worker 消息类型
// ============================================================================

type WorkerOutMessage =
  | { type: 'status'; status: 'loading' | 'ready' | 'error'; error?: string }
  | { type: 'stdout'; id: string; content: string }
  | { type: 'stderr'; id: string; content: string }
  | { type: 'image'; id: string; payload: string }
  | { type: 'html'; id: string; payload: string }
  | { type: 'svg'; id: string; payload: string }
  | { type: 'result'; id: string; value: string }
  | { type: 'variables'; id: string; variables: Record<string, VariableInfo> }
  | { type: 'execution_complete'; id: string; executionTime: number; timestamp: number }
  | { type: 'error'; id: string; error: string; traceback?: string };

// ============================================================================
// Pyodide Kernel 实现
// ============================================================================

export class PyodideKernel implements IKernelManager {
  private worker: Worker | null = null;
  private status: KernelStatus = 'idle';
  private error: string | null = null;
  private initPromise: Promise<void> | null = null;
  private statusCallbacks: Set<(status: KernelStatus) => void> = new Set();
  private outputCallbacks: Set<(output: ExecutionOutput) => void> = new Set();
  private pendingExecutions: Map<
    string,
    {
      resolve: (result: ExecutionResult) => void;
      reject: (error: Error) => void;
      outputs: ExecutionOutput[];
      startTime: number;
      executionCount: number;
    }
  > = new Map();
  private executionCount = 0;

  /**
   * 初始化 Kernel
   */
  async initialize(): Promise<void> {
    if (this.status === 'idle' || this.status === 'starting') {
      if (this.initPromise) return this.initPromise;

      this.initPromise = new Promise<void>((resolve, reject) => {
        // 创建 Worker
        if (!this.worker) {
          this.worker = this.createWorker();
        }

        // 监听初始化完成
        const unsubscribe = this.onStatusChange((status) => {
          if (status === 'idle') {
            unsubscribe();
            resolve();
          } else if (status === 'error') {
            unsubscribe();
            reject(new Error(this.error ?? 'Initialization failed'));
          }
        });

        // 发送初始化消息
        this.setStatus('starting');
        this.worker.postMessage({ action: 'init' });
      });

      return this.initPromise;
    }
  }

  /**
   * 执行代码
   */
  async execute(code: string, _options?: ExecuteOptions): Promise<ExecutionResult> {
    // 确保已初始化
    if (this.status === 'idle' || this.status === 'starting') {
      await this.initialize();
    }

    if (this.status === 'error') {
      throw new Error(this.error ?? 'Kernel in error state');
    }

    return new Promise((resolve, reject) => {
      const id = this.generateExecutionId();
      const startTime = Date.now();
      this.executionCount++;

      // 存储待处理的执行
      this.pendingExecutions.set(id, {
        resolve,
        reject,
        outputs: [],
        startTime,
        executionCount: this.executionCount,
      });

      // 发送执行请求
      this.setStatus('busy');
      this.worker!.postMessage({ action: 'run', code, id });

      // 设置超时
      setTimeout(() => {
        const pending = this.pendingExecutions.get(id);
        if (pending) {
          this.pendingExecutions.delete(id);
          this.setStatus('idle');
          pending.reject(new Error('Execution timeout (60s)'));
        }
      }, 60000);
    });
  }

  /**
   * 重启 Kernel
   */
  async restart(): Promise<void> {
    this.setStatus('restarting');
    this.terminate();
    this.executionCount = 0;
    await this.initialize();
  }

  /**
   * 中断执行
   */
  async interrupt(): Promise<void> {
    // Pyodide 不支持真正的中断，只能终止 Worker
    this.terminate();
    await this.initialize();
  }

  /**
   * 获取变量
   */
  async getVariables(): Promise<Record<string, VariableInfo>> {
    const code = `
import json
import sys

def get_variables():
    variables = {}
    for name, value in list(globals().items()):
        if not name.startswith('_') and name not in ['In', 'Out', 'get_ipython', 'exit', 'quit', 'get_variables', 'display']:
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
      for (const output of result.outputs) {
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
    }

    return {};
  }

  /**
   * 代码补全（Pyodide 不支持，返回空）
   */
  async complete(_code: string, cursorPos: number): Promise<CompletionResult> {
    return {
      matches: [],
      cursorStart: cursorPos,
      cursorEnd: cursorPos,
    };
  }

  /**
   * 代码检查（Pyodide 不支持，返回未找到）
   */
  async inspect(_code: string, _cursorPos: number): Promise<InspectionResult> {
    return {
      found: false,
    };
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
    this.terminate();
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
   * 创建 Worker
   */
  private createWorker(): Worker {
    // 使用独立的 Worker 文件而不是内联代码
    const worker = new Worker(new URL('../../workers/pyodide.worker.ts', import.meta.url), {
      type: 'module'
    });

    // 设置消息处理器
    worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      this.handleWorkerMessage(event.data);
    };

    worker.onerror = (error) => {
      console.error('Worker error:', error);
      console.error('Error details:', {
        message: error.message,
        filename: error.filename,
        lineno: error.lineno,
        colno: error.colno,
      });
      this.setStatus('error');
      this.error = error.message || 'Worker initialization failed';
    };

    return worker;
  }

  /**
   * 处理 Worker 消息
   */
  private handleWorkerMessage(message: WorkerOutMessage): void {
    switch (message.type) {
      case 'status':
        if (message.status === 'loading') {
          this.setStatus('starting');
        } else if (message.status === 'ready') {
          this.setStatus('idle');
        } else if (message.status === 'error') {
          this.setStatus('error');
          this.error = message.error ?? 'Unknown error';
        }
        break;

      case 'stdout':
      case 'stderr':
        this.handleStreamOutput(message.id, message.type, message.content);
        break;

      case 'image':
      case 'html':
      case 'svg':
        this.handleDisplayOutput(message.id, message.type, message.payload);
        break;

      case 'result':
        this.handleResult(message.id, message.value);
        break;

      case 'error':
        this.handleError(message.id, message.error, message.traceback);
        break;

      case 'execution_complete':
        this.handleExecutionComplete(message.id, message.executionTime);
        break;
    }
  }

  /**
   * 处理流输出
   */
  private handleStreamOutput(id: string, type: 'stdout' | 'stderr', content: string): void {
    const pending = this.pendingExecutions.get(id);
    if (pending) {
      const output: ExecutionOutput = {
        type: 'stream',
        content: {
          name: type,
          text: content,
        },
      };
      pending.outputs.push(output);
      this.notifyOutput(output);
    }
  }

  /**
   * 处理显示输出
   */
  private handleDisplayOutput(id: string, type: 'image' | 'html' | 'svg', payload: string): void {
    const pending = this.pendingExecutions.get(id);
    if (pending) {
      const output: ExecutionOutput = {
        type: 'display_data',
        content: {
          data: this.createMimeBundle(type, payload),
          metadata: {},
        },
      };
      pending.outputs.push(output);
      this.notifyOutput(output);
    }
  }

  /**
   * 处理结果
   */
  private handleResult(id: string, value: string): void {
    const pending = this.pendingExecutions.get(id);
    if (pending) {
      const output: ExecutionOutput = {
        type: 'execute_result',
        content: {
          execution_count: pending.executionCount,
          data: {
            'text/plain': value,
          },
          metadata: {},
        },
      };
      pending.outputs.push(output);
      this.notifyOutput(output);
    }
  }

  /**
   * 处理错误
   */
  private handleError(id: string, error: string, traceback?: string): void {
    const pending = this.pendingExecutions.get(id);
    if (pending) {
      const output: ExecutionOutput = {
        type: 'error',
        content: {
          ename: 'Error',
          evalue: error,
          traceback: traceback ? traceback.split('\n') : [error],
        },
      };
      pending.outputs.push(output);
      this.notifyOutput(output);
    }
  }

  /**
   * 处理执行完成
   */
  private handleExecutionComplete(id: string, executionTime: number): void {
    const pending = this.pendingExecutions.get(id);
    if (pending) {
      this.pendingExecutions.delete(id);
      this.setStatus('idle');

      const hasError = pending.outputs.some((output) => output.type === 'error');

      const result: ExecutionResult = {
        status: hasError ? 'error' : 'ok',
        executionCount: pending.executionCount,
        outputs: pending.outputs,
        executionTime,
      };

      pending.resolve(result);
    }
  }

  /**
   * 创建 MIME Bundle
   */
  private createMimeBundle(type: 'image' | 'html' | 'svg', payload: string): MimeData {
    switch (type) {
      case 'image':
        return { 'image/png': payload };
      case 'html':
        return { 'text/html': payload };
      case 'svg':
        return { 'image/svg+xml': payload };
      default:
        return { 'text/plain': payload };
    }
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
   * 终止 Worker
   */
  private terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.status = 'idle';
    this.error = null;
    this.initPromise = null;
    this.pendingExecutions.clear();
  }

  /**
   * 生成执行 ID
   */
  private generateExecutionId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
