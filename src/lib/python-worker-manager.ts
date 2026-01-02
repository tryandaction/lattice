/**
 * Python Worker Manager
 * 
 * Singleton that manages the Pyodide Web Worker lifecycle.
 * Handles lazy initialization, message routing, and execution queuing.
 */

// Message types
export type KernelStatus = 'idle' | 'loading' | 'ready' | 'running' | 'error';

export type WorkerOutMessage =
  | { type: 'status'; status: 'loading' | 'ready' | 'error'; error?: string }
  | { type: 'stdout'; id: string; content: string }
  | { type: 'stderr'; id: string; content: string }
  | { type: 'image'; id: string; payload: string }
  | { type: 'result'; id: string; value: string }
  | { type: 'error'; id: string; error: string; traceback?: string };

export interface ExecutionOutput {
  type: 'text' | 'image' | 'error';
  content: string;
}

type MessageCallback = (message: WorkerOutMessage) => void;
type StatusCallback = (status: KernelStatus, error?: string) => void;

/**
 * Inline worker code - bundled to avoid separate file loading issues
 */
const WORKER_CODE = `
// Pyodide Web Worker (inline)
const PYODIDE_VERSION = '0.25.1';
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v' + PYODIDE_VERSION + '/full/';

let pyodide = null;
let isInitializing = false;

function postMsg(message) {
  self.postMessage(message);
}

const MATPLOTLIB_PROLOGUE = \`
import sys
import io
import base64

class _WorkerStdout:
    def __init__(self):
        self._buffer = []
    
    def write(self, text):
        if text and text.strip():
            self._buffer.append(text)
    
    def flush(self):
        if self._buffer:
            content = ''.join(self._buffer)
            if content.strip():
                _send_stdout(content)
            self._buffer = []

class _WorkerStderr:
    def __init__(self):
        self._buffer = []
    
    def write(self, text):
        if text and text.strip():
            self._buffer.append(text)
    
    def flush(self):
        if self._buffer:
            content = ''.join(self._buffer)
            if content.strip():
                _send_stderr(content)
            self._buffer = []

sys.stdout = _WorkerStdout()
sys.stderr = _WorkerStderr()

def _setup_matplotlib():
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        
        _original_show = plt.show
        
        def _patched_show(*args, **kwargs):
            import io
            import base64
            
            fig = plt.gcf()
            if fig.get_axes():
                buf = io.BytesIO()
                fig.savefig(buf, format='png', bbox_inches='tight', dpi=100, 
                           facecolor='white', edgecolor='none')
                buf.seek(0)
                img_base64 = base64.b64encode(buf.read()).decode('utf-8')
                _send_image('data:image/png;base64,' + img_base64)
                buf.close()
            plt.clf()
            plt.close('all')
        
        plt.show = _patched_show
        
    except ImportError:
        pass

_setup_matplotlib()
\`;

async function initializePyodide() {
  if (pyodide || isInitializing) return;
  
  isInitializing = true;
  postMsg({ type: 'status', status: 'loading' });
  
  try {
    importScripts(PYODIDE_CDN + 'pyodide.js');
    
    pyodide = await loadPyodide({
      indexURL: PYODIDE_CDN,
    });
    
    await pyodide.loadPackage(['numpy', 'pandas', 'matplotlib']);
    
    let currentExecutionId = '';
    
    pyodide.globals.set('_send_stdout', (content) => {
      postMsg({ type: 'stdout', id: currentExecutionId, content });
    });
    
    pyodide.globals.set('_send_stderr', (content) => {
      postMsg({ type: 'stderr', id: currentExecutionId, content });
    });
    
    pyodide.globals.set('_send_image', (payload) => {
      postMsg({ type: 'image', id: currentExecutionId, payload });
    });
    
    pyodide.globals.set('_set_execution_id', (id) => {
      currentExecutionId = id;
    });
    
    pyodide.runPython(MATPLOTLIB_PROLOGUE);
    
    isInitializing = false;
    postMsg({ type: 'status', status: 'ready' });
    
  } catch (error) {
    isInitializing = false;
    const errorMessage = error instanceof Error ? error.message : String(error);
    postMsg({ type: 'status', status: 'error', error: errorMessage });
  }
}

async function runCode(code, id) {
  if (!pyodide) {
    postMsg({ type: 'error', id, error: 'Pyodide not initialized' });
    return;
  }
  
  try {
    pyodide.runPython('_set_execution_id("' + id + '")');
    pyodide.runPython('_setup_matplotlib()');
    
    const result = await pyodide.runPythonAsync(code);
    
    pyodide.runPython('sys.stdout.flush(); sys.stderr.flush()');
    
    const resultStr = result !== undefined && result !== null ? String(result) : '';
    
    if (resultStr && resultStr !== 'None') {
      postMsg({ type: 'result', id, value: resultStr });
    } else {
      postMsg({ type: 'result', id, value: '' });
    }
    
  } catch (error) {
    let errorMessage = 'Unknown error';
    let traceback;
    
    if (error instanceof Error) {
      errorMessage = error.message;
      if (errorMessage.includes('Traceback')) {
        const parts = errorMessage.split('\\n');
        const tbIndex = parts.findIndex(p => p.includes('Traceback'));
        if (tbIndex >= 0) {
          traceback = parts.slice(tbIndex).join('\\n');
          errorMessage = parts[parts.length - 1] || errorMessage;
        }
      }
    } else {
      errorMessage = String(error);
    }
    
    postMsg({ type: 'error', id, error: errorMessage, traceback });
  }
}

self.onmessage = async (event) => {
  const { action, code, id } = event.data;
  
  switch (action) {
    case 'init':
      await initializePyodide();
      break;
    case 'run':
      if (code && id) {
        await runCode(code, id);
      }
      break;
  }
};
`;

