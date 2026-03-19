/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
};

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => storage,
}));

import { useSelectionAiStore } from '../selection-ai-store';

describe('selection-ai-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSelectionAiStore.setState({
      preferredMode: 'chat',
      recentPrompts: [],
    });
  });

  it('remembers the preferred mode', () => {
    useSelectionAiStore.getState().setPreferredMode('agent');

    expect(useSelectionAiStore.getState().preferredMode).toBe('agent');
    expect(storage.set).toHaveBeenCalledWith(
      'lattice-selection-ai',
      expect.objectContaining({
        preferredMode: 'agent',
      }),
    );
  });

  it('deduplicates prompt history by mode and content', () => {
    useSelectionAiStore.getState().rememberPrompt('chat', 'Summarize this');
    useSelectionAiStore.getState().rememberPrompt('chat', 'Summarize this');
    useSelectionAiStore.getState().rememberPrompt('agent', 'Summarize this');

    expect(useSelectionAiStore.getState().recentPrompts).toHaveLength(2);
    expect(useSelectionAiStore.getState().recentPrompts[0]?.mode).toBe('agent');
  });

  it('caps recent prompts at eight entries', () => {
    const store = useSelectionAiStore.getState();
    for (let index = 0; index < 10; index += 1) {
      store.rememberPrompt('plan', `Prompt ${index}`);
    }

    expect(useSelectionAiStore.getState().recentPrompts).toHaveLength(8);
    expect(useSelectionAiStore.getState().recentPrompts[0]?.prompt).toBe('Prompt 9');
    expect(useSelectionAiStore.getState().recentPrompts.at(-1)?.prompt).toBe('Prompt 2');
  });
});
