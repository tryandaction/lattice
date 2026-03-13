/**
 * Pyodide Web Worker
 *
 * Runs Python code in a dedicated Web Worker using Pyodide (Python compiled to WASM).
 * Handles initialization, code execution, and output capture including matplotlib plots.
 *
 * Features:
 * - Auto-detection and installation of missing packages
 * - Support for scipy, scikit-learn, and other Pyodide packages
 * - Matplotlib plot capture as base64 PNG
 * - stdout/stderr capture and routing
 *
 * Message Protocol:
 * - Inbound: { action: 'init' } | { action: 'run', code: string, id: string }
 * - Outbound: Various status, output, and result messages
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const self: any;
declare function importScripts(...urls: string[]): void;

// Add global error handlers
self.addEventListener('error', function(e: ErrorEvent) {
  console.error('Worker global error:', e.message, e.filename, e.lineno, e.colno);
  self.postMessage({
    type: 'status',
    status: 'error',
    error: 'Worker script error: ' + e.message + ' at ' + e.filename + ':' + e.lineno
  });
});

self.addEventListener('unhandledrejection', function(e: PromiseRejectionEvent) {
  console.error('Worker unhandled rejection:', e.reason);
  self.postMessage({
    type: 'status',
    status: 'error',
    error: 'Worker promise rejection: ' + (e.reason ? e.reason.message || e.reason : 'Unknown')
  });
});

// Pyodide types (loaded dynamically)
interface PyodideInterface {
  loadPackage(packages: string | string[]): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
  runPython(code: string): unknown;
  pyimport(name: string): any;
  globals: {
    set(name: string, value: unknown): void;
    get(name: string): unknown;
    delete(name: string): void;
  };
}

declare function loadPyodide(config?: { indexURL?: string }): Promise<PyodideInterface>;

// Configuration
const PYODIDE_VERSION = '0.25.1';
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// State
let pyodide: PyodideInterface | null = null;
let isInitializing = false;

// Track installed packages to avoid redundant installs
const installedPackages = new Set(['numpy', 'pandas', 'matplotlib']);

// Common package name mappings (import name -> package name)
const PACKAGE_MAPPINGS: Record<string, string> = {
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
  | { type: 'html'; id: string; payload: string }
  | { type: 'svg'; id: string; payload: string }
  | { type: 'result'; id: string; value: string }
  | { type: 'execution_complete'; id: string; executionTime: number; timestamp: number }
  | { type: 'error'; id: string; error: string; traceback?: string };

/**
 * The matplotlib prologue script that:
 * 1. Configures matplotlib to use Agg backend (non-interactive)
 * 2. Monkey-patches plt.show() to capture figures as base64 PNG
 * 3. Sets up stdout capture using js module for safe string passing
 * 4. Provides IPython.display compatibility layer
 */
