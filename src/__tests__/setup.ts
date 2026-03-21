/**
 * Vitest 测试环境设置
 */

import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// 每个测试后自动清理
afterEach(() => {
  cleanup();
});

// 全局测试配置
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock window.matchMedia
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}

// Mock Web Worker for Pyodide tests
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((error: ErrorEvent) => void) | null = null;
  private messageHandlers: Set<(event: MessageEvent) => void> = new Set();

  constructor(scriptURL: string | URL) {
    // Simulate async worker initialization
    setTimeout(() => {
      this.postMessage({ action: 'init' });
    }, 0);
  }

  postMessage(message: any) {
    // Simulate worker responses based on message type
    setTimeout(() => {
      if (message.action === 'init') {
        this.simulateMessage({ type: 'status', status: 'loading' });
        setTimeout(() => {
          this.simulateMessage({ type: 'status', status: 'ready' });
        }, 100);
      } else if (message.action === 'run') {
        const { code, id } = message;
        this.simulateCodeExecution(code, id);
      }
    }, 0);
  }

  private variables: Record<string, any> = {};

  private simulateCodeExecution(code: string, id: string) {
    // Simulate different code execution scenarios

    // Handle variable assignments
    const assignMatch = code.match(/^(\w+)\s*=\s*(.+)$/m);
    if (assignMatch) {
      const [, varName, value] = assignMatch;
      // Store with type information
      if (value.match(/^\d+$/)) {
        this.variables[varName] = { name: varName, type: 'int', value: value, size: 28 };
      } else if (value.match(/^["'].*["']$/)) {
        this.variables[varName] = { name: varName, type: 'str', value: value.replace(/["']/g, ''), size: 54 };
      } else {
        this.variables[varName] = { name: varName, type: 'object', value: String(value), size: 48 };
      }
    }

    // Handle multi-line code with print
    if (code.includes('x = 10') && code.includes('y = 20') && code.includes('print(x + y)')) {
      this.simulateMessage({ type: 'stdout', id, content: '30\n' });
    } else if (code.includes('print(')) {
      const match = code.match(/print\((.*?)\)/);
      if (match) {
        const content = match[1].replace(/['"]/g, '');
        this.simulateMessage({ type: 'stdout', id, content: content + '\n' });
      }
    }

    if (code.includes('1 / 0')) {
      this.simulateMessage({
        type: 'error',
        id,
        error: 'ZeroDivisionError: division by zero',
        traceback: 'Traceback (most recent call last):\n  File "<exec>", line 1, in <module>\nZeroDivisionError: division by zero'
      });
    } else if (code.includes('undefined_variable')) {
      this.simulateMessage({
        type: 'error',
        id,
        error: "NameError: name 'undefined_variable' is not defined",
        traceback: "Traceback (most recent call last):\n  File \"<exec>\", line 1, in <module>\nNameError: name 'undefined_variable' is not defined"
      });
    } else if (code.includes('print("missing quote)')) {
      this.simulateMessage({
        type: 'error',
        id,
        error: 'SyntaxError: unterminated string literal',
        traceback: 'Traceback (most recent call last):\n  File "<exec>", line 1\n    print("missing quote)\nSyntaxError: unterminated string literal'
      });
    } else if (code.match(/^\d+\s*[\+\-\*\/]\s*\d+$/)) {
      // Simple math expression
      try {
        const result = eval(code);
        this.simulateMessage({ type: 'result', id, value: String(result) });
      } catch (e) {
        this.simulateMessage({ type: 'error', id, error: String(e) });
      }
    } else if (code.includes('json.dumps(get_variables())')) {
      // Variable inspection - return current variables
      const varsJson = JSON.stringify(this.variables);
      this.simulateMessage({ type: 'stdout', id, content: varsJson + '\n' });
    }

    // Always send execution complete
    setTimeout(() => {
      this.simulateMessage({ type: 'execution_complete', id, executionTime: 10, timestamp: Date.now() });
    }, 50);
  }

  private simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === 'message') {
      this.messageHandlers.add(listener);
    }
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === 'message') {
      this.messageHandlers.delete(listener);
    }
  }

  terminate() {
    this.onmessage = null;
    this.onerror = null;
    this.messageHandlers.clear();
    this.variables = {}; // Clear variables on terminate
  }
}

// @ts-ignore
global.Worker = MockWorker;
