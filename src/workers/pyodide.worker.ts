/**
 * Pyodide Web Worker
 * 
 * Runs Python code in a dedicated Web Worker using Pyodide (Python compiled to WASM).
 * Handles initialization, code execution, and output capture including matplotlib plots.
 * 
 * Message Protocol:
 * - Inbound: { action: 'init' } | { action: 'run', code: string, id: string }
 * - Outbound: Various status, output, and result messages
 * 
 * NOTE: This file is for reference/documentation. The actual worker code is inlined
 * in python-worker-manager.ts to avoid bundling issues with Web Workers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const self: any;
declare function importScripts(...urls: string[]): void;

// Pyodide types (loaded dynamically)
interface PyodideInterface {
  loadPackage(packages: string[]): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
  runPython(code: string): unknown;
  globals: {
    set(name: string, value: unknown): void;
    get(name: string): unknown;
  };
}

declare function loadPyodide(config?: { indexURL?: string }): Promise<PyodideInterface>;

// Configuration
const PYODIDE_VERSION = '0.25.1';
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// State
let pyodide: PyodideInterface | null = null;
let isInitializing = false;

/**
 * Post a message to the main thread
 */
function postMsg(message: WorkerOutMessage): void {
  self.postMessage(message);
}

/**
 * Message types for communication with main thread
 */
type WorkerOutMessage =
  | { type: 'status'; status: 'loading' | 'ready' | 'error'; error?: string }
  | { type: 'stdout'; id: string; content: string }
  | { type: 'stderr'; id: string; content: string }
  | { type: 'image'; id: string; payload: string }
  | { type: 'result'; id: string; value: string }
  | { type: 'error'; id: string; error: string; traceback?: string };

/**
 * The matplotlib prologue script that:
 * 1. Configures matplotlib to use Agg backend (non-interactive)
 * 2. Monkey-patches plt.show() to capture figures as base64 PNG
 * 3. Sets up stdout capture
 */
const MATPLOTLIB_PROLOGUE = `
import sys
import io
import base64

# Custom stdout that sends to main thread
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

# Replace stdout/stderr
sys.stdout = _WorkerStdout()
sys.stderr = _WorkerStderr()

# Setup matplotlib with Agg backend
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
            if fig.get_axes():  # Only save if there are axes
                buf = io.BytesIO()
                fig.savefig(buf, format='png', bbox_inches='tight', dpi=100, 
                           facecolor='white', edgecolor='none')
                buf.seek(0)
                img_base64 = base64.b64encode(buf.read()).decode('utf-8')
                _send_image(f'data:image/png;base64,{img_base64}')
                buf.close()
            plt.clf()
            plt.close('all')
        
        plt.show = _patched_show
        
    except ImportError:
        pass  # matplotlib not loaded yet

_setup_matplotlib()
`;

/**
 * Initialize Pyodide runtime
 */
async function initializePyodide(): Promise<void> {
  if (pyodide || isInitializing) return;
  
  isInitializing = true;
  postMsg({ type: 'status', status: 'loading' });
  
  try {
    // Load Pyodide from CDN
    importScripts(`${PYODIDE_CDN}pyodide.js`);
    
    // Initialize Pyodide
    pyodide = await loadPyodide({
      indexURL: PYODIDE_CDN,
    });
    
    // Load scientific packages
    await pyodide.loadPackage(['numpy', 'pandas', 'matplotlib']);
    
    // Set up callback functions that Python can call
    let currentExecutionId = '';
    
    pyodide.globals.set('_send_stdout', (content: string) => {
      postMsg({ type: 'stdout', id: currentExecutionId, content });
    });
    
    pyodide.globals.set('_send_stderr', (content: string) => {
      postMsg({ type: 'stderr', id: currentExecutionId, content });
    });
    
    pyodide.globals.set('_send_image', (payload: string) => {
      postMsg({ type: 'image', id: currentExecutionId, payload });
    });
    
    pyodide.globals.set('_set_execution_id', (id: string) => {
      currentExecutionId = id;
    });
    
    // Run the prologue to set up matplotlib and stdout capture
    pyodide.runPython(MATPLOTLIB_PROLOGUE);
    
    isInitializing = false;
    postMsg({ type: 'status', status: 'ready' });
    
  } catch (error) {
    isInitializing = false;
    const errorMessage = error instanceof Error ? error.message : String(error);
    postMsg({ type: 'status', status: 'error', error: errorMessage });
  }
}

/**
 * Execute Python code
 */
async function runCode(code: string, id: string): Promise<void> {
  if (!pyodide) {
    postMsg({ 
      type: 'error', 
      id, 
      error: 'Pyodide not initialized',
    });
    return;
  }
  
  try {
    // Set the current execution ID for output correlation
    pyodide.runPython(`_set_execution_id("${id}")`);
    
    // Re-setup matplotlib in case it was imported fresh
    pyodide.runPython('_setup_matplotlib()');
    
    // Execute the user's code
    const result = await pyodide.runPythonAsync(code);
    
    // Flush any remaining output
    pyodide.runPython('sys.stdout.flush(); sys.stderr.flush()');
    
    // Send result if there is one (and it's not None)
    const resultStr = result !== undefined && result !== null 
      ? String(result) 
      : '';
    
    if (resultStr && resultStr !== 'None') {
      postMsg({ type: 'result', id, value: resultStr });
    } else {
      // Send empty result to signal completion
      postMsg({ type: 'result', id, value: '' });
    }
    
  } catch (error) {
    // Extract Python traceback if available
    let errorMessage = 'Unknown error';
    let traceback: string | undefined;
    
    if (error instanceof Error) {
      errorMessage = error.message;
      // Pyodide errors often have the traceback in the message
      if (errorMessage.includes('Traceback')) {
        const parts = errorMessage.split('\n');
        const tbIndex = parts.findIndex(p => p.includes('Traceback'));
        if (tbIndex >= 0) {
          traceback = parts.slice(tbIndex).join('\n');
          errorMessage = parts[parts.length - 1] || errorMessage;
        }
      }
    } else {
      errorMessage = String(error);
    }
    
    postMsg({ 
      type: 'error', 
      id, 
      error: errorMessage,
      traceback,
    });
  }
}

/**
 * Message handler
 */
self.onmessage = async (event: MessageEvent) => {
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
      
    default:
      console.warn('Unknown action:', action);
  }
};

// Export for type checking (not used at runtime)
export {};