/**
 * Singleton Python Worker Manager
 */
class PythonWorkerManager {
  private worker: Worker | null = null;
  private status: KernelStatus = 'idle';
  private error: string | null = null;
  private messageCallbacks: Map<string, MessageCallback> = new Map();
  private statusCallbacks: Set<StatusCallback> = new Set();
  private pendingExecutions: Array<{ code: string; id: string }> = [];
  private initPromise: Promise<void> | null = null;

  /**
   * Get current kernel status
   */
  getStatus(): KernelStatus {
    return this.status;
  }

  /**
   * Get current error message
   */
  getError(): string | null {
    return this.error;
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(callback: StatusCallback): () => void {
    this.statusCallbacks.add(callback);
    // Immediately notify of current status
    callback(this.status, this.error ?? undefined);
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  /**
   * Subscribe to messages for a specific execution
   */
  onMessage(executionId: string, callback: MessageCallback): () => void {
    this.messageCallbacks.set(executionId, callback);
    return () => {
      this.messageCallbacks.delete(executionId);
    };
  }

  /**
   * Update status and notify subscribers
   */
  private setStatus(status: KernelStatus, error?: string): void {
    this.status = status;
    this.error = error ?? null;
    this.statusCallbacks.forEach(cb => cb(status, error));
  }

  /**
   * Create the worker using Blob URL
   */
  private createWorker(): Worker {
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    
    worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      this.handleWorkerMessage(event.data);
    };
    
    worker.onerror = (error) => {
      console.error('Worker error:', error);
      this.setStatus('error', 'Worker crashed unexpectedly');
    };
    
    return worker;
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(message: WorkerOutMessage): void {
    if (message.type === 'status') {
      if (message.status === 'loading') {
        this.setStatus('loading');
      } else if (message.status === 'ready') {
        this.setStatus('ready');
        // Process any pending executions
        this.processPendingExecutions();
      } else if (message.status === 'error') {
        this.setStatus('error', message.error);
      }
      return;
    }
    
    // Route message to appropriate callback
    const callback = this.messageCallbacks.get(message.id);
    if (callback) {
      callback(message);
      
      // Clean up callback on result or error (execution complete)
      if (message.type === 'result' || message.type === 'error') {
        this.messageCallbacks.delete(message.id);
        // Update status back to ready if no more pending
        if (this.status === 'running' && this.messageCallbacks.size === 0) {
          this.setStatus('ready');
        }
      }
    }
  }

  /**
   * Process queued executions after initialization
   */
  private processPendingExecutions(): void {
    while (this.pendingExecutions.length > 0) {
      const execution = this.pendingExecutions.shift();
      if (execution && this.worker) {
        this.worker.postMessage({ action: 'run', ...execution });
      }
    }
  }

  /**
   * Initialize the kernel (lazy - only when needed)
   */
  async initialize(): Promise<void> {
    if (this.status === 'ready') return;
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = new Promise<void>((resolve, reject) => {
      // Create worker if needed
      if (!this.worker) {
        this.worker = this.createWorker();
      }
      
      // Set up one-time listener for ready/error
      const unsubscribe = this.onStatusChange((status, error) => {
        if (status === 'ready') {
          unsubscribe();
          resolve();
        } else if (status === 'error') {
          unsubscribe();
          reject(new Error(error ?? 'Initialization failed'));
        }
      });
      
      // Send init message
      this.worker.postMessage({ action: 'init' });
    });
    
    return this.initPromise;
  }

  /**
   * Run Python code
   */
  async runCode(code: string, id: string): Promise<void> {
    // Initialize if needed
    if (this.status === 'idle') {
      await this.initialize();
    }
    
    // Queue if still loading
    if (this.status === 'loading') {
      this.pendingExecutions.push({ code, id });
      return;
    }
    
    // Error state - can't run
    if (this.status === 'error') {
      throw new Error(this.error ?? 'Kernel in error state');
    }
    
    // Send to worker
    if (this.worker) {
      this.setStatus('running');
      this.worker.postMessage({ action: 'run', code, id });
    }
  }

  /**
   * Terminate the worker and reset state
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.status = 'idle';
    this.error = null;
    this.initPromise = null;
    this.messageCallbacks.clear();
    this.pendingExecutions = [];
  }

  /**
   * Restart the kernel (terminate and re-initialize)
   */
  async restart(): Promise<void> {
    this.terminate();
    await this.initialize();
  }
}

// Export singleton instance
export const pythonWorkerManager = new PythonWorkerManager();
