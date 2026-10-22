import { invalidSourceSelectionMentions, parseSourceSelections, type AgentSourceSelection } from './source-index';
import { isDocumentFollowup, isFocusedDocumentRequest, isTrivialQuery, isWholeDirectoryRequest } from './request-intent';
import { isAgentDocumentPath, isWorkspaceInstructionPath } from './document-source';
import { resolveAuthorizedDocumentLocation } from './document-source-capture';
import { DOCUMENT_REQUEST_ACTION as DOCUMENT_ACTION, isCurrentDocumentReference, isPreviousDocumentReference, startsNewDocumentTopic, quotedDocumentNames, requestsIndependentAnswer, isDocumentTitleRequest, documentSourceReferenceQuery } from './document-reference-intent';

export interface ResolveConversationSourceTargetsInput {
  query: string;
  knownPaths: readonly string[];
  referentPaths?: readonly string[];
  activePath?: string | null;
  rootHandle?: FileSystemDirectoryHandle | null;
  workspaceRootPath?: string | null;
  workspaceKey?: string | null;
  signal?: AbortSignal;
  relocateReferents?: boolean;
  /** Retain an open document as a bounded tool source for ordinary questions, without implying a full read. */
  includeActiveDocumentContext?: boolean;
}

export interface ConversationSourceTargets {
  paths: string[];
  selections?: AgentSourceSelection[];
  reason: string;
  notice?: string;
}

const DOCUMENT_SUBJECT = /文件|文档|论文|文章|材料|资料|笔记|第\s*[\d一二三四五六七八九十]+\s*页|\b(?:file|document|paper|article|note|pdf|page\s*\d+)\b/iu;
const COMPARISON = /比较|对比|区别|差异|\b(?:compar\w*|versus|vs\.?|difference)\b/iu;

function pathsOnly(paths: readonly string[]): string[] {
  return [...new Set(paths.filter(path => typeof path === 'string' && path.trim() && !/[\u0000-\u001f]/u.test(path)).map(path => path.trim().replace(/\\/g, '/')))];
}

function fileTargets(paths: readonly string[], reason: string): ConversationSourceTargets {
  const unique = pathsOnly(paths);
  return { paths: unique, ...(unique.length ? { selections: unique.map(path => ({ kind: 'file' as const, path })) } : {}), reason };
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Source targeting cancelled', 'AbortError');
}

interface Mention { start: number; end: number; name: string; paths: string[] }

/** Match identities only. A metadata match is never evidence that the source was read. */
function namedMentions(query: string, paths: readonly string[], allowStems: boolean): Mention[] {
  const text = query.replace(/\\/g, '/').toLocaleLowerCase();
  const groups = new Map<string, Mention>();
  for (const path of paths) {
    const name = path.split('/').at(-1)!;
    const stem = name.replace(/\.[^.]+$/u, '');
    const aliases = [...new Set([path, name, ...(allowStems && stem.length > 1 ? [stem] : [])])];
    for (const alias of aliases) {
      const needle = alias.toLocaleLowerCase();
      for (let start = text.indexOf(needle); start >= 0; start = text.indexOf(needle, start + needle.length)) {
        const end = start + needle.length;
        // Do not treat a basename as a match inside another filename or a different full path.
        if (/[a-z0-9_./-]/iu.test(text[start - 1] ?? '') || /[a-z0-9_./-]/iu.test(text[end] ?? '')) continue;
        if (/\p{Script=Han}/u.test(text[start - 1] ?? '')
          && !/(?:请|把|对|和|与|及|以及|还有|总结|摘要|阅读|通读|分析|解释|比较|对比|查看|打开|查找|搜索|检索|名为|叫作|一下|看看)$/u.test(text.slice(0, start))) continue;
        if (alias === stem && /[\p{L}\p{N}]/u.test(text[end] ?? '')
          && !/^(?:的|和|与|及|以及|论文|文档|文件|文章|比较|对比)/u.test(text.slice(end))) continue;
        const key = `${start}:${end}`;
        const mention = groups.get(key) ?? { start, end, name: alias, paths: [] };
        if (!mention.paths.includes(path)) mention.paths.push(path);
        groups.set(key, mention);
      }
    }
  }
  const mentions = [...groups.values()];
  return mentions.filter(mention => !mentions.some(other => other !== mention && other.start <= mention.start && other.end >= mention.end && other.end - other.start > mention.end - mention.start))
    .sort((a, b) => a.start - b.start);
}