const MATPLOTLIB_PROLOGUE = `
import sys
import io
import base64
import js

# Use a global buffer object that JavaScript can access
class _OutputBuffer:
    def __init__(self):
        self.stdout_buffer = []
        self.stderr_buffer = []

    def write_stdout(self, text):
        if text:
            self.stdout_buffer.append(text)

    def write_stderr(self, text):
        if text:
            self.stderr_buffer.append(text)

    def flush_stdout(self):
        if self.stdout_buffer:
            content = ''.join(self.stdout_buffer)
            self.stdout_buffer = []
            return content
        return ''

    def flush_stderr(self):
        if self.stderr_buffer:
            content = ''.join(self.stderr_buffer)
            self.stderr_buffer = []
            return content
        return ''

_output_buffer = _OutputBuffer()

class _WorkerStdout:
    def write(self, text):
        if text:
            _output_buffer.write_stdout(text)

    def flush(self):
        content = _output_buffer.flush_stdout()
        if content:
            js._send_stdout_safe(content)

class _WorkerStderr:
    def write(self, text):
        if text:
            _output_buffer.write_stderr(text)

    def flush(self):
        content = _output_buffer.flush_stderr()
        if content:
            js._send_stderr_safe(content)

sys.stdout = _WorkerStdout()
sys.stderr = _WorkerStderr()

# IPython compatibility layer
class IPython:
    """Minimal IPython compatibility layer for Pyodide"""

    class display:
        """IPython.display module compatibility"""

        @staticmethod
        def HTML(data):
            """Display HTML content"""
            if isinstance(data, str):
                js._send_html_safe(data)
            return data

        @staticmethod
        def display(*objs, **kwargs):
            """Display objects"""
            for obj in objs:
                if hasattr(obj, '_repr_html_'):
                    try:
                        html = obj._repr_html_()
                        if html:
                            js._send_html_safe(html)
                            continue
                    except Exception:
                        pass
                if hasattr(obj, '_repr_svg_'):
                    try:
                        svg = obj._repr_svg_()
                        if svg:
                            js._send_svg_safe(svg)
                            continue
                    except Exception:
                        pass
                if hasattr(obj, '_repr_png_'):
                    try:
                        png = obj._repr_png_()
                        if png:
                            js._send_image_safe('data:image/png;base64,' + base64.b64encode(png).decode())
                            continue
                    except Exception:
                        pass
                try:
                    if hasattr(obj, 'to_html'):
                        js._send_html_safe(obj.to_html(full_html=False, include_plotlyjs='cdn'))
                        continue
                except Exception:
                    pass
                try:
                    output = str(obj)
                    js._send_stdout_safe(output + '\\n')
                except Exception:
                    js._send_stdout_safe('[Object representation unavailable]\\n')

        @staticmethod
        def Image(data=None, url=None, filename=None, format=None, embed=None, width=None, height=None):
            """Display an image"""
            if data:
                if isinstance(data, bytes):
                    img_base64 = base64.b64encode(data).decode('utf-8')
                    js._send_image_safe(f'data:image/png;base64,{img_base64}')
                elif isinstance(data, str):
                    js._send_image_safe(data)
            elif url:
                js._send_html_safe(f'<img src="{url}" />')
            return None

        @staticmethod
        def SVG(data):
            """Display SVG content"""
            if isinstance(data, str):
                js._send_svg_safe(data)
            return data

        @staticmethod
        def Markdown(data):
            """Display Markdown (rendered as HTML)"""
            # Simple markdown to HTML conversion
            if isinstance(data, str):
                js._send_html_safe(f'<div class="markdown">{data}</div>')
            return data

# Make IPython available globally
import sys
sys.modules['IPython'] = IPython
sys.modules['IPython.display'] = IPython.display

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
                js._send_image_safe('data:image/png;base64,' + img_base64)
                buf.close()
            plt.clf()
            plt.close('all')

        plt.show = _patched_show

    except ImportError:
        pass

_setup_matplotlib()

def display(*objs, **kwargs):
    """Global display function compatible with IPython"""
    IPython.display.display(*objs, **kwargs)

import builtins as _builtins
_builtins.display = display
`;

/**
 * Extract import statements from Python code
 */
function extractImports(code: string): string[] {
  const imports = new Set<string>();
  
  // Match: import xxx, from xxx import yyy
  const importRegex = /^\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
  let match;
  
  while ((match = importRegex.exec(code)) !== null) {
    const moduleName = match[1];
    // Get the top-level package name
    const topLevel = moduleName.split('.')[0];
    imports.add(topLevel);
  }
  
  return Array.from(imports);
}

/**
 * Check if packages are available and install if needed
 */
async function ensurePackagesInstalled(packages: string[], id: string): Promise<boolean> {
  if (!pyodide) return false;

  const toInstall: Array<{ importName: string; packageName: string }> = [];
  const unsupported: string[] = [];

  // Packages that are not supported in Pyodide
  const UNSUPPORTED_PACKAGES = new Set([
    'tensorflow', 'torch', 'pytorch', 'keras', 'jax',
    'multiprocessing', 'subprocess', 'os.fork',
    'psutil', 'pywin32', 'win32api',
    // Note: IPython is now provided by compatibility layer, not blocked
  ]);

  // Standard library modules
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

  for (const pkg of packages) {
    // Skip if already installed
    if (installedPackages.has(pkg)) continue;

    // IPython is provided by our compatibility layer
    if (pkg.toLowerCase() === 'ipython') {
      installedPackages.add(pkg);
      continue;
    }

    // Check if it's a standard library module
    if (STDLIB_MODULES.has(pkg)) {
      installedPackages.add(pkg);
      continue;
    }

    // Map import name to package name if needed
    const packageName = PACKAGE_MAPPINGS[pkg] || pkg;

    // Check if unsupported
    if (UNSUPPORTED_PACKAGES.has(pkg.toLowerCase()) || UNSUPPORTED_PACKAGES.has(packageName.toLowerCase())) {
      unsupported.push(packageName);
      continue;
    }

    // Check if it's already available
    try {
      pyodide.runPython(`import ${pkg}`);
      installedPackages.add(pkg);
      continue;
    } catch {
      // Not available, need to install
    }

    toInstall.push({ importName: pkg, packageName });
  }

  // Warn about unsupported packages
  if (unsupported.length > 0) {
    postMsg({
      type: 'stderr',
      id,
      content: `⚠️ Unsupported packages (not available in browser): ${unsupported.join(', ')}\n   These packages require native code or system access.\n`
    });
  }

  if (toInstall.length === 0) return true;

  // Notify user about installing packages
  const packageNames = toInstall.map(p => p.packageName);
  postMsg({
    type: 'stdout',
    id,
    content: `📦 Installing packages: ${packageNames.join(', ')}...\n`
  });

  let micropip: any = null;

  try {
    // Load micropip if not already loaded
    await pyodide.loadPackage('micropip');
    micropip = pyodide.pyimport('micropip');
  } catch (error) {
    postMsg({
      type: 'stderr',
      id,
      content: `❌ Failed to initialize package installer: ${error instanceof Error ? error.message : String(error)}\n`
    });
    return false;
  }

  let allSucceeded = true;

  for (const { importName, packageName } of toInstall) {
    let installed = false;
    let lastError: any = null;

    // Try up to 2 times
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
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    if (installed) {
      installedPackages.add(importName);
      postMsg({
        type: 'stdout',
        id,
        content: `✓ Installed ${packageName}\n`
      });
    } else {
      allSucceeded = false;
      postMsg({
        type: 'stderr',
        id,
        content: `✗ Failed to install ${packageName}\n`
      });
    }
  }

  return allSucceeded;
}

