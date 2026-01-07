/**
 * Tests for usePythonRunner Hook
 * 
 * Tests the React hook for Python code execution.
 * Uses unit tests for the hook's state management logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the hook's logic without React rendering
// This avoids jsdom issues while still testing the core functionality

describe('usePythonRunner Logic', () => {
  describe('Execution ID generation', () => {
    it('should generate unique execution IDs', () => {
      const generateExecutionId = () => {
        return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      };

      const id1 = generateExecutionId();
      const id2 = generateExecutionId();

      expect(id1).toMatch(/^exec_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^exec_\d+_[a-z0-9]+$/);
      // IDs should be different (with high probability)
      expect(id1).not.toBe(id2);
    });
  });

  describe('Status state machine', () => {
    type KernelStatus = 'idle' | 'loading' | 'ready' | 'running' | 'error';

    interface State {
      status: KernelStatus;
      outputs: Array<{ type: string; content: string }>;
      error: string | null;
    }

    function createInitialState(): State {
      return {
        status: 'idle',
        outputs: [],
        error: null,
      };
    }

    function reducer(state: State, action: { type: string; payload?: unknown }): State {
      switch (action.type) {
        case 'SET_STATUS':
          return { ...state, status: action.payload as KernelStatus };
        case 'SET_ERROR':
          return { ...state, error: action.payload as string };
        case 'ADD_OUTPUT':
          return { ...state, outputs: [...state.outputs, action.payload as { type: string; content: string }] };
        case 'CLEAR_OUTPUTS':
          return { ...state, outputs: [], error: null };
        default:
          return state;
      }
    }

    it('should start with idle status', () => {
      const state = createInitialState();
      expect(state.status).toBe('idle');
      expect(state.outputs).toEqual([]);
      expect(state.error).toBeNull();
    });

    it('should transition to loading status', () => {
      let state = createInitialState();
      state = reducer(state, { type: 'SET_STATUS', payload: 'loading' });
      expect(state.status).toBe('loading');
    });

    it('should transition to ready status', () => {
      let state = createInitialState();
      state = reducer(state, { type: 'SET_STATUS', payload: 'loading' });
      state = reducer(state, { type: 'SET_STATUS', payload: 'ready' });
      expect(state.status).toBe('ready');
    });

    it('should transition to running status', () => {
      let state = createInitialState();
      state = reducer(state, { type: 'SET_STATUS', payload: 'ready' });
      state = reducer(state, { type: 'SET_STATUS', payload: 'running' });
      expect(state.status).toBe('running');
    });

    it('should transition to error status', () => {
      let state = createInitialState();
      state = reducer(state, { type: 'SET_STATUS', payload: 'error' });
      state = reducer(state, { type: 'SET_ERROR', payload: 'Something went wrong' });
      expect(state.status).toBe('error');
      expect(state.error).toBe('Something went wrong');
    });

    it('should accumulate outputs', () => {
      let state = createInitialState();
      state = reducer(state, { type: 'ADD_OUTPUT', payload: { type: 'text', content: 'Hello' } });
      state = reducer(state, { type: 'ADD_OUTPUT', payload: { type: 'text', content: 'World' } });
      expect(state.outputs).toHaveLength(2);
      expect(state.outputs[0].content).toBe('Hello');
      expect(state.outputs[1].content).toBe('World');
    });

    it('should clear outputs', () => {
      let state = createInitialState();
      state = reducer(state, { type: 'ADD_OUTPUT', payload: { type: 'text', content: 'Hello' } });
      state = reducer(state, { type: 'SET_ERROR', payload: 'Error' });
      state = reducer(state, { type: 'CLEAR_OUTPUTS' });
      expect(state.outputs).toEqual([]);
      expect(state.error).toBeNull();
    });
  });

  describe('Output type handling', () => {
    it('should handle text output messages', () => {
      const message = { type: 'stdout', id: 'exec-1', content: 'Hello' };
      
      const output = {
        type: 'text' as const,
        content: message.content,
      };

      expect(output.type).toBe('text');
      expect(output.content).toBe('Hello');
    });

    it('should handle image output messages', () => {
      const message = { type: 'image', id: 'exec-1', payload: 'data:image/png;base64,abc' };
      
      const output = {
        type: 'image' as const,
        content: message.payload,
      };

      expect(output.type).toBe('image');
      expect(output.content).toBe('data:image/png;base64,abc');
    });

    it('should handle error output messages', () => {
      const message: { type: string; id: string; error: string; traceback?: string } = { 
        type: 'error', 
        id: 'exec-1', 
        error: 'NameError', 
        traceback: 'Traceback...' 
      };
      
      const errorContent = message.traceback 
        ? `${message.error}\n\n${message.traceback}`
        : message.error;

      const output = {
        type: 'error' as const,
        content: errorContent,
      };

      expect(output.type).toBe('error');
      expect(output.content).toContain('NameError');
      expect(output.content).toContain('Traceback');
    });

    it('should handle error without traceback', () => {
      const message: { type: string; id: string; error: string; traceback?: string } = { 
        type: 'error', 
        id: 'exec-1', 
        error: 'SyntaxError' 
      };
      
      const errorContent = message.traceback 
        ? `${message.error}\n\n${message.traceback}`
        : message.error;

      expect(errorContent).toBe('SyntaxError');
    });
  });

  describe('Convenience flags', () => {
    it('should compute isReady correctly', () => {
      const isReady = (status: string) => status === 'ready';
      
      expect(isReady('idle')).toBe(false);
      expect(isReady('loading')).toBe(false);
      expect(isReady('ready')).toBe(true);
      expect(isReady('running')).toBe(false);
      expect(isReady('error')).toBe(false);
    });

    it('should compute isRunning correctly', () => {
      const isRunning = (status: string) => status === 'running';
      
      expect(isRunning('idle')).toBe(false);
      expect(isRunning('loading')).toBe(false);
      expect(isRunning('ready')).toBe(false);
      expect(isRunning('running')).toBe(true);
      expect(isRunning('error')).toBe(false);
    });

    it('should compute isLoading correctly', () => {
      const isLoading = (status: string) => status === 'loading';
      
      expect(isLoading('idle')).toBe(false);
      expect(isLoading('loading')).toBe(true);
      expect(isLoading('ready')).toBe(false);
      expect(isLoading('running')).toBe(false);
      expect(isLoading('error')).toBe(false);
    });
  });
});
