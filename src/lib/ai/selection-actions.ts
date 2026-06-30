import { aiOrchestrator } from './orchestrator';
import type { AiRuntimeSettings } from './types';
import { useAiChatStore } from '@/stores/ai-chat-store';
import type { SelectionAiMode, SelectionContext } from './selection-context';
import { defaultPromptForSelectionMode } from './selection-context';
import { buildSelectionOrigin } from './selection-ui';
import {
  createAgentToolSession,
  executeAgentTool,
} from './agent-tool-broker';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { runResearchAgentForSurface } from './research-agent-chat-runner';
import type { ResearchAgentWorkflowId } from './research-agent-workflows';
import type { Locale } from '@/types/settings';

function failSessionIfOpen(sessionId: string, error: string) {
  const store = useAgentSessionStore.getState();
  const session = store.getSession(sessionId);
  if (!session || session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
    return;
  }
  store.failSession(sessionId, error);
}

function buildExecutionPrompt(mode: SelectionAiMode, prompt: string, context: SelectionContext, locale: Locale): string {
  const normalizedPrompt = prompt.trim() || defaultPromptForSelectionMode(mode, context, locale);
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

export function inferSelectionResearchWorkflow(context: SelectionContext): ResearchAgentWorkflowId {
  switch (context.sourceKind) {
    case 'notebook':
      return 'notebook-analysis';
    case 'code':
      return 'code-change-plan';
    default:
      return 'markdown-research';
  }
}

export async function runSelectionAiMode(input: {
  context: SelectionContext;
  mode: SelectionAiMode;
  prompt: string;
  settings: AiRuntimeSettings;
  locale?: Locale;
}): Promise<{ kind: 'chat' | 'proposal'; title: string }> {
  if (!input.settings.aiEnabled) {
    throw new Error('AI is disabled in settings');
  }

  const locale = input.locale ?? 'zh-CN';
  const prompt = buildExecutionPrompt(input.mode, input.prompt, input.context, locale);
  const origin = buildSelectionOrigin(input.context, input.mode);
  const chatStore = useAiChatStore.getState();
  const agentStore = useAgentSessionStore.getState();

  if (input.mode === 'agent') {
    const displayPrompt = input.prompt.trim() || defaultPromptForSelectionMode(input.mode, input.context, locale);
    chatStore.setOpen(true);
    chatStore.addUserMessage(displayPrompt, { origin });
    const messageId = chatStore.startAssistantMessage();
    const controller = new AbortController();
    chatStore.setGenerating(true, controller);

    try {
      const workflowId = inferSelectionResearchWorkflow(input.context);
      const result = await runResearchAgentForSurface({
        settings: input.settings,
        workflowId,
        task: displayPrompt,
        title: `${origin.sourceLabel} - ${origin.mode}`,
        query: prompt,
        filePath: input.context.filePath ?? input.context.fileName,
        content: input.context.contextText || input.context.selectedText,
        selection: input.context.selectedText,
        explicitEvidenceRefs: input.context.evidenceRefs,
        workspaceKey: input.context.filePath ?? input.context.fileName,
        includeWorkspaceSummary: Boolean(input.context.filePath),
        plannerSignal: controller.signal,
        compact: true,
      });

      if (controller.signal.aborted) {
        chatStore.finishAssistantMessage(messageId);
        return { kind: 'chat', title: displayPrompt };
      }

      chatStore.appendToAssistantMessage(messageId, result.chatText);
      chatStore.finishAssistantMessage(messageId);
      chatStore.setAssistantMetadata(messageId, {
        model: result.plannerModelInfo ?? undefined,
        evidenceRefs: result.result.promptContext.evidenceRefs,
        promptContext: result.result.promptContext,
        origin,
      });
      return { kind: 'chat', title: displayPrompt };
    } catch (error) {
      chatStore.setAssistantError(messageId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  const sessionId = createAgentToolSession({
    profile: input.mode === 'chat' ? 'chat' : 'research',
    task: `${origin.mode}: ${origin.sourceLabel}`,
    title: `${origin.sourceLabel} - ${origin.mode}`,
    evidenceRefs: input.context.evidenceRefs,
  });

  const resolvedContext = await executeAgentTool({
    name: 'evidence.resolve',
    args: {
      filePath: input.context.filePath,
      content: input.context.contextText || input.context.selectedText,
      selection: input.context.selectedText,
      explicitEvidenceRefs: input.context.evidenceRefs,
      query: prompt,
    },
  }, { sessionId });

  if (resolvedContext.status === 'denied' || resolvedContext.status === 'failed') {
    failSessionIfOpen(sessionId, resolvedContext.error ?? 'Evidence resolution failed.');
    throw new Error(resolvedContext.error ?? 'Evidence resolution failed.');
  }

  if (input.mode === 'plan') {
    const proposal = await aiOrchestrator.proposeTask({
      prompt,
      filePath: input.context.filePath,
      content: input.context.contextText || input.context.selectedText,
      selection: input.context.selectedText,
      explicitEvidenceRefs: input.context.evidenceRefs,
      settings: input.settings,
    });
    const brokerResult = await executeAgentTool({
      name: 'workbench.createProposal',
      args: {
        proposal: {
          ...proposal,
          origin,
        },
      },
    }, {
      sessionId,
      approvedByUser: true,
      approvalNote: 'Selection plan was explicitly submitted by the user.',
    });
    if (brokerResult.status !== 'completed') {
      failSessionIfOpen(sessionId, brokerResult.error ?? 'Proposal creation failed.');
      throw new Error(brokerResult.error ?? 'Proposal creation failed.');
    }
    agentStore.completeSession(sessionId, proposal.summary);
    chatStore.setOpen(true);
    return { kind: 'proposal', title: proposal.summary };
  }

  const historyBefore = chatStore.getMessagesForApi();
  const displayPrompt = input.prompt.trim() || defaultPromptForSelectionMode(input.mode, input.context, locale);
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
    agentStore.appendTrace(sessionId, {
      kind: 'completed',
      message: result.text.slice(0, 240) || 'Selection AI response completed.',
      model: result.model,
      evidenceRefs: result.evidenceRefs,
    });
    return { kind: 'chat', title: displayPrompt };
  } catch (error) {
    chatStore.setAssistantError(messageId, error instanceof Error ? error.message : String(error));
    failSessionIfOpen(sessionId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
