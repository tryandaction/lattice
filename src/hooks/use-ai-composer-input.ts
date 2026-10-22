'use client';

import { useCallback } from 'react';
import { useAiChatStore } from '@/stores/ai-chat-store';

/** Ordinary input is per conversation; external composer commands remain one-shot. */
export function useAiComposerInput(): [string, (value: string | ((current: string) => string)) => void] {
  const input = useAiChatStore(state => state.conversations.find(item => item.id === state.activeConversationId)?.draft?.text ?? '');
  const setInput = useCallback((value: string | ((current: string) => string)) => {
    const state = useAiChatStore.getState();
    const current = state.getConversationDraft();
    const text = typeof value === 'function' ? value(current?.text ?? '') : value;
    state.setConversationDraft(text ? { ...current, text, mode: state.composerMode, submit: false } : null, state.activeConversationId ?? undefined);
  }, []);
  return [input, setInput];
}
