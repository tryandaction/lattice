import type { ChatConversation } from '@/stores/ai-chat-store';
import type { AgentSourceSnapshot } from './source-index';
import { createAuthorizedSourceIndex } from './source-index';
import { getAgentDocumentVersion } from './document-source';
import type { TabState } from '@/types/layout';
import { isFileTabState } from '@/types/layout';
import type { CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
import { validateCloudAgentSourceSnapshots } from './cloud-source';
import { chatAttachmentDocumentPath, getChatAttachmentFileForPath } from './chat-attachments';

export interface ChatSourceValidationResult { valid: boolean; notice: string | null; validMessageIds: string[] }

/** Revalidate saved revisions before allowing source-bearing turns into a new model request. */
export async function validateChatSources(input: {
  conversation: ChatConversation | null;
  workspaceKey: string;
  rootHandle: FileSystemDirectoryHandle | null;
  activeTab: TabState | null;
  openTabs?: readonly TabState[];
  signal?: AbortSignal;
  cloudProvider?: CloudLibrarySourceProvider | null;
}): Promise<ChatSourceValidationResult> {
  const contexts = input.conversation?.messages.filter(message => !message.error && !message.isInterrupted && !message.isStreaming && (message.documentContext?.paths.length || message.evidenceRefs?.length || message.promptContext?.evidenceRefs?.length)) ?? [];
  if (!contexts.length) return { valid: true, notice: null, validMessageIds: [] };
  if (input.workspaceKey.startsWith('cloud:')) {
    const eligibleCloud = contexts.filter(message => message.documentContext?.workspaceKey === input.workspaceKey && message.documentContext.cloudSnapshots?.length);
    const cloudSnapshots = eligibleCloud.flatMap(message => message.documentContext!.cloudSnapshots!);
    const result = await validateCloudAgentSourceSnapshots({ provider: input.cloudProvider ?? null, snapshots: cloudSnapshots, signal: input.signal });
    const validKeys = new Set(result.valid.map(snapshot => snapshot.cloudIdentity.resourceId + ':' + snapshot.version));
    const validMessageIds = eligibleCloud.filter(message => message.documentContext!.cloudSnapshots!.every(snapshot => validKeys.has(snapshot.cloudIdentity.resourceId + ':' + snapshot.version))).map(message => message.id);
    return { valid: validMessageIds.length === contexts.length, validMessageIds, notice: result.invalid.length ? '部分旧云文档的版本或权限已变化，本次会读取当前授权版本。' : null };
  }
  const eligible = contexts.filter(message => message.documentContext?.snapshots?.length && message.documentContext.workspaceKey === input.workspaceKey);
  const snapshots = Array.from(new Map(eligible.flatMap(message => message.documentContext!.snapshots!).map(snapshot => [snapshot.sourceId + ':' + snapshot.version, snapshot])).values());
  const validSnapshots = new Set<string>();
  const identity = (snapshot: AgentSourceSnapshot) => snapshot.sourceId + ':' + snapshot.version;
  const finish = (paths: string[] = []): ChatSourceValidationResult => {
    const validMessageIds = eligible.filter(message => message.documentContext!.snapshots!.every(snapshot => validSnapshots.has(identity(snapshot)))).map(message => message.id);
    if (validMessageIds.length === contexts.length) return { valid: true, notice: null, validMessageIds };
    // Older unversioned or other-workspace answers remain visible but are
    // excluded from model history. They do not require a source-picker step
    // and must not look like a failure of the newly selected current file.
    const notice = paths.length ? invalidSourceNotice(paths).notice : null;
    return { valid: false, notice, validMessageIds };
  };
  input.signal?.throwIfAborted();
  const tabs = [input.activeTab, ...(input.openTabs ?? [])].filter((tab): tab is Extract<TabState, { fileHandle: FileSystemFileHandle }> => Boolean(tab && isFileTabState(tab)));
  const invalid: AgentSourceSnapshot[] = [];
  for (const snapshot of snapshots) {
    input.signal?.throwIfAborted();
    const attachment = input.conversation?.messages.flatMap(message => message.attachments ?? []).find(ref => chatAttachmentDocumentPath(ref) === snapshot.path && ref.conversationId === input.conversation?.id);
    if (attachment && input.conversation) {
      try {
        const file = await getChatAttachmentFileForPath(input.conversation.id, snapshot.path, { signal: input.signal });
        if (await getAgentDocumentVersion(file, snapshot.path, input.signal) === snapshot.version) validSnapshots.add(identity(snapshot));
        else invalid.push(snapshot);
      } catch { input.signal?.throwIfAborted(); invalid.push(snapshot); }
      continue;
    }
    const tab = tabs.find(candidate => (candidate.filePath ?? candidate.fileName) === snapshot.path);
    if (!tab) {
      if (input.rootHandle) {
        let index: ReturnType<typeof createAuthorizedSourceIndex> | undefined;
        try {
          index = createAuthorizedSourceIndex({ rootHandle: input.rootHandle, workspaceKey: input.workspaceKey, selections: [{ kind: 'file', path: snapshot.path }] });
          const result = await index.validateSnapshots([snapshot], input.signal);
          if (result.valid.length) validSnapshots.add(identity(snapshot)); else invalid.push(snapshot);
        } catch (error) { if (input.signal?.aborted) throw error; invalid.push(snapshot); }
        finally { index?.invalidate(); }
      } else invalid.push(snapshot);
      continue;
    }
    try {
      const handle = tab.fileHandle as FileSystemFileHandle & { queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState> };
      if (handle.queryPermission && await handle.queryPermission({ mode: 'read' }) !== 'granted') { invalid.push(snapshot); continue; }
      const version = await getAgentDocumentVersion(await handle.getFile(), snapshot.path, input.signal);
      if (version !== snapshot.version) invalid.push(snapshot);
      else validSnapshots.add(identity(snapshot));
    } catch (error) { if (input.signal?.aborted) throw error; invalid.push(snapshot); }
  }
  return finish(invalid.map(item => item.path));
}

function invalidSourceNotice(paths: string[]): ChatSourceValidationResult {
  return { valid: false, validMessageIds: [], notice: `来源已失效或无法访问：${paths.join('、')}。文件可能已修改、删除或权限已撤销；将重新读取当前授权版本，旧来源回答不进入本次模型历史。` };
}
