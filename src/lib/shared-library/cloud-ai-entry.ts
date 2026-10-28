import { getCloudWorkspaceSnapshot } from "@/lib/cloud-workspace-host";
import { buildCloudSourceSelectionMention, type CloudAgentSourceSelection } from "@/lib/ai/cloud-source";
import { useAiChatStore } from "@/stores/ai-chat-store";
import type { Locale } from "@/types/settings";
import type { CloudLibrarySourceProvider } from "./source-provider";
import { cloudAiLabels } from "./cloud-ai-labels";

export interface CloudAiEntryInput {
  provider: CloudLibrarySourceProvider;
  expectedScope: string;
  selection: CloudAgentSourceSelection;
  sourceName?: string;
  locale?: Locale;
}

const sourceNames = new Map<string, string>();
const sourceNameKey = (scope: string, selection: CloudAgentSourceSelection) => JSON.stringify([scope, selection.libraryId, selection.itemId, selection.kind]);

/** Display metadata only; never grants source access or substitutes for a provider read. */
export function getCloudAiSourceName(provider: CloudLibrarySourceProvider | null, selection: CloudAgentSourceSelection): string | undefined {
  if (!provider?.scope || getCloudWorkspaceSnapshot().provider !== provider) return undefined;
  return sourceNames.get(sourceNameKey(provider.scope, selection));
}

/** Prepare a scoped source in the existing chat. Content is read only when the user sends. */
export function openCloudAiEntry(input: CloudAiEntryInput): { conversationId: string; createdConversation: boolean } {
  const labels = cloudAiLabels(input.locale);
  if (!input.expectedScope || input.provider.scope !== input.expectedScope || getCloudWorkspaceSnapshot().provider !== input.provider) {
    throw new Error(labels.scopeChanged);
  }
  const { selection } = input;
  if (!["file", "folder"].includes(selection.kind) || !selection.libraryId.trim() || !selection.itemId.trim()
    || /[\u0000-\u001f]/u.test(selection.libraryId + selection.itemId)) throw new Error(labels.invalidSource);
  const chat = useAiChatStore.getState();
  if (chat.isGenerating) throw new Error(labels.generating);
  const mention = buildCloudSourceSelectionMention(selection);
  const workspace = { workspaceKey: `cloud:${selection.libraryId}`, libraryId: selection.libraryId, permissionScope: input.expectedScope };
  const current = chat.getActiveConversation();
  const draft = current?.draft;
  const sameScope = !current?.workspace || current.workspace.workspaceKey === workspace.workspaceKey && current.workspace.permissionScope === workspace.permissionScope;
  const reusable = current && sameScope && current.messages.length === 0 && !draft?.attachmentIds?.length && !draft?.continuation
    && (!draft?.text.trim() || draft.text.trim() === mention) && !chat.composerDraft?.submit;
  const conversationId = reusable ? current.id : chat.newConversation();
  chat.setConversationWorkspace(workspace, conversationId);
  chat.setComposerMode("agent");
  chat.setComposerDraft({ text: `${mention} `, mode: "agent" });
  if (input.sourceName) {
    chat.renameConversation(conversationId, input.sourceName);
    const key = sourceNameKey(input.expectedScope, selection);
    sourceNames.delete(key);
    sourceNames.set(key, input.sourceName);
    if (sourceNames.size > 100) sourceNames.delete(sourceNames.keys().next().value!);
  }
  chat.setOpen(true);
  return { conversationId, createdConversation: !reusable };
}
