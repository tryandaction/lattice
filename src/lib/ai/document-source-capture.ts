import { isAgentDocumentPath, openAgentDocumentSource, type AgentDocumentSource } from './document-source';
import type { AgentSourceSelection, AgentSourceSnapshot } from './source-index';
import { parseMentions, resolveMentions } from './mention-resolver';
import { isFileTabState, type TabState } from '@/types/layout';
import type { LayoutNode } from '@/types/layout';
import { isBroadDocumentExplanation, isDocumentFollowup, isFocusedDocumentRequest, isTargetedDocumentRequest, isTrivialQuery, isWholeDocumentRequest } from './request-intent';

function localMentionQuery(query: string): string {
  return query.replace(/@(?:folder|cloud(?:-folder)?):[^\s@]*/g, '').replace(/@[^\s@]+/g, mention => {
    try { const [path, fragment] = mention.split('#', 2); decodeURI(path); if (fragment) decodeURIComponent(fragment); return mention; }
    catch { return ''; }
  });
}

export function conversationOpenFileTabs(node: LayoutNode): TabState[] {
  return node.type === 'pane' ? node.tabs.filter(isFileTabState) : node.children.flatMap(conversationOpenFileTabs);
}
function documentMentions(query: string) {
  try { return parseMentions(localMentionQuery(query)).filter(mention => mention.type === 'file' && isAgentDocumentPath(mention.path ?? mention.target)); }
  catch { return []; } // The request preparation path reports invalid mention encoding.
}

export function shouldReadConversationDocuments(query: string, knownPaths: readonly string[]): boolean {
  const hasDocumentContext = knownPaths.some(isAgentDocumentPath) || documentMentions(query).length > 0 || /@folder:[^\s@]+/.test(query);
  return hasDocumentContext && wantsDocumentReading(query, undefined, { hasDocumentContext });
}

export function wantsDocumentReading(query: string, workflowId?: string | null, context: { hasDocumentContext?: boolean; workflowExplicit?: boolean } = {}): boolean {
  if (isTrivialQuery(query)) return false;
  if (isWholeDocumentRequest(query)) return true;
  if (isFocusedDocumentRequest(query)) return false;
  if (context.hasDocumentContext && isBroadDocumentExplanation(query)) return true;
  const mentions = documentMentions(query);
  if (mentions.some(mention => mention.fragment)) return false;
  const readingWorkflow = workflowId === 'pdf-annotation' || workflowId === 'paper-reading' || workflowId === 'literature-matrix';
  if (readingWorkflow && context.workflowExplicit !== false) return true;
  if (isTargetedDocumentRequest(query)) return false;
  if ((mentions.length > 0 || /@folder:[^\s@]+/.test(query) || /(?:本文|这篇|该文|论文|文档|paper|document|article|pdf)/iu.test(query))
    && /(?:原理|机制|详细|深入|解释|讲解|分析|总结|梳理|概括|explain|analy[sz]e|summari[sz]e|review|mechanism|detail)/iu.test(query)) return true;
  // Explicit continuation remains compatible with older callers; implicit depth
  // corrections require the conversation's authorized document context.
  const hasDocumentContext = context.hasDocumentContext ?? /^(?:继续|再详细|进一步|continue\b|explain further\b)/iu.test(query.trim());
  if (isDocumentFollowup(query, { hasDocumentContext })) return true;
  return readingWorkflow;
}

