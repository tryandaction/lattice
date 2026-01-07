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

// Track installed packages to avoid redundant installs
const installedPackages = new Set(['numpy', 'pandas', 'matplotlib']);

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

// Common package name mappings (import name -> package name)
const PACKAGE_MAPPINGS = {
  'sklearn': 'scikit-learn',
  'cv2': 'opencv-python',
  'PIL': 'Pillow',
  'skimage': 'scikit-image',
};

// Packages available in Pyodide (can be loaded with loadPackage)
const PYODIDE_PACKAGES = new Set([
  'numpy', 'pandas', 'matplotlib', 'scipy', 'scikit-learn', 'sympy',
  'networkx', 'pillow', 'opencv-python', 'scikit-image', 'statsmodels',
  'seaborn', 'bokeh', 'sqlalchemy', 'beautifulsoup4', 'lxml', 'html5lib',
  'regex', 'pyyaml', 'jsonschema', 'packaging', 'pyparsing', 'pytz',
  'certifi', 'charset-normalizer', 'idna', 'urllib3', 'requests',
]);

/**
 * Extract import statements from Python code
 */
function extractImports(code) {
  const imports = new Set();
  
  // Match: import xxx, from xxx import yyy
  const importRegex = /^\\s*(?:import|from)\\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
  let match;
  
  while ((match = importRegex.exec(code)) !== null) {
    const moduleName = match[1];
    // Get the top-level package name
    const topLevel = moduleName.split('.')[0];
    imports.add(topLevel);
  }
  
  return Array.from(imports);
}

// Packages that are known to not work in Pyodide (browser environment)
const UNSUPPORTED_PACKAGES = new Set([
  'tensorflow', 'torch', 'pytorch', 'keras', 'jax',
  'multiprocessing', 'subprocess', 'os.fork',
  'psutil', 'pywin32', 'win32api',
]);

// Standard library modules that don't need installation
const STDLIB_MODULES = new Set([
  'os', 'sys', 'io', 'math', 'random', 'datetime', 'time', 'json',
  'collections', 'itertools', 'functools', 'operator', 'string',
  're', 'copy', 'types', 'typing', 'abc', 'contextlib', 'warnings',
  'decimal', 'fractions', 'statistics', 'cmath', 'numbers',
  'hashlib', 'hmac', 'secrets', 'base64', 'binascii', 'struct',
  'codecs', 'unicodedata', 'locale', 'gettext',
  'calendar', 'heapq', 'bisect', 'array', 'weakref',
  'enum', 'dataclasses', 'graphlib', 'pprint', 'reprlib', 'textwrap',
]);

/**
 * Check if a package is available and install if needed
 * Enhanced with better error handling, retry logic, and informative messages
 */