/**
 * Initialize Pyodide runtime
 */
async function initializePyodide(): Promise<void> {
  if (pyodide || isInitializing) return;

  isInitializing = true;
  postMsg({ type: 'status', status: 'loading' });

  try {
    // Load Pyodide script
    try {
      importScripts(`${PYODIDE_CDN}pyodide.js`);
    } catch (scriptError) {
      throw new Error('Failed to load Pyodide script from CDN: ' + (scriptError instanceof Error ? scriptError.message : String(scriptError)));
    }

    // Initialize Pyodide
    try {
      pyodide = await loadPyodide({
        indexURL: PYODIDE_CDN,
      });
    } catch (loadError) {
      throw new Error('Failed to initialize Pyodide: ' + (loadError instanceof Error ? loadError.message : String(loadError)));
    }

    // Load scientific packages
    try {
      await pyodide.loadPackage(['numpy', 'pandas', 'matplotlib']);
    } catch (packageError) {
      throw new Error('Failed to load scientific packages: ' + (packageError instanceof Error ? packageError.message : String(packageError)));
    }

    // Set up callback functions that Python can call
    let currentExecutionId = '';

    // Create safe wrapper functions that use globals.set
    pyodide.globals.set('_send_stdout_safe', (content: string) => {
      postMsg({ type: 'stdout', id: currentExecutionId, content: String(content) });
    });

    pyodide.globals.set('_send_stderr_safe', (content: string) => {
      postMsg({ type: 'stderr', id: currentExecutionId, content: String(content) });
    });

    pyodide.globals.set('_send_image_safe', (payload: string) => {
      postMsg({ type: 'image', id: currentExecutionId, payload: String(payload) });
    });

    pyodide.globals.set('_send_html_safe', (payload: string) => {
      postMsg({ type: 'html', id: currentExecutionId, payload: String(payload) });
    });

    pyodide.globals.set('_send_svg_safe', (payload: string) => {
      postMsg({ type: 'svg', id: currentExecutionId, payload: String(payload) });
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

  const startTime = Date.now();

  try {
    // Set the current execution ID for output correlation
    pyodide.globals.set('_current_id', id);
    pyodide.runPython('_set_execution_id(_current_id)');

    // Re-setup matplotlib in case it was imported fresh
    pyodide.runPython('_setup_matplotlib()');

    // Extract and install required packages
    const requiredPackages = extractImports(code);
    const packagesReady = await ensurePackagesInstalled(requiredPackages, id);

    if (!packagesReady) {
      postMsg({
        type: 'error',
        id,
        error: 'Failed to install required packages'
      });
      postMsg({
        type: 'execution_complete',
        id,
        executionTime: Date.now() - startTime,
        timestamp: Date.now()
      });
      return;
    }

    // Execute the user's code
    const result = await pyodide.runPythonAsync(code);

    // Flush any remaining output
    pyodide.runPython('sys.stdout.flush(); sys.stderr.flush()');

    // Send result if there is one (and it's not None)
    if (result !== undefined && result !== null) {
      try {
        // Try to use display function for rich output
        pyodide.globals.set('_exec_result', result);
        pyodide.runPython('display(_exec_result)');
        pyodide.globals.delete('_exec_result');
      } catch {
        // Fallback to string representation
        const resultStr = String(result);
        if (resultStr && resultStr !== 'None') {
          postMsg({ type: 'result', id, value: resultStr });
        }
      }
    }

    postMsg({
      type: 'execution_complete',
      id,
      executionTime: Date.now() - startTime,
      timestamp: Date.now()
    });

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
          // Get the last non-empty line as the error message
          const errorLines = parts.filter(p => p.trim());
          errorMessage = errorLines[errorLines.length - 1] || errorMessage;
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

    postMsg({
      type: 'execution_complete',
      id,
      executionTime: Date.now() - startTime,
      timestamp: Date.now()
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
