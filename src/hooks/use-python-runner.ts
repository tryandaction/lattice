/**
 * usePythonRunner Hook
 * 
 * React hook for managing Python code execution via the Pyodide Web Worker.
 * Provides a state machine for kernel status and collects execution outputs.
 */

"use client";

import { useState, useCallback, useEffect, useRef } from 'react';
import { 
  pythonWorkerManager, 
  type KernelStatus, 
  type ExecutionOutput,
  type WorkerOutMessage 
} from '@/lib/python-worker-manager';

export interface UsePythonRunnerReturn {
  /** Current kernel status */
  status: KernelStatus;
  /** Collected outputs from the current/last execution */
  outputs: ExecutionOutput[];
  /** Error message if status is 'error' */
  error: string | null;
  /** Execute Python code */
  runCode: (code: string) => Promise<void>;
  /** Clear all outputs */
  clearOutputs: () => void;
  /** Convenience: true if status is 'ready' */
  isReady: boolean;
  /** Convenience: true if status is 'running' */
  isRunning: boolean;
  /** Convenience: true if status is 'loading' */
  isLoading: boolean;
}

/**
 * Generate a unique execution ID
 */
function generateExecutionId(): string {
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Hook for running Python code via Pyodide
 */
export function usePythonRunner(): UsePythonRunnerReturn {
  const [status, setStatus] = useState<KernelStatus>(() => pythonWorkerManager.getStatus());
  const [outputs, setOutputs] = useState<ExecutionOutput[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Track current execution ID
  const currentExecutionId = useRef<string | null>(null);
  
  // Subscribe to status changes
  useEffect(() => {
    const unsubscribe = pythonWorkerManager.onStatusChange((newStatus, newError) => {
      setStatus(newStatus);
      if (newError) {
        setError(newError);
      }
    });
    
    return unsubscribe;
  }, []);
  
  /**
   * Clear all outputs
   */
  const clearOutputs = useCallback(() => {
    setOutputs([]);
    setError(null);
  }, []);
  
  /**
   * Run Python code
   */
  const runCode = useCallback(async (code: string) => {
    // Clear previous outputs
    setOutputs([]);
    setError(null);
    
    // Generate execution ID
    const executionId = generateExecutionId();
    currentExecutionId.current = executionId;
    
    // Set up message handler for this execution
    pythonWorkerManager.onMessage(executionId, (message: WorkerOutMessage) => {
      // Only process messages that have an id matching current execution
      if ('id' in message && message.id !== currentExecutionId.current) return;
      
      switch (message.type) {
        case 'stdout':
          setOutputs(prev => [...prev, { type: 'text', content: message.content }]);
          break;
          
        case 'stderr':
          setOutputs(prev => [...prev, { type: 'text', content: message.content }]);
          break;
          
        case 'image':
          setOutputs(prev => [...prev, { type: 'image', content: message.payload }]);
          break;

        case 'html':
          setOutputs(prev => [...prev, { type: 'html', content: message.payload }]);
          break;

        case 'svg':
          setOutputs(prev => [...prev, { type: 'svg', content: message.payload }]);
          break;

        case 'result':
          if (message.value) {
            setOutputs(prev => [...prev, { type: 'text', content: message.value }]);
          }
          break;
          
        case 'error':
          if ('error' in message) {
            const errorContent = message.traceback 
              ? `${message.error}\n\n${message.traceback}`
              : message.error;
            setOutputs(prev => [...prev, { type: 'error', content: errorContent }]);
            setError(message.error);
          }
          break;
      }
    });
    
    try {
      await pythonWorkerManager.runCode(code, executionId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setOutputs(prev => [...prev, { type: 'error', content: errorMessage }]);
    }
  }, []);
  
  return {
    status,
    outputs,
    error,
    runCode,
    clearOutputs,
    isReady: status === 'ready',
    isRunning: status === 'running',
    isLoading: status === 'loading',
  };
}

export default usePythonRunner;