async function ensurePackagesInstalled(packages, id) {
  const toInstall = [];
  const unsupported = [];
  
  for (const pkg of packages) {
    // Skip if already installed
    if (installedPackages.has(pkg)) continue;
    
    // Skip standard library modules
    if (STDLIB_MODULES.has(pkg)) {
      installedPackages.add(pkg);
      continue;
    }
    
    // Map import name to package name if needed
    const packageName = PACKAGE_MAPPINGS[pkg] || pkg;
    
    // Check for unsupported packages
    if (UNSUPPORTED_PACKAGES.has(pkg.toLowerCase()) || UNSUPPORTED_PACKAGES.has(packageName.toLowerCase())) {
      unsupported.push(packageName);
      continue;
    }
    
    // Check if it's a standard library module by trying to import
    try {
      pyodide.runPython('import ' + pkg);
      installedPackages.add(pkg);
      continue;
    } catch (e) {
      // Not available, need to install
    }
    
    toInstall.push({ importName: pkg, packageName });
  }
  
  // Warn about unsupported packages
  if (unsupported.length > 0) {
    postMsg({ 
      type: 'stderr', 
      id, 
      content: '⚠️ Unsupported packages (not available in browser): ' + unsupported.join(', ') + '\\n' +
               '   These packages require native code or system access.\\n'
    });
  }
  
  if (toInstall.length === 0) return true;
  
  // Notify user about installing packages
  const packageNames = toInstall.map(p => p.packageName);
  postMsg({ 
    type: 'stdout', 
    id, 
    content: '📦 Installing packages: ' + packageNames.join(', ') + '...\\n' 
  });
  
  let micropip = null;
  
  try {
    // Load micropip if not already loaded
    await pyodide.loadPackage('micropip');
    micropip = pyodide.pyimport('micropip');
  } catch (error) {
    postMsg({ 
      type: 'stderr', 
      id, 
      content: '❌ Failed to initialize package installer: ' + (error.message || String(error)) + '\\n' +
               '   Try restarting the kernel.\\n'
    });
    return false;
  }
  
  let allSucceeded = true;
  const failedPackages = [];
  
  for (const { importName, packageName } of toInstall) {
    let installed = false;
    let lastError = null;
    
    // Retry logic with 2 attempts
    for (let attempt = 1; attempt <= 2 && !installed; attempt++) {
      try {
        // First try loadPackage for Pyodide-native packages (faster)
        if (PYODIDE_PACKAGES.has(packageName.toLowerCase())) {
          await pyodide.loadPackage(packageName.toLowerCase());
          installed = true;
        } else {
          // Use micropip for PyPI packages
          await micropip.install(packageName);
          installed = true;
        }
      } catch (installError) {
        lastError = installError;
        if (attempt < 2) {
          postMsg({ 
            type: 'stdout', 
            id, 
            content: '⟳ Retrying ' + packageName + '...\\n' 
          });
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
    
    if (installed) {
      installedPackages.add(importName);
      postMsg({ 
        type: 'stdout', 
        id, 
        content: '✓ Installed ' + packageName + '\\n' 
      });
    } else {
      allSucceeded = false;
      failedPackages.push(packageName);
      
      // Provide helpful error message based on error type
      let errorMsg = lastError?.message || String(lastError);
      let helpText = '';
      
      if (errorMsg.includes('404') || errorMsg.includes('not found')) {
        helpText = '   Package may not exist on PyPI or may have a different name.\\n';
      } else if (errorMsg.includes('network') || errorMsg.includes('fetch')) {
        helpText = '   Check your internet connection.\\n';
      } else if (errorMsg.includes('wheel') || errorMsg.includes('pure Python')) {
        helpText = '   Package requires native code and is not available in browser.\\n';
      }
      
      postMsg({ 
        type: 'stderr', 
        id, 
        content: '✗ Failed to install ' + packageName + ': ' + errorMsg + '\\n' + helpText
      });
    }
  }
  
  // Summary message if some packages failed
  if (!allSucceeded && failedPackages.length < toInstall.length) {
    postMsg({ 
      type: 'stdout', 
      id, 
      content: '⚠️ Some packages installed. Code may still run with limited functionality.\\n' 
    });
    // Continue execution even if some packages failed
    return true;
  }
  
  return allSucceeded;
}

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
    postMsg({ type: 'error', id, error: 'Python kernel not initialized. Please wait for initialization to complete.' });
    return;
  }
  
  try {
    pyodide.runPython('_set_execution_id("' + id + '")');
    pyodide.runPython('_setup_matplotlib()');
    
    // Extract and install required packages
    const requiredPackages = extractImports(code);
    const packagesReady = await ensurePackagesInstalled(requiredPackages, id);
    
    if (!packagesReady) {
      postMsg({ 
        type: 'error', 
        id, 
        error: 'Failed to install required packages. Check the output above for details.' 
      });
      return;
    }
    
    // Execute the user's code
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
      
      // Parse Python traceback for better error display
      if (errorMessage.includes('Traceback')) {
        const parts = errorMessage.split('\\n');
        const tbIndex = parts.findIndex(p => p.includes('Traceback'));
        if (tbIndex >= 0) {
          traceback = parts.slice(tbIndex).join('\\n');
          // Extract the actual error message (usually the last non-empty line)
          const errorLines = parts.filter(p => p.trim());
          errorMessage = errorLines[errorLines.length - 1] || errorMessage;
        }
      }
      
      // Provide helpful hints for common errors
      if (errorMessage.includes('ModuleNotFoundError') || errorMessage.includes('No module named')) {
        const moduleMatch = errorMessage.match(/No module named ['\"]?([^'\"\\s]+)['\"]?/);
        if (moduleMatch) {
          const moduleName = moduleMatch[1];
          if (UNSUPPORTED_PACKAGES.has(moduleName.toLowerCase())) {
            errorMessage += '\\n\\nThis package is not available in the browser environment.';
          } else {
            errorMessage += '\\n\\nTry adding an import statement at the top of your code.';
          }
        }
      } else if (errorMessage.includes('SyntaxError')) {
        errorMessage += '\\n\\nCheck your code for syntax issues like missing colons, brackets, or indentation.';
      } else if (errorMessage.includes('NameError')) {
        errorMessage += '\\n\\nMake sure the variable or function is defined before use.';
      } else if (errorMessage.includes('TypeError')) {
        errorMessage += '\\n\\nCheck that you are using the correct types for operations and function arguments.';
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
