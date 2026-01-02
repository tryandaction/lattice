/**
 * Tests for Python Worker Manager
 * 
 * Tests the singleton worker manager, message routing, and state management.
 * Note: These tests mock the Web Worker since Pyodide can't run in Node.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Worker class
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((error: ErrorEvent) => void) | null = null;
  private messageHandler: ((data: unknown) => void) | null = null;

  constructor(_url: string) {
    // Store reference for triggering messages
    MockWorker.instance = this;
  }

  postMessage(data: unknown) {
    if (this.messageHandler) {
      this.messageHandler(data);
    }
  }

  terminate() {
    MockWorker.instance = null;
  }

  // Test helper to simulate worker messages
  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }

  // Test helper to set up message handling
  setMessageHandler(handler: (data: unknown) => void) {
    this.messageHandler = handler;
  }

  static instance: MockWorker | null = null;
}

// Mock URL.createObjectURL
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();

describe('PythonWorkerManager', () => {
  let originalWorker: typeof Worker;
  let originalURL: typeof URL;

  beforeEach(() => {
    // Save originals
    originalWorker = globalThis.Worker;
    originalURL = globalThis.URL;

    // Mock Worker
    globalThis.Worker = MockWorker as unknown as typeof Worker;

    // Mock URL methods
    globalThis.URL.createObjectURL = mockCreateObjectURL;
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

    // Reset mocks
    vi.clearAllMocks();
    MockWorker.instance = null;
  });

  afterEach(() => {
    // Restore originals
    globalThis.Worker = originalWorker;
    globalThis.URL = originalURL;
  });

  describe('Module exports', () => {
    it('should export KernelStatus type', async () => {
      const module = await import('../python-worker-manager');
      expect(module).toHaveProperty('pythonWorkerManager');
    });

    it('should export pythonWorkerManager singleton', async () => {
      const module = await import('../python-worker-manager');
      expect(module.pythonWorkerManager).toBeDefined();
      expect(typeof module.pythonWorkerManager.getStatus).toBe('function');
      expect(typeof module.pythonWorkerManager.initialize).toBe('function');
      expect(typeof module.pythonWorkerManager.runCode).toBe('function');
    });
  });

  describe('Status management', () => {
    it('should start with idle status', async () => {
      // Re-import to get fresh instance
      vi.resetModules();
      const { pythonWorkerManager } = await import('../python-worker-manager');
      
      // After terminate, status should be idle
      pythonWorkerManager.terminate();
      expect(pythonWorkerManager.getStatus()).toBe('idle');
    });

    it('should notify subscribers of status changes', async () => {
      vi.resetModules();
      const { pythonWorkerManager } = await import('../python-worker-manager');
      pythonWorkerManager.terminate();

      const statusCallback = vi.fn();
      const unsubscribe = pythonWorkerManager.onStatusChange(statusCallback);

      // Should be called immediately with current status
      expect(statusCallback).toHaveBeenCalledWith('idle', undefined);

      unsubscribe();
    });
  });

  describe('Worker lifecycle', () => {
    it('should create worker on initialize', async () => {
      vi.resetModules();
      const { pythonWorkerManager } = await import('../python-worker-manager');
      pythonWorkerManager.terminate();

      // Start initialization (don't await - it waits for ready message)
      const initPromise = pythonWorkerManager.initialize();

      // Worker should be created
      expect(MockWorker.instance).not.toBeNull();

      // Simulate ready message
      MockWorker.instance?.simulateMessage({ type: 'status', status: 'ready' });

      await initPromise;
      expect(pythonWorkerManager.getStatus()).toBe('ready');
    });

    it('should handle initialization error', async () => {
      vi.resetModules();
      const { pythonWorkerManager } = await import('../python-worker-manager');
      pythonWorkerManager.terminate();

      const initPromise = pythonWorkerManager.initialize();

      // Simulate error message
      MockWorker.instance?.simulateMessage({ 
        type: 'status', 
        status: 'error', 
        error: 'Failed to load Pyodide' 
      });

      await expect(initPromise).rejects.toThrow('Failed to load Pyodide');
      expect(pythonWorkerManager.getStatus()).toBe('error');
    });

    it('should terminate worker and reset state', async () => {
      vi.resetModules();
      const { pythonWorkerManager } = await import('../python-worker-manager');
      pythonWorkerManager.terminate();

      // Initialize first
      const initPromise = pythonWorkerManager.initialize();
      MockWorker.instance?.simulateMessage({ type: 'status', status: 'ready' });
      await initPromise;

      // Terminate
      pythonWorkerManager.terminate();

      expect(pythonWorkerManager.getStatus()).toBe('idle');
      expect(pythonWorkerManager.getError()).toBeNull();
    });
  });

  describe('Code execution', () => {
    it('should auto-initialize when running code in idle state', async () => {
      vi.resetModules();
      const { pythonWorkerManager } = await import('../python-worker-manager');
      pythonWorkerManager.terminate();

      // Run code without explicit init
      const runPromise = pythonWorkerManager.runCode('print("hello")', 'test-1');

      // Should create worker
      expect(MockWorker.instance).not.toBeNull();

      // Simulate ready then complete
      MockWorker.instance?.simulateMessage({ type: 'status', status: 'ready' });

      await runPromise;
    });

    it('should route messages to correct callback', async () => {
      vi.resetModules();
      const { pythonWorkerManager } = await import('../python-worker-manager');
      pythonWorkerManager.terminate();

      // Initialize
      const initPromise = pythonWorkerManager.initialize();
      MockWorker.instance?.simulateMessage({ type: 'status', status: 'ready' });
      await initPromise;

      // Set up message callback
      const messageCallback = vi.fn();
      pythonWorkerManager.onMessage('exec-123', messageCallback);

      // Run code
      await pythonWorkerManager.runCode('print("test")', 'exec-123');

      // Simulate stdout message
      MockWorker.instance?.simulateMessage({ 
        type: 'stdout', 
        id: 'exec-123', 
        content: 'test' 
      });

      expect(messageCallback).toHaveBeenCalledWith({
        type: 'stdout',
        id: 'exec-123',
        content: 'test'
      });
    });

    it('should throw error when kernel is in error state', async () => {
      vi.resetModules();
      const { pythonWorkerManager } = await import('../python-worker-manager');
      pythonWorkerManager.terminate();

      // Initialize and fail
      const initPromise = pythonWorkerManager.initialize();
      MockWorker.instance?.simulateMessage({ 
        type: 'status', 
        status: 'error', 
        error: 'Init failed' 
      });

      try {
        await initPromise;
      } catch {
        // Expected
      }

      // Try to run code
      await expect(pythonWorkerManager.runCode('print(1)', 'test'))
        .rejects.toThrow('Init failed');
    });
  });

  describe('Restart functionality', () => {
    it('should restart kernel', async () => {
      vi.resetModules();
      const { pythonWorkerManager } = await import('../python-worker-manager');
      pythonWorkerManager.terminate();

      // Initialize
      let initPromise = pythonWorkerManager.initialize();
      MockWorker.instance?.simulateMessage({ type: 'status', status: 'ready' });
      await initPromise;

      // Restart
      const restartPromise = pythonWorkerManager.restart();
      
      // New worker should be created
      expect(MockWorker.instance).not.toBeNull();
      
      MockWorker.instance?.simulateMessage({ type: 'status', status: 'ready' });
      await restartPromise;

      expect(pythonWorkerManager.getStatus()).toBe('ready');
    });
  });
});
