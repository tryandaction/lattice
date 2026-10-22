import { beforeEach, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HarnessExecutionTimeline } from '../harness-execution-timeline';
import { useAiHarnessStore } from '@/stores/ai-harness-store';
import { useAiChatStore } from '@/stores/ai-chat-store';
beforeEach(() => { useAiChatStore.setState({ activeConversationId: 'saved' }); useAiHarnessStore.setState({ sessions: {}, saved: {} }); });
it('shows persisted actual events without opening a native connection or reviving a running task', () => {
  useAiHarnessStore.setState({ saved: { saved: { engine: 'codex', workspace: 'C:/work', scratchPath: 'C:/scratch', sessionId: 's', events: [{ conversationId: 'saved', connectionId: 'old', sessionId: 's', turnId: 't', sequence: 1, timestamp: 1, kind: 'tool-complete', text: 'Actual fixture result' }] } } });
  render(<HarnessExecutionTimeline />);
  expect(screen.getByText(/已保存的历史记录/)).toBeTruthy();
  expect(screen.getByText(/Actual fixture result/)).toBeTruthy();
  expect(useAiHarnessStore.getState().connections).toEqual({});
});
