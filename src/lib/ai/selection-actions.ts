import { aiOrchestrator } from './orchestrator';
import type { AiRuntimeSettings } from './types';
import { useAiChatStore } from '@/stores/ai-chat-store';
import { useAiWorkbenchStore } from '@/stores/ai-workbench-store';
import type { SelectionAiMode, SelectionContext } from './selection-context';
import { defaultPromptForSelectionMode } from './selection-context';
import { buildSelectionOrigin } from './selection-ui';

function buildExecutionPrompt(mode: SelectionAiMode, prompt: string, context: SelectionContext): string {
  const normalizedPrompt = prompt.trim() || defaultPromptForSelectionMode(mode, context);
  const parts = [
    normalizedPrompt,
    `Selected excerpt from ${context.sourceLabel}:`,
    context.selectedText,
  ];

  if (context.contextText) {
    parts.push(`Local context:\n${context.contextText}`);
  }

  if (mode === 'agent') {
    parts.unshift('Act as a research agent. Be evidence-first and return structured output with Conclusion, Evidence, Next Actions.');
  }

  if (mode === 'plan') {
    parts.unshift('Create a safe, user-reviewable plan based on this selected content.');
  }

  return parts.join('\n\n');
}

export async function runSelectionAiMode(input: {
  context: SelectionContext;
  mode: SelectionAiMode;
  prompt: string;
  settings: AiRuntimeSettings;
}): Promise<{ kind: 'chat' | 'proposal'; title: string }> {
  if (!input.settings.aiEnabled) {
    throw new Error('AI is disabled in settings');
  }

  const prompt = buildExecutionPrompt(input.mode, input.prompt, input.context);
  const origin = buildSelectionOrigin(input.context, input.mode);
  const chatStore = useAiChatStore.getState();
  const workbenchStore = useAiWorkbenchStore.getState();

  if (input.mode === 'plan') {
    const proposal = await aiOrchestrator.proposeTask({
      prompt,
      filePath: input.context.filePath,
      content: input.context.contextText || input.context.selectedText,
      selection: input.context.selectedText,
      explicitEvidenceRefs: input.context.evidenceRefs,
      settings: input.settings,
    });
    workbenchStore.addProposal({
      ...proposal,
      origin,
    });
    chatStore.setOpen(true);
    return { kind: 'proposal', title: proposal.summary };
  }

  const historyBefore = chatStore.getMessagesForApi();
  const displayPrompt = input.prompt.trim() || defaultPromptForSelectionMode(input.mode, input.context);
  chatStore.setOpen(true);
  chatStore.addUserMessage(displayPrompt, { origin });
  const messageId = chatStore.startAssistantMessage();
  const controller = new AbortController();
  chatStore.setGenerating(true, controller);

  try {
    const result = await aiOrchestrator.runChat({
      prompt,
      history: historyBefore,
      settings: input.settings,
      filePath: input.context.filePath,
      content: input.context.contextText || input.context.selectedText,
      selection: input.context.selectedText,
      explicitEvidenceRefs: input.context.evidenceRefs,
    });

    if (controller.signal.aborted) {
      chatStore.finishAssistantMessage(messageId);
      return { kind: 'chat', title: displayPrompt };
    }

    chatStore.appendToAssistantMessage(messageId, result.text);
    chatStore.finishAssistantMessage(messageId);
    chatStore.setAssistantMetadata(messageId, {
      model: result.model,
      evidenceRefs: result.evidenceRefs,
      promptContext: result.context,
      followUpActions: result.followUpActions,
      draftSuggestion: result.draftSuggestion,
      origin,
    });
    return { kind: 'chat', title: displayPrompt };
  } catch (error) {
    chatStore.setAssistantError(messageId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