export async function resolveAuthorizedDocumentLocation(root: FileSystemDirectoryHandle, path: string): Promise<{ handle: FileSystemFileHandle; path: string }> {
  let normalized = path.replace(/\\/g, '/').trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(normalized) && !/^[a-z]:\//i.test(normalized)) throw new Error('Cloud resource identities are not local filesystem paths.');
  if (!normalized || /[\u0000-\u001f]/.test(normalized) || normalized.split('/').some(part => part === '.' || part === '..')) throw new Error('Document path traversal is not allowed.');
  const desktopRoot = (root as FileSystemDirectoryHandle & { fullPath?: string }).fullPath?.replace(/\\/g, '/').replace(/\/$/, '');
  const caseInsensitive = desktopRoot && (/^[a-z]:\//i.test(desktopRoot) || desktopRoot.startsWith('//'));
  const absolute = /^[a-z]:\//i.test(normalized) || normalized.startsWith('/');
  if (absolute) {
    const candidate = caseInsensitive ? normalized.toLowerCase() : normalized;
    const parent = caseInsensitive ? desktopRoot.toLowerCase() : desktopRoot;
    if (!parent || !candidate.startsWith(parent + '/')) throw new Error('Document is outside the authorized workspace.');
    normalized = normalized.slice(parent.length + 1);
  }
  const parts = normalized.split('/').filter(Boolean);
  const resolveParts = async (segments: string[]) => {
    const name = segments.at(-1);
    if (!name) throw new Error('Missing document filename.');
    let folder = root;
    for (const part of segments.slice(0, -1)) folder = await folder.getDirectoryHandle(part);
    return { handle: await folder.getFileHandle(name), path: segments.join('/') };
  };
  const first = caseInsensitive ? parts[0]?.toLowerCase() : parts[0];
  const rootName = caseInsensitive ? root.name.toLowerCase() : root.name;
  if (absolute || parts.length < 2 || first !== rootName) return resolveParts(parts);

  // Explorer paths include the root name, but root-relative paths may refer
  // to a real same-name child. Probe both without reading either file; never
  // guess when both exist or when a permission error prevents verification.
  const candidates = await Promise.allSettled([resolveParts(parts.slice(1)), resolveParts(parts)]);
  const unexpectedFailure = candidates.find(result => result.status === 'rejected'
    && result.reason?.name !== 'NotFoundError' && result.reason?.name !== 'TypeMismatchError');
  if (unexpectedFailure?.status === 'rejected') throw unexpectedFailure.reason;
  const matches = candidates.filter((result): result is PromiseFulfilledResult<{ handle: FileSystemFileHandle; path: string }> => result.status === 'fulfilled');
  if (matches.length > 1) throw new Error('Document path is ambiguous within the authorized workspace. Please reopen the intended file.');
  if (matches.length === 1) return matches[0].value;
  const failure = candidates[0];
  if (failure.status === 'rejected') throw failure.reason;
  throw new Error('Document not found in the authorized workspace.');
}

export async function resolveAuthorizedDocumentHandle(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle> {
  return (await resolveAuthorizedDocumentLocation(root, path)).handle;
}

export async function captureAgentDocumentSources(input: {
  activeTab: TabState | null;
  openTabs?: readonly TabState[];
  rootHandle: FileSystemDirectoryHandle | null;
  query: string;
  contextPaths?: readonly string[];
  contextSelections?: readonly AgentSourceSelection[];
  resumePaths?: string[];
  maxFiles?: number;
  maxTotalBytes?: number;
  concurrency?: number;
  signal?: AbortSignal;
}): Promise<AgentDocumentSource[]> {
  const active = input.activeTab && isFileTabState(input.activeTab) ? input.activeTab : null;
  const mentions = input.resumePaths ? [] : await resolveMentions(parseMentions(localMentionQuery(input.query)), { readFile: async () => '' });
  const paths = [...new Set(input.resumePaths ?? [...(input.contextPaths ?? [active?.filePath ?? active?.fileName]), ...(input.contextSelections ?? []).filter(item => item.kind === 'file').map(item => item.path), ...mentions.filter(item => item.type === 'file').map(item => item.path ?? item.target)].filter((path): path is string => Boolean(path)))]
    .filter(isAgentDocumentPath);
  const maxFiles = Math.max(1, Math.min(500, Math.floor(input.maxFiles ?? 100)));
  if (!input.resumePaths) {
    const { createAuthorizedSourceIndex, parseSourceSelections } = await import('./source-index');
    const folders = [...(input.contextSelections ?? []), ...parseSourceSelections(input.query)].filter(item => item.kind === 'folder');
    if (folders.length && !input.rootHandle) throw new Error('目录阅读需要重新授权原工作区。');
    if (folders.length && input.rootHandle) {
      const index = createAuthorizedSourceIndex({ rootHandle: input.rootHandle, workspaceKey: input.rootHandle.name, selections: folders });
      let cursor: number | undefined;
      do {
        const page = await index.list({ cursor, limit: Math.min(maxFiles + 1, 100), signal: input.signal });
        for (const entry of page.entries) if (entry.supported && !paths.includes(entry.path)) paths.push(entry.path);
        if (paths.length > maxFiles) throw new Error(`选定目录超过 ${maxFiles} 文件读取预算，请通过目录索引分页检索后选择相关文件。`);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
    }
  }
  if (!paths.length) throw new Error('请先打开或引用可读取的 PDF、Markdown、文本、代码或 Notebook 文件。');
  if (paths.length > maxFiles) throw new Error('选定文件超过读取预算，请缩小范围或使用分页目录检索。');
  const result: AgentDocumentSource[] = [];
  const maxTotalBytes = Math.max(1, Math.min(128_000_000, input.maxTotalBytes ?? 32_000_000));
  const concurrency = Math.max(1, Math.min(4, Math.floor(input.concurrency ?? 3)));
  let totalBytes = 0;
  try {
    for (let offset = 0; offset < paths.length; offset += concurrency) {
      if (input.signal?.aborted) throw new DOMException('Document capture cancelled', 'AbortError');
      const batch = await Promise.allSettled(paths.slice(offset, offset + concurrency).map(async path => {
        const tab = [active, ...(input.openTabs ?? [])].find(tab => tab && isFileTabState(tab) && (tab.filePath ?? tab.fileName) === path);
        const handle = tab && isFileTabState(tab) ? tab.fileHandle
          : input.rootHandle ? await resolveAuthorizedDocumentHandle(input.rootHandle, path) : null;
        if (!handle) throw new Error('无法重新访问文档，请打开原工作区后继续：' + path);
        const file = await handle.getFile();
        totalBytes += file.size;
        if (totalBytes > maxTotalBytes) throw new Error('选定文件超过内容提取字节预算，请缩小范围或分页检索。');
        return openAgentDocumentSource(file, path, input.signal);
      }));
      for (const item of batch) if (item.status === 'fulfilled') result.push(item.value);
      const failure = batch.find(item => item.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    }
    return result;
  } catch (error) { await Promise.allSettled(result.map(source => source.close())); throw error; }
}

export function snapshotAgentDocumentSources(sources: readonly AgentDocumentSource[], workspaceKey: string, permissionScope?: string): AgentSourceSnapshot[] {
  return sources.map(source => ({ workspaceKey, path: source.path,
    sourceId: source.cloudIdentity?.resourceId ?? `lattice-workspace:${encodeURIComponent(workspaceKey)}:${encodeURIComponent(source.path)}`,
    version: source.version, kind: source.kind, totalUnits: source.totalUnits, unitLabel: source.unitLabel,
    ...(permissionScope ? { permissionScope } : source.cloudIdentity ? { permissionScope: `role:${source.cloudIdentity.role}` } : {}),
    ...(source.providerScope ? { providerScope: source.providerScope } : {}),
    ...(source.cloudIdentity ? { cloudIdentity: source.cloudIdentity } : {}) }));
}
