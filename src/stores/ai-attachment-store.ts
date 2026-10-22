import { create } from 'zustand';
import {
  addChatAttachments,
  assertChatAttachmentScope,
  listChatAttachments,
  markChatAttachmentsSent,
  removeChatAttachment,
  type ChatAttachmentRef,
  type ChatAttachmentScope,
} from '@/lib/ai/chat-attachments';

interface AiAttachmentStore {
  /** Metadata only: file bytes and base64 never enter Zustand/localStorage. */
  attachmentsByConversation: Record<string, ChatAttachmentRef[]>;
  busyByConversation: Record<string, number>;
  errorsByConversation: Record<string, string | undefined>;
  hydrateConversation(conversationId: string, options?: ChatAttachmentScope): Promise<void>;
  addFiles(conversationId: string, files: readonly File[], options?: ChatAttachmentScope): Promise<ChatAttachmentRef[]>;
  removeAttachment(conversationId: string, attachmentId: string, options?: ChatAttachmentScope): Promise<void>;
  markSent(conversationId: string, attachmentIds: readonly string[], options?: ChatAttachmentScope): Promise<void>;
  clearError(conversationId: string): void;
}

const revisions = new Map<string, number>();

export const useAiAttachmentStore = create<AiAttachmentStore>((set) => {
  const run = async <T>(conversationId: string, options: ChatAttachmentScope, operation: () => Promise<T>): Promise<T> => {
    assertChatAttachmentScope(options);
    set(state => ({
      busyByConversation: { ...state.busyByConversation, [conversationId]: (state.busyByConversation[conversationId] ?? 0) + 1 },
      errorsByConversation: { ...state.errorsByConversation, [conversationId]: undefined },
    }));
    try {
      const result = await operation();
      assertChatAttachmentScope(options);
      const revision = (revisions.get(conversationId) ?? 0) + 1;
      revisions.set(conversationId, revision);
      const attachments = await listChatAttachments(conversationId, options);
      assertChatAttachmentScope(options);
      // A slower initial hydration must not overwrite a later upload/remove snapshot.
      if (revisions.get(conversationId) === revision) set(state => ({ attachmentsByConversation: { ...state.attachmentsByConversation, [conversationId]: attachments } }));
      return result;
    } catch (error) {
      if (!options.signal?.aborted && (!options.isCurrent || options.isCurrent())) {
        set(state => ({ errorsByConversation: { ...state.errorsByConversation, [conversationId]: error instanceof Error ? error.message : '附件处理失败。' } }));
      }
      throw error;
    } finally {
      set(state => ({ busyByConversation: { ...state.busyByConversation, [conversationId]: Math.max(0, (state.busyByConversation[conversationId] ?? 1) - 1) } }));
    }
  };
  return {
    attachmentsByConversation: {}, busyByConversation: {}, errorsByConversation: {},
    hydrateConversation: (conversationId, options = {}) => run(conversationId, options, async () => undefined),
    addFiles: (conversationId, files, options = {}) => run(conversationId, options, () => addChatAttachments(conversationId, files, options)),
    removeAttachment: (conversationId, attachmentId, options = {}) => run(conversationId, options, () => removeChatAttachment(conversationId, attachmentId, options)),
    markSent: (conversationId, attachmentIds, options = {}) => run(conversationId, options, () => markChatAttachmentsSent(conversationId, attachmentIds, options)),
    clearError: conversationId => set(state => ({ errorsByConversation: { ...state.errorsByConversation, [conversationId]: undefined } })),
  };
});
