import type { AgentResultMetadata, ChatConversation, ChatMessage } from '@/stores/ai-chat-store';
import { canonicalCitationPath } from '@/lib/ai/citation-contract';

interface ChatMetadataState {
  conversations: ChatConversation[];
  activeConversationId: string | null;
}

interface ConversationMetadata {
  conversationId: string | null;
  contextCount: number;
  sourceCount: number;
  evidenceMessageCount: number;
  workbenchActionCount: number;
  messageSessionId: string | null;
  deliveryStatus: AgentResultMetadata['deliveryStatus'] | null;
}

const EMPTY_MESSAGES: ChatMessage[] = [];

export function hasMessageEvidence(message: ChatMessage): boolean {
  return message.role === 'assistant'
    && ((message.evidenceRefs?.length ?? 0) > 0 || (message.promptContext?.evidenceRefs.length ?? 0) > 0 || (message.promptContext?.nodes.length ?? 0) > 0);
}

/** Keep token-only updates out of the shell and do not rescan document nodes. */
export function createConversationMetadataSelector() {
  let previousMessages = EMPTY_MESSAGES;
  let previous: ConversationMetadata = {
    conversationId: null, contextCount: 0, sourceCount: 0, evidenceMessageCount: 0, workbenchActionCount: 0, messageSessionId: null, deliveryStatus: null,
  };
  return (state: ChatMetadataState): ConversationMetadata => {
    const conversation = state.conversations.find(item => item.id === state.activeConversationId);
    const messages = conversation?.messages ?? EMPTY_MESSAGES;
    const conversationId = conversation?.id ?? null;
    if (conversationId === previous.conversationId && messages === previousMessages) return previous;

    let contextsChanged = conversationId !== previous.conversationId || messages.length !== previousMessages.length;
    let evidenceMessageCount = 0;
    let workbenchActionCount = 0;
    let messageSessionId: string | null = null;
    let deliveryStatus: ConversationMetadata['deliveryStatus'] = null;
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      contextsChanged ||= message.promptContext !== previousMessages[index]?.promptContext || message.evidenceRefs !== previousMessages[index]?.evidenceRefs;
      if (hasMessageEvidence(message)) evidenceMessageCount += 1;
      workbenchActionCount += message.followUpActions?.length ?? 0;
      if (message.role === 'assistant') {
        messageSessionId = message.agentResult?.sessionId ?? null;
        deliveryStatus = message.agentResult?.deliveryStatus ?? null;
      } else if (message.role === 'user') {
        messageSessionId = null;
        deliveryStatus = null;
      }
    }
    let contextCount = previous.contextCount;
    let sourceCount = previous.sourceCount;
    if (contextsChanged) {
      const contextIds = new Set<string>();
      const sourcePaths = new Set<string>();
      for (const message of messages) {
        for (const ref of [...(message.evidenceRefs ?? []), ...(message.promptContext?.evidenceRefs ?? [])]) {
          if (ref.locator) sourcePaths.add(canonicalCitationPath(ref.locator));
        }
        for (const node of message.promptContext?.nodes ?? []) {
          contextIds.add(node.evidenceRef ? `${node.evidenceRef.kind}:${node.evidenceRef.locator}` : node.id ?? node.label);
          if (node.evidenceRef?.locator) sourcePaths.add(canonicalCitationPath(node.evidenceRef.locator));
        }
      }
      contextCount = contextIds.size;
      sourceCount = sourcePaths.size;
    }
    previousMessages = messages;
    if (conversationId !== previous.conversationId || contextCount !== previous.contextCount || sourceCount !== previous.sourceCount
      || evidenceMessageCount !== previous.evidenceMessageCount || workbenchActionCount !== previous.workbenchActionCount
      || messageSessionId !== previous.messageSessionId || deliveryStatus !== previous.deliveryStatus) {
      previous = { conversationId, contextCount, sourceCount, evidenceMessageCount, workbenchActionCount, messageSessionId, deliveryStatus };
    }
    return previous;
  };
}