function explicitFilenameReferences(query: string): Array<{ name: string; end: number }> {
  const references: Array<{ name: string; end: number }> = [];
  // The ending offset also lets an unquoted filename with spaces match its complete metadata name.
  for (const match of query.matchAll(/[\p{L}\p{N}_./\\%+()~-]+\.[a-z][a-z0-9]{0,9}(?![a-z0-9])/giu)) {
    const name = match[0].replace(/^(?:(?:请你|麻烦你?|请|帮我|总结|阅读|通读|分析|解释|比较|对比|打开|查找|搜索|和|与|及|以及))+/u, '');
    if (name && isAgentDocumentPath(name)) references.push({ name, end: match.index + match[0].length });
  }
  return references;
}

async function discoverPaths(input: ResolveConversationSourceTargetsInput): Promise<string[]> {
  if (!input.rootHandle) return pathsOnly([...input.knownPaths, ...(input.activePath ? [input.activePath] : [])]);
  const root = input.rootHandle;
  const paths: string[] = [];
  let directories = 0, entries = 0;
  const permission = (root as FileSystemDirectoryHandle & { queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState> }).queryPermission;
  const check = async () => {
    assertNotAborted(input.signal);
    if (permission && await permission.call(root, { mode: 'read' }) !== 'granted') throw new Error('工作区读取权限已撤销，请重新选择工作区。');
  };
  async function walk(folder: FileSystemDirectoryHandle, prefix = ''): Promise<void> {
    await check();
    if (++directories > 1024) throw new Error('文件定位超过工作区扫描范围，请提供完整路径或用 @folder: 指定较小的文件夹。');
    for await (const entry of folder.values()) {
      assertNotAborted(input.signal);
      if (++entries > 12_000) throw new Error('文件定位超过工作区扫描范围，请提供完整路径或用 @folder: 指定较小的文件夹。');
      if (entry.name.startsWith('.')) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (!['node_modules', 'dist', 'build', 'target'].includes(entry.name)) await walk(entry as FileSystemDirectoryHandle, path);
      } else if (isAgentDocumentPath(path)) paths.push(path);
    }
  }
  // getFile() materializes bytes on the native host. Names come from directory
  // handles; only the chosen sources are subsequently opened by the reader.
  await walk(root); await check();
  return pathsOnly(paths);
}

/** Recover unversioned historical identities through current authorization, never historical body text. */
async function historicalTargets(input: ResolveConversationSourceTargetsInput, paths: string[]): Promise<ConversationSourceTargets> {
  if (!input.relocateReferents || !input.rootHandle) return fileTargets(paths, 'conversation-followup');
  const result: string[] = [];
  let candidates: string[] | undefined;
  for (const path of paths) {
    assertNotAborted(input.signal);
    if (path.startsWith('attachments/')) { result.push(path); continue; }
    try {
      await resolveAuthorizedDocumentLocation(input.rootHandle, path);
      result.push(path); continue;
    } catch (error) {
      if (!(error instanceof DOMException) || !['NotFoundError', 'TypeMismatchError'].includes(error.name)) throw error;
    }
    candidates ??= await discoverPaths(input);
    const name = path.split('/').at(-1)!.toLocaleLowerCase();
    const matches = candidates.filter(candidate => !isWorkspaceInstructionPath(candidate) && candidate.split('/').at(-1)!.toLocaleLowerCase() === name);
    if (matches.length > 1) throw new Error(`先前来源“${path}”对应多个文件，请明确指定路径：${matches.join('、')}`);
    if (!matches.length) throw new Error(`未找到先前论文来源：${path}。请重新打开或上传原文件；尚未读取该论文。`);
    result.push(matches[0]);
  }
  return fileTargets(result, 'conversation-followup');
}

const ABSOLUTE_LOCAL_PATH = /[a-z]:[\\/]|\/(?=[\p{L}\p{N}_.])/giu;
const ABSOLUTE_PATH_BOUNDARY = /[\s"'`“「《([{，,。；;!?！？]/u;
const PATH_QUERY_DELIMITER = /(?:[中里下内](?:的?(?:有|哪|文|论|含|包|查|搜|找|单|把))|的(?:内容|主要|核心|结果|方法|文|论)|有哪|包含|查找|搜索|总结|分析)/gu;
const PATH_QUERY_AFTER_SPACE = /^(?:有哪些|哪些|有哪|是否|能否|把|将|和|与|以及|中的|里的|下的|内的|查找|搜索|寻找|找出|总结|分析|解释|阅读|\b(?:which|what|find|search|locate|look|read|summari[sz]e|analy[sz]e|explain|compare|and|with|versus|vs|in|for|contains|has|list)\b)/iu;

function normalizedAbsolutePath(path: string): string {
  return path.replace(/\\/g, '/').trim().replace(/\/$/u, '');
}

function isWithinPath(path: string, root: string): boolean {
  const insensitive = /^[a-z]:\//iu.test(root) || root.startsWith('//');
  const candidate = insensitive ? path.toLocaleLowerCase() : path;
  const parent = insensitive ? root.toLocaleLowerCase() : root;
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

const RELATIVE_FOLDER_SUFFIX = /(?:中|里|下|内)(?:的)?(?=(?:文章|论文|文档|文件|资料|笔记|所有|全部|有哪些|有哪|包含|含有|都|查找|搜索|阅读|通读|总结|分析|解释|讲述|比较|对比|内容))/gu;
const RELATIVE_FOLDER_BOUNDARY = /[\s"'`“「《(，,：:@]/u;

function relativeFolderCandidates(query: string): string[] {
  const starts = new Set<number>([0]);
  for (let index = 0; index < query.length; index += 1) {
    if (!RELATIVE_FOLDER_BOUNDARY.test(query[index])) continue;
    const prefix = query.slice(0, index).trimEnd();
    if (query[index] === '@' || !prefix || /(?:请你|请|麻烦你?|帮我|阅读|通读|读取|总结|概括|分析|讲述|解释|查找|搜索|打开|查看|浏览|关于|针对|对于|访问|分析一下|看一下|读一下|read|review|summari[sz]e|analy[sz]e|explain)$/iu.test(prefix)) starts.add(index + 1);
  }
  const ends = new Set<number>([query.length]);
  RELATIVE_FOLDER_SUFFIX.lastIndex = 0;
  for (const match of query.matchAll(RELATIVE_FOLDER_SUFFIX)) ends.add(match.index);
  for (const match of query.matchAll(/[，,。；;!?！？\r\n]/gu)) ends.add(match.index);
  for (const match of query.matchAll(/\s+(?=(?:都|请|逐|并|分别|然后|且|再|阅读|通读|总结|分析|讲述|\b(?:read|review|summari[sz]e|analy[sz]e|explain)\b))/giu)) ends.add(match.index);
  const candidates = new Set<string>();
  for (const start of starts) {
    for (const end of ends) {
      if (end <= start) continue;
      let value = query.slice(start, end).trim().replace(/^@/u, '').replace(/^['`“「《(]+|['`”」》)]+$/gu, '');
      value = value.replace(/\\/g, '/').replace(/\/+$/u, '');
      const singleFolder = !value.includes('/') && !isAgentDocumentPath(value)
        && /^(?:中|里|下|内)(?:的)?(?:文章|论文|文档|文件|资料|笔记|所有|全部)/u.test(query.slice(end))
        && !/^(?:当前|这个|该|本|已打开的?)?(?:工作区|根目录|文件夹|目录)$/u.test(value.replace(/^(?:请你|请|阅读|读取|通读|完整|分析|总结|查看|浏览|在)+/u, ''));
      if ((!value.includes('/') && !singleFolder) || value.startsWith('/') || /^[a-z]:\//iu.test(value)
        || /[\u0000-\u001f*?<>|]/u.test(value)) continue;
      const parts = value.split('/');
      if (parts.some(part => !part.trim() || part !== part.trim())) continue;
      candidates.add(value);
    }
  }
  return [...candidates].sort((a, b) => b.length - a.length);
}

async function resolveExplicitRelativeFolder(input: ResolveConversationSourceTargetsInput, query: string): Promise<AgentSourceSelection[] | null> {
  const root = input.rootHandle;
  if (!root) return null;
  const candidates = relativeFolderCandidates(query);
  if (!candidates.length) return null;
  if (query.includes('@folder:')) {
    const sourcePath = query.match(/@folder:([^\s@]+)/u)?.[1];
    if (sourcePath) {
      try {
        const decoded = decodeURIComponent(sourcePath);
        if (decoded.split('/').some(part => part === '.' || part === '..')) throw new Error('目录路径无效或包含路径遍历。');
      } catch (error) {
        if (error instanceof Error && error.message.includes('路径遍历')) throw error;
        throw new Error('文件夹引用路径编码无效。');
      }
    }
  }
  const permission = (root as FileSystemDirectoryHandle & { queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState> }).queryPermission;
  if (permission && await permission.call(root, { mode: 'read' }) !== 'granted') throw new Error('工作区读取权限已撤销，请重新授权该目录。');
  assertNotAborted(input.signal);
  const handlePath = (root as FileSystemDirectoryHandle & { fullPath?: string }).fullPath;
  const rootPath = normalizedAbsolutePath(handlePath ?? input.workspaceRootPath ?? '');
  const matches = new Map<string, AgentSourceSelection>();
  let sawTraversal = false;
  const directoryCache = new Map<string, Promise<FileSystemDirectoryHandle | null>>([['', Promise.resolve(root)]]);
  const resolveDirectory = (parts: readonly string[]) => parts.reduce<Promise<FileSystemDirectoryHandle | null>>(async (pending, part, index) => {
    const parent = await pending;
    if (!parent) return null;
    assertNotAborted(input.signal);
    const key = parts.slice(0, index + 1).join('/');
    const cached = directoryCache.get(key);
    if (cached) return cached;
    const next = parent.getDirectoryHandle(part).catch(error => {
      if (error instanceof DOMException && ['NotFoundError', 'TypeMismatchError'].includes(error.name)) return null;
      throw error;
    });
    directoryCache.set(key, next);
    return next;
  }, Promise.resolve(root));
  for (const candidate of candidates) {
    const parts = candidate.split('/');
    if (parts.some(part => part === '.' || part === '..')) { sawTraversal = true; continue; }
    const rootName = root.name;
    const paths = parts[0]?.toLocaleLowerCase() === rootName.toLocaleLowerCase() && parts.length > 1
      ? [parts, parts.slice(1)] : [parts];
    for (const pathParts of paths) {
      assertNotAborted(input.signal);
      const directory = await resolveDirectory(pathParts);
      if (!directory) continue;
      const relativePath = pathParts.join('/');
      const selection = { kind: 'folder' as const, path: handlePath && rootPath ? `${rootPath}/${relativePath}` : relativePath };
      matches.set(selection.path, selection);
    }
  }
  if (matches.size > 1) throw new Error(`目录路径对应多个授权位置，请明确指定相对路径：${[...matches.keys()].join('、')}`);
  if (!matches.size) {
    if (sawTraversal) throw new Error('目录路径无效或包含路径遍历。');
    const explicitFolder = candidates.find(candidate => {
      const start = query.indexOf(candidate);
      if (start < 0) return false;
      const suffix = query.slice(start + candidate.length).trimStart().replace(/^["'`”」》)]+/u, '').trimStart();
      return /^(?:中|里|下|内)(?:的)?(?:文章|论文|文档|文件|资料|笔记|所有|全部|有哪些|有哪|包含|含有|都|查找|搜索|阅读|通读|总结|分析|解释|讲述|比较|对比|内容)/u.test(suffix);
    });
    if (explicitFolder) throw new Error(`未找到授权工作区中的文件夹：${explicitFolder}。请检查目录是否已移动或名称是否正确。`);
    return null;
  }
  if (permission && await permission.call(root, { mode: 'read' }) !== 'granted') throw new Error('工作区读取权限已撤销，请重新授权该目录。');
  return [...matches.values()];
}

function absoluteRequestsIn(query: string): Array<{ raw: string; quoted: boolean }> {
  // Literal examples and formulas can contain slashes and Windows-looking
  // strings without requesting access to local sources. Preserve offsets.
  const text = query
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/gu, value => ' '.repeat(value.length))
    .replace(/\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\\r\n])+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/gu, value => ' '.repeat(value.length));
  const starts: number[] = [];
  ABSOLUTE_LOCAL_PATH.lastIndex = 0;
  for (const match of text.matchAll(ABSOLUTE_LOCAL_PATH)) {
    const start = match.index;
    if (start > 0 && !ABSOLUTE_PATH_BOUNDARY.test(text[start - 1])
      && !/(?:请|在|查看|打开|查找|搜索|阅读|总结|比较|分析)$/u.test(text.slice(0, start))) continue;
    starts.push(start);
  }
  return starts.map((start, index) => {
    const quoted = /["'`“「《]/u.test(query[start - 1] ?? '');
    const tail = query.slice(start, starts[index + 1]);
    const raw = tail.split(quoted ? /["'`”」》\r\n]/u : /["'`”」》，,。；;!?！？\r\n]/u, 1)[0].trim();
    return { raw: /^[a-z]:[\\/]/iu.test(raw) ? raw.replace(/\\/g, '/') : raw, quoted };
  });
}

function absolutePathCandidates(raw: string, rootPath: string, quoted: boolean): string[] {
  const suffix = raw.slice(rootPath.length);
  const child = suffix.startsWith('/');
  const content = child ? suffix.slice(1) : suffix;
  if (quoted) return [normalizedAbsolutePath(raw)];
  PATH_QUERY_DELIMITER.lastIndex = 0;
  const queryBoundaries = [...content.matchAll(PATH_QUERY_DELIMITER)].map(match => match.index);
  const pathPortion = content.slice(0, queryBoundaries[0] ?? content.length);
  const finalSegmentStart = pathPortion.lastIndexOf('/') + 1;
  const cuts = new Set<number>([content.length, ...queryBoundaries]);
  for (const match of content.matchAll(/\s+/gu)) {
    if (match.index >= finalSegmentStart && PATH_QUERY_AFTER_SPACE.test(content.slice(match.index + match[0].length))) cuts.add(match.index);
  }
  return [...new Set([...cuts].map(cut => content.slice(0, cut).trim().replace(/\/+$/u, ''))
    .filter(candidate => !child || !content.trim() || candidate.length > 0)
    .map(candidate => candidate ? `${rootPath}/${candidate}` : rootPath))].sort((a, b) => b.length - a.length);
}

async function resolveAbsolutePathSelections(input: ResolveConversationSourceTargetsInput, query: string): Promise<AgentSourceSelection[]> {
  const root = input.rootHandle;
  const handlePath = (root as (FileSystemDirectoryHandle & { fullPath?: string }) | null | undefined)?.fullPath;
  const rootPath = normalizedAbsolutePath(handlePath ?? input.workspaceRootPath ?? '');
  const requests = absoluteRequestsIn(query);
  if (!requests.length) return [];
  if (!root) throw new Error('请先授权该目录后再访问绝对路径。');
  if (!rootPath || !/^(?:[a-z]:\/|\/)/iu.test(rootPath)) throw new Error('无法核实当前工作区路径，请先授权该目录。');

  const suppliedRootPath = input.workspaceRootPath ? normalizedAbsolutePath(input.workspaceRootPath) : '';
  if (handlePath && suppliedRootPath && (!isWithinPath(rootPath, suppliedRootPath) || !isWithinPath(suppliedRootPath, rootPath))) {
    throw new Error('提供的工作区路径与已授权目录不一致，请授权该路径所在目录。');
  }
  const insensitive = /^[a-z]:\//iu.test(rootPath) || rootPath.startsWith('//');
  const parent = insensitive ? rootPath.toLocaleLowerCase() : rootPath;
  const requestCandidates = requests.map(request => {
    const raw = insensitive ? request.raw.toLocaleLowerCase() : request.raw;
    const suffix = request.raw.slice(rootPath.length);
    if (!raw.startsWith(parent) || suffix && !suffix.startsWith('/') && !/^(?:[\s"'`”」》)\]}，,。；;!?！？]|[中里下内](?:的?(?:有|哪|文|论|含|包|查|搜|找))|的(?:内容|文|论)|有哪)/u.test(suffix)) {
      throw new Error('该路径位于当前已授权工作区之外，请先授权其所在目录。');
    }
    return absolutePathCandidates(request.raw, rootPath, request.quoted);
  });
  const permission = (root as FileSystemDirectoryHandle & { queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState> }).queryPermission;
  if (permission && await permission.call(root, { mode: 'read' }) !== 'granted') throw new Error('工作区读取权限已撤销，请重新授权该目录。');
  assertNotAborted(input.signal);

  const authorizedRoot: FileSystemDirectoryHandle = root;
  const directories = new Map<string, FileSystemDirectoryHandle>([['', authorizedRoot]]);
  async function resolve(candidates: string[]): Promise<AgentSourceSelection> {
    const longestRelative = candidates[0] === rootPath ? '' : candidates[0].slice(rootPath.length + 1);
    if (longestRelative.split('/').some(part => part === '.' || part === '..' || /[\u0000-\u001f]/u.test(part))) throw new Error('绝对路径无效或包含路径遍历。');
    for (const candidate of candidates) {
      const relative = candidate === rootPath ? '' : candidate.slice(rootPath.length + 1);
      if (!relative) return { kind: 'folder', path: handlePath ? rootPath : '.' };
      const parts = relative.split('/');
      const name = parts.pop()!;
      assertNotAborted(input.signal);
      try {
        let directory = authorizedRoot, prefix = '';
        for (const part of parts) {
          prefix = prefix ? `${prefix}/${part}` : part;
          directory = directories.get(prefix) ?? await directory.getDirectoryHandle(part);
          directories.set(prefix, directory);
          assertNotAborted(input.signal);
        }
        await directory.getDirectoryHandle(name);
        return { kind: 'folder', path: handlePath ? candidate : relative };
      } catch (error) {
        if (!(error instanceof DOMException) || !['NotFoundError', 'TypeMismatchError'].includes(error.name)) throw error;
      }
      assertNotAborted(input.signal);
      try {
        const directory = directories.get(parts.join('/'));
        if (!directory) continue;
        await directory.getFileHandle(name);
        if (!isAgentDocumentPath(candidate)) throw new Error(`该文件类型暂不支持读取：${candidate}`);
        return { kind: 'file', path: handlePath ? candidate : relative };
      } catch (error) {
        if (!(error instanceof DOMException) || !['NotFoundError', 'TypeMismatchError'].includes(error.name)) throw error;
      }
    }
    throw new Error(`未找到授权工作区中的路径：${candidates[0]}`);
  }
  const result: AgentSourceSelection[] = [];
  for (const candidates of requestCandidates) result.push(await resolve(candidates));
  assertNotAborted(input.signal);
  if (permission && await permission.call(root, { mode: 'read' }) !== 'granted') throw new Error('工作区读取权限已撤销，请重新授权该目录。');
  return result.filter((selection, index) => result.findIndex(other => other.kind === selection.kind && other.path === selection.path) === index);
}

/** Resolve this turn's referent without replacing or mutating the conversation's document catalog. */
export async function resolveConversationSourceTargets(
  input: ResolveConversationSourceTargetsInput,
): Promise<ConversationSourceTargets> {
  assertNotAborted(input.signal);
  const originalQuery = input.query.trim();
  const invalidFolders = invalidSourceSelectionMentions(originalQuery).filter(mention => mention.startsWith('@folder:'));
  if (invalidFolders.length) throw new Error('文件夹引用路径无效或包含路径遍历。');
  const selections = parseSourceSelections(originalQuery);
  if (selections.length) return { paths: pathsOnly(selections.filter(selection => selection.kind === 'file').map(selection => selection.path)), selections, reason: 'explicit-selection' };
  // URL paths and domains are web references, not implicit local file selections.
  const sourceQuery = documentSourceReferenceQuery(originalQuery);
  const query = sourceQuery.replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s"'`<>“”「」《》]+/giu, value => ' '.repeat(value.length));
  const absoluteSelections = await resolveAbsolutePathSelections(input, query);
  if (absoluteSelections.length) {
    return { paths: absoluteSelections.filter(selection => selection.kind === 'file').map(selection => selection.path), selections: absoluteSelections,
      reason: absoluteSelections.some(selection => selection.kind === 'folder') ? 'explicit-folder-path' : 'named-files' };
  }
  const relativeSelections = await resolveExplicitRelativeFolder(input, query);
  if (relativeSelections?.length) return { paths: [], selections: relativeSelections, reason: 'explicit-folder-path' };
  if (query !== sourceQuery && !explicitFilenameReferences(query).length && !isCurrentDocumentReference(query) && !isPreviousDocumentReference(query)) return { paths: [], reason: 'general' };
  if (!query || isTrivialQuery(query)) return { paths: [], reason: 'general' };
  if (requestsIndependentAnswer(query)) return { paths: [], reason: 'general' };

  const newTopic = startsNewDocumentTopic(query);
  const previous = newTopic ? [] : pathsOnly(input.referentPaths ?? input.knownPaths);
  const active = pathsOnly(input.activePath ? [input.activePath] : []);
  const activeContext = input.includeActiveDocumentContext && !newTopic
    ? active.filter(path => isAgentDocumentPath(path) && !isWorkspaceInstructionPath(path)) : [];
  const current = isCurrentDocumentReference(query) || (isFocusedDocumentRequest(query) && !isPreviousDocumentReference(query));
  const comparison = COMPARISON.test(query);
  const quotedName = quotedDocumentNames(query).length > 0;
  const hasFilename = explicitFilenameReferences(query).length > 0;
  const titleRequest = isDocumentTitleRequest(query);
  const workspaceSearch = /工作区|文件夹|目录|\b(?:workspace|folder|directory)\b/iu.test(query)
    && /查找|搜索|寻找|找出|找一下|\b(?:find|search|locate|look for)\b/iu.test(query);

  const wholeWorkspace = isWholeDirectoryRequest(query) && /工作区|文件夹|目录|\b(?:workspace|folder|directory)\b/iu.test(query);
  if ((workspaceSearch || wholeWorkspace) && !hasFilename) {
    if (!input.rootHandle) throw new Error('请先打开要搜索的工作区文件夹。');
    return { paths: [], selections: [{ kind: 'folder', path: '.' }], reason: 'workspace-discovery', notice: '已授权工作区可按需搜索；尚未读取任何文件内容。' };
  }

  if (!hasFilename && !quotedName && !current && isDocumentFollowup(query, { hasDocumentContext: previous.length > 0 })) {
    return historicalTargets(input, previous);
  }
  if (!previous.length && !hasFilename && !quotedName && !current && !isPreviousDocumentReference(query)
    && isDocumentFollowup(query, { hasDocumentContext: true })) return { paths: [], reason: 'general' };

  // A referent identifies an already supplied document. Resolve it before any
  // filename discovery, so unrelated workspace size cannot prevent its read.
  if (!hasFilename && !quotedName && !titleRequest && !current && (isPreviousDocumentReference(query) || DOCUMENT_ACTION.test(query) && DOCUMENT_SUBJECT.test(query))) {
    return previous.length ? historicalTargets(input, previous) : fileTargets(active.filter(path => !isWorkspaceInstructionPath(path)), 'active-document');
  }

  if (hasFilename) {
    // The current tab supplies a concrete file identity, including its complete
    // basename. Do not walk an unrelated workspace to resolve that same file.
    const activeMentions = namedMentions(query, active, false).filter(mention => {
      if (mention.name === active[0]) return true;
      const before = query.slice(0, mention.start).trimEnd();
      return !before || /["'`“「《([{，,。；;!?！？]$/u.test(before)
        || /(?:请|总结|阅读|通读|分析|解释|比较|对比|打开|查找|搜索|和|与|及|以及)$/u.test(before)
        || /\b(?:summari[sz]e|read|analy[sz]e|explain|compare|review|and|with|versus|vs)\s*$/iu.test(before);
    });
    const references = explicitFilenameReferences(query);
    if (activeMentions.length && references.every(reference => activeMentions.some(mention => reference.end > mention.start && reference.end <= mention.end))) {
      return fileTargets(active, 'active-named-file');
    }
    const authorizedPaths = pathsOnly([...input.knownPaths, ...previous, ...active]);
    const exact = namedMentions(query, authorizedPaths, false).filter(mention => mention.paths.every(path => path.includes('/') && path.toLocaleLowerCase() === mention.name.toLocaleLowerCase()));
    const quotedNames = quotedDocumentNames(query);
    if (exact.length && references.every(reference => exact.some(mention => reference.end > mention.start && reference.end <= mention.end))
      && quotedNames.every(name => exact.some(mention => mention.name === name))) {
      return fileTargets([...exact.flatMap(mention => mention.paths), ...(current && comparison ? active : [])], 'named-files');
    }
  }

  // An action on a concept does not name a file, even when a matching stem exists.
  if (hasFilename || quotedName || (!current && DOCUMENT_ACTION.test(query) && (!activeContext.length || titleRequest))) {
    const candidates = await discoverPaths(input);
    const mentions = namedMentions(query, candidates, quotedName || DOCUMENT_ACTION.test(query));
    for (const mention of mentions) {
      if (mention.paths.length > 1) throw new Error(`文件名“${mention.name}”对应多个文件，请指定完整路径：${mention.paths.join('、')}`);
    }
    const missing = explicitFilenameReferences(query).filter(reference => !mentions.some(mention => reference.end > mention.start && reference.end <= mention.end));
    if (missing.length) throw new Error(`未在当前已授权工作区找到文件：${missing.map(reference => reference.name).join('、')}。请确认文件名或提供路径。`);
    if (mentions.length) {
      const named = mentions.flatMap(mention => mention.paths);
      return fileTargets([...named, ...(current && comparison ? active : [])], 'named-files');
    }
  }

  if (current) {
    if (!active.length) throw new Error('当前没有打开的文件，请打开文件或指定文件名。');
    return fileTargets(comparison ? [...previous, ...active] : active, 'current-file');
  }
  // A short question can continue a paper explanation without repeating a pronoun or filename.
  // Callers must supply only the catalog for the current conversational topic.
  if (previous.length && /^(?:请问\s*)?(?:为什么|为何|如何|多少|是否|能否|\b(?:why|how|what)\b)/iu.test(query)
    && !newTopic) {
    return historicalTargets(input, previous);
  }
  if (activeContext.length) return fileTargets(activeContext, 'active-document-context');
  return { paths: [], reason: 'general' };
}
