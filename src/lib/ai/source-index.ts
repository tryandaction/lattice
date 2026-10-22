import { getAgentDocumentVersion, isAgentDocumentPath, isWorkspaceInstructionPath, openAgentDocumentSource, type AgentDocumentKind, type AgentDocumentUnitLabel } from './document-source';
import { isDesktopFileHandle, readDesktopFileMetadata } from '@/lib/desktop-file-system';
import { resolveAuthorizedDocumentLocation } from './document-source-capture';

/** Selection is authorization, not proof that any content has been read. */
export interface AgentSourceSelection { kind: 'file' | 'folder'; path: string }
export interface AgentSourceSnapshot {
  workspaceKey: string;
  path: string;
  sourceId: string;
  version: string;
  kind: AgentDocumentKind;
  totalUnits: number;
  unitLabel: AgentDocumentUnitLabel;
  permissionScope?: string;
  providerScope?: string;
  cloudIdentity?: import('./types').EvidenceRef['cloudIdentity'];
}
export interface AgentSourceEntry { path: string; name: string; sourceId: string; size: number; lastModified: number; supported: boolean }
export interface AgentSourceChunk {
  sourceId: string; path: string; version: string; unit: number; locator: string;
  text: string; startOffset: number; endOffset: number; completeUnit: boolean;
  unitLength?: number; matchStartOffset?: number; matchEndOffset?: number;
}
export interface AgentSourceRead {
  snapshot: AgentSourceSnapshot; chunks: AgentSourceChunk[]; complete: boolean;
  readUnits: number[]; pendingUnits: number[]; unreadableUnits: Array<{ unit: number; reason: string }>;
  scannedChars: number;
  /** Units inspected for search only; these are not presented as complete read evidence. */
  scannedUnits?: number[];
}
export interface AgentSourceInvalidation { path: string; reason: 'changed' | 'missing' | 'permission' | 'scope' | 'unsupported' | 'invalidated'; message?: string }
export interface AgentSourceValidation { valid: AgentSourceSnapshot[]; invalid: AgentSourceInvalidation[] }
export interface AgentSourceListOptions { cursor?: number; limit?: number; signal?: AbortSignal }
export interface AgentSourceReadOptions { path: string; expectedVersion?: string; units?: number[]; offsets?: Record<string, number>; maxChars?: number; maxUnits?: number; maxSourceBytes?: number; signal?: AbortSignal }
export interface AgentSourceSearchOptions { query: string; paths?: string[]; cursor?: number; maxFiles?: number; maxChars?: number; maxScanChars?: number; maxUnits?: number; maxResults?: number; snippetChars?: number; concurrency?: number; signal?: AbortSignal }
export interface AgentSourceSearchCoverage {
  path: string; sourceId: string; version: string; totalUnits: number; scannedUnits: number[];
  unreadableUnits: Array<{ unit: number; reason: string }>; pendingUnits: number[];
  partialUnit?: { unit: number; startOffset: number; endOffset: number; totalChars: number };
  complete: boolean;
  pendingUnitCount?: number; pendingUnitsTruncated?: boolean;
}
interface SourceSearchContinuation {
  query: string; pathsKey: string; fileIndex: number; totalScannedChars: number;
  path?: string; sourceId?: string; version?: string; snapshot?: AgentSourceSnapshot;
  unit: number; offset: number; overlap: string; scannedUnits: number[]; unreadableUnits: Array<{unit: number; reason: string}>;
  revisions: AgentSourceSnapshot[]; expiresAt: number;
  incompletePaths: string[];
}
export interface AgentSourceSearchResult {
  hits: AgentSourceChunk[]; reads: AgentSourceRead[]; invalid: AgentSourceInvalidation[];
  coverage: AgentSourceSearchCoverage[]; complete: boolean; nextCursor?: number; scannedFiles: number; scannedChars: number;
  totalScannedChars: number; maxChars: number; maxScanChars: number; maxResults: number; snippetChars: number; budgetExhausted: boolean;
  queryTerms: string[]; extractedChars: number; extractedUnits: number; maxSourceBytes: number;
  incompletePaths: string[];
}
export interface AuthorizedSourceIndex {
  assertScope(rootHandle: FileSystemDirectoryHandle, workspaceKey: string): void;
  list(options?: AgentSourceListOptions): Promise<{ entries: AgentSourceEntry[]; nextCursor?: number; complete: boolean }>;
  read(options: AgentSourceReadOptions): Promise<AgentSourceRead>;
  search(options: AgentSourceSearchOptions): Promise<AgentSourceSearchResult>;
  validateSnapshots(snapshots: readonly AgentSourceSnapshot[], signal?: AbortSignal): Promise<AgentSourceValidation>;
  invalidate(): void;
}

export function buildSourceSelectionMention(selection: AgentSourceSelection): string {
  // Encode each path segment independently so spaces, literal percent signs,
  // and separators all survive mention parsing unambiguously.
  const path = (selection.path || (selection.kind === 'folder' ? '.' : '')).split('/').map(encodeURIComponent).join('/');
  return selection.kind === 'folder' ? `@folder:${path}` : `@${path}`;
}
function sourceSelectionMentions(query: string): { selections: AgentSourceSelection[]; invalid: string[] } {
  const selections: AgentSourceSelection[] = [];
  const invalid: string[] = [];
  const expression = /@folder:([^\s@]*)|@(?!cloud(?:-folder)?:)([^\s@]+\.\w+)(?:#[^\s@]+)?/g;
  for (const match of query.matchAll(expression)) {
    try {
      const rawFolderPath = match[1] === undefined ? null : stripFolderRequestSuffix(match[1]);
      const decoded = decodeURIComponent(rawFolderPath ?? match[2]).replace(/[，。；,;]+$/, '').replace(/\/+$/u, '');
      const path = decoded;
      if (!path || /[\u0000-\u001f]/u.test(path) || path.split('/').some(part => part === '..' || (part === '.' && !(rawFolderPath !== null && path === '.')))) throw new Error('Invalid source selection.');
      selections.push({ kind: rawFolderPath !== null ? 'folder' : 'file', path });
    } catch { invalid.push(match[0]); }
  }
  return { selections: selections.filter((value, index) => selections.findIndex(other => other.kind === value.kind && other.path === value.path) === index), invalid: [...new Set(invalid)] };
}

function stripFolderRequestSuffix(value: string): string {
  const match = /(?:中|里|下|内)(?:的)?(?=(?:文章|论文|文档|文件|资料|笔记|所有|全部|有哪些|有哪|包含|含有|都|查找|搜索|阅读|通读|总结|分析|解释|讲述|比较|对比|内容))/u.exec(value);
  return match ? value.slice(0, match.index) : value;
}
export function parseSourceSelections(query: string): AgentSourceSelection[] { return sourceSelectionMentions(query).selections; }
/** Render-safe diagnostics; the caller keeps the original draft and can request a corrected selection. */
export function invalidSourceSelectionMentions(query: string): string[] { return sourceSelectionMentions(query).invalid; }
function abort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('Source read cancelled', 'AbortError'); }
function bound(value: number | undefined, fallback: number, maximum: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value!))) : fallback;
}
function normalize(root: FileSystemDirectoryHandle, path: string, folder = false): string {
  let value = path.trim().replace(/\\/g, '/').replace(/\/$/, '');
  if (folder && (value === '' || value === '.')) return '';
  if (!value || /[\u0000-\u001f]/u.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid source path.');
  const desktopRoot = (root as FileSystemDirectoryHandle & { fullPath?: string }).fullPath?.replace(/\\/g, '/').replace(/\/$/, '');
  if (/^[a-z]:\//i.test(value) || value.startsWith('/')) {
    const windows = desktopRoot && (/^[a-z]:\//i.test(desktopRoot) || desktopRoot.startsWith('//'));
    const candidate = windows ? value.toLowerCase() : value;
    const parent = windows ? desktopRoot.toLowerCase() : desktopRoot;
    if (!parent || (candidate !== parent && !candidate.startsWith(parent + '/'))) throw new Error('Source path outside authorized workspace.');
    value = value.slice(parent.length).replace(/^\//, '');
  }
  return value;
}
export function isSensitiveCredentialPath(path: string): boolean {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean).map(part => part.toLowerCase());
  const name = parts.at(-1) ?? '';
  if (parts.some(part => ['.ssh', 'credentials', 'credential', 'secrets', 'secret-store', 'private-keys'].includes(part))) return true;
  return name.startsWith('.env') || /^(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)(?:\.|$)/i.test(name)
    || /\.(?:pem|p12|pfx|key|keystore|jks)$/i.test(name)
    || /(?:^|[._-])(?:credentials?|secrets?|tokens?|api[_-]?keys?|private[_-]?keys?)(?:[._-]|$)/i.test(name);
}
function sourceSearchTerms(query: string): string[] {
  const quoted = [...query.matchAll(/["“「]([^"”」]{2,160})["”」]/gu)].map(match => match[1]);
  if (quoted.length) return [...new Set(quoted)].slice(0, 8);
  const chineseConcept = query.match(/(?:中的|里的)([\p{Script=Han}]{2,20}?)(?:是什么|是什么意思|是啥|的含义|的意思|如何|怎么|为何|为什么|[？?]|$)/u)?.[1]
    ?? query.match(/(?:关于|解释|说明)([\p{Script=Han}]{2,20}?)(?:是什么|是什么意思|是啥|的含义|的意思|如何|怎么|为何|为什么|[？?]|$)/u)?.[1];
  if (chineseConcept) return [chineseConcept];
  const words = query.match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,127}/gu) ?? [];
  const stop = /^(?:what|which|when|where|why|how|does|do|did|is|are|was|were|the|this|that|these|those|in|on|at|by|to|of|for|from|and|or|with|without|a|an|as|be|been|it|its|their|paper|document|pdf|please|explain|mean|means|describe|find|search|about|can|could|you|tell|me)$/iu;
  const terms = words.filter(word => !stop.test(word));
  const named = terms.filter(word => /[_\d-]/u.test(word));
  if (named.length) return [...new Set(named)].slice(0, 8);
  if (terms.length > 1) return [...new Set(terms)].slice(0, 8);
  return terms.length ? terms : [query];
}
function pendingSearchUnits(totalUnits: number, scanned: ReadonlySet<number> = new Set()): { units: number[]; count: number } {
  const units: number[] = [];
  let count = 0;
  for (let unit = 1; unit <= totalUnits; unit++) if (!scanned.has(unit)) { count++; if (units.length < 128) units.push(unit); }
  return {units, count};
}
function invalidation(path: string, error: unknown): AgentSourceInvalidation {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof DOMException ? error.name : '';
  return { path, reason: name === 'NotAllowedError' || /permission/i.test(message) ? 'permission'
    : name === 'NotFoundError' || name === 'TypeMismatchError' ? 'missing'
      : /Unsupported/i.test(message) ? 'unsupported' : /invalidated/i.test(message) ? 'invalidated' : 'changed', message };
}
async function directory(root: FileSystemDirectoryHandle, path: string): Promise<{ handle: FileSystemDirectoryHandle; path: string }> {
  const value = normalize(root, path, true);
  if (!value) return { handle: root, path: '' };
  const resolve = async (candidate: string) => {
    let handle = root;
    for (const part of candidate.split('/').filter(Boolean)) handle = await handle.getDirectoryHandle(part);
    return { handle, path: candidate };
  };
  const absolute = /^[a-z]:[\\/]/i.test(path) || path.startsWith('/');
  if (!absolute && value === root.name) {
    try { await root.getDirectoryHandle(value); }
    catch (error) { if (error instanceof DOMException && ['NotFoundError', 'TypeMismatchError'].includes(error.name)) return { handle: root, path: '' }; throw error; }
    throw new Error('Source folder path is ambiguous; select . for the workspace root or an absolute child path.');
  }
  if (absolute || !value.startsWith(root.name + '/')) return resolve(value);
  const candidates = await Promise.allSettled([resolve(value), resolve(value.slice(root.name.length + 1))]);
  const failure = candidates.find(item => item.status === 'rejected' && !['NotFoundError', 'TypeMismatchError'].includes(item.reason?.name));
  if (failure?.status === 'rejected') throw failure.reason;
  const matches = candidates.filter((item): item is PromiseFulfilledResult<{ handle: FileSystemDirectoryHandle; path: string }> => item.status === 'fulfilled');
  if (matches.length > 1) throw new Error('Source folder path is ambiguous; select a root-relative folder.');
  if (!matches.length) throw new DOMException('Source folder missing', 'NotFoundError');
  return matches[0].value;
}

/** No global cache: an index belongs to one explicit workspace/permission selection. */
export function createAuthorizedSourceIndex(input: {
  rootHandle: FileSystemDirectoryHandle; workspaceKey: string; selections: readonly AgentSourceSelection[]; permissionScope?: string;
  maxDirectories?: number; maxDiscoveryEntries?: number;
}): AuthorizedSourceIndex {
  const root = input.rootHandle;
  const selections = input.selections.map(selection => ({ ...selection, originalPath: selection.path, path: normalize(root, selection.path, selection.kind === 'folder') }));
  type ResolvedSelection = { kind: 'file'; handle: FileSystemFileHandle; path: string } | { kind: 'folder'; handle: FileSystemDirectoryHandle; path: string };
  let resolvedSelections: Promise<ResolvedSelection[]> | undefined;
  let selectionFailures: unknown[] = [];
  function resolveSelections(): Promise<ResolvedSelection[]> {
    return resolvedSelections ??= Promise.allSettled(selections.map(async selection => selection.kind === 'file'
      ? { ...await resolveAuthorizedDocumentLocation(root, selection.originalPath), kind: 'file' as const }
      : { ...await directory(root, selection.originalPath), kind: 'folder' as const })).then(results => {
        selectionFailures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        return results.filter((result): result is PromiseFulfilledResult<ResolvedSelection> => result.status === 'fulfilled').map(result => result.value);
      });
  }
  let invalidated = false;
  let iterator: AsyncGenerator<AgentSourceEntry> | undefined;
  let exhausted = false;
  let listing: Promise<void> = Promise.resolve();
  let discoverySignal: AbortSignal | undefined;
  const maxDirectories = bound(input.maxDirectories, 4096, 20_000), maxDiscoveryEntries = bound(input.maxDiscoveryEntries, 20_000, 100_000);
  const entries: AgentSourceEntry[] = [];
  const seen = new Set<string>();
  const maxSearchCursors = 64;
  let nextSearchCursor = 0;
  const searchCursors = new Map<number, SourceSearchContinuation>();
  const activeSearchCursors = new Set<number>();
  const sourceId = (path: string) => `lattice-workspace:${encodeURIComponent(input.workspaceKey)}:${encodeURIComponent(path)}`;
  async function check(signal?: AbortSignal) {
    abort(signal);
    if (invalidated) throw new Error('Source index invalidated.');
    const query = (root as FileSystemDirectoryHandle & { queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState> }).queryPermission;
    if (query && await query.call(root, { mode: 'read' }) !== 'granted') throw new Error('Workspace source permission revoked; select the workspace again.');
    abort(signal);
    if (invalidated) throw new Error('Source index invalidated.');
  }
  async function* discover(): AsyncGenerator<AgentSourceEntry> {
    const visited = new Set<string>();
    let discoveredEntries = 0;
    async function* walk(handle: FileSystemDirectoryHandle, prefix: string): AsyncGenerator<AgentSourceEntry> {
      if (visited.has(prefix)) return;
      if (visited.size >= maxDirectories) throw new Error('Source directory discovery budget exceeded; select a smaller folder or use paged search.');
      visited.add(prefix);
      for await (const item of handle.values()) {
        await check(discoverySignal);
        if (++discoveredEntries > maxDiscoveryEntries) throw new Error('Source entry discovery budget exceeded; select a smaller folder or use paged search.');
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.kind === 'directory') {
          if (item.name.startsWith('.') || ['node_modules', 'dist', 'build', 'target', 'cache', 'credentials', 'credential', 'secrets', 'secret-store', '.ssh', 'private-keys'].includes(item.name.toLowerCase())) continue;
          yield* walk(item as FileSystemDirectoryHandle, path);
        } else if (!item.name.startsWith('.') && !isWorkspaceInstructionPath(path) && !isSensitiveCredentialPath(path)) yield await metadata(path, item as FileSystemFileHandle);
      }
    }
    async function metadata(path: string, handle: FileSystemFileHandle): Promise<AgentSourceEntry> {
      if (isDesktopFileHandle(handle)) {
        const stat = await readDesktopFileMetadata(handle.fullPath);
        await check(discoverySignal);
        return { path, name: handle.name, sourceId: sourceId(path), size: stat.size, lastModified: stat.modifiedMs ?? 0, supported: isAgentDocumentPath(path) };
      }
      const file = await handle.getFile();
      return { path, name: file.name, sourceId: sourceId(path), size: file.size, lastModified: file.lastModified, supported: isAgentDocumentPath(path) };
    }
    const resolved = await resolveSelections();
    if (selectionFailures.length) throw selectionFailures[0];
    for (const selection of resolved) {
      await check(discoverySignal);
      if (isSensitiveCredentialPath(selection.path)) throw new Error('Selected credential or secret files and folders are excluded from source discovery.');
      if (selection.kind === 'file') yield await metadata(selection.path, selection.handle);
      else yield* walk(selection.handle, selection.path);
    }
  }
  async function list(options: AgentSourceListOptions = {}) {
    await check(options.signal);
    const cursor = Math.max(0, Math.floor(options.cursor ?? 0));
    const limit = bound(options.limit, 100, 500);
    // Serialize the shared iterator; separate reads/searches remain concurrent.
    const work = listing.then(async () => {
      discoverySignal = options.signal;
      try {
        iterator ??= discover();
        while (!exhausted && entries.length < cursor + limit) {
          await check(options.signal);
          const next = await iterator.next();
          await check(options.signal);
          if (next.done) { exhausted = true; break; }
          if (!seen.has(next.value.path)) { entries.push(next.value); seen.add(next.value.path); }
        }
      } catch (error) { iterator = undefined; throw error; }
      finally { discoverySignal = undefined; }
    });
    listing = work.catch(() => undefined);
    await work;
    const result = entries.slice(cursor, cursor + limit);
    return { entries: result, complete: exhausted && cursor + result.length >= entries.length,
      ...(!exhausted || cursor + result.length < entries.length ? { nextCursor: cursor + result.length } : {}) };
  }
  async function authorized(path: string) {
    return (await resolveSelections()).some(selection => selection.kind === 'file' ? selection.path === path : !selection.path || path.startsWith(selection.path + '/'));
  }
  async function read(options: AgentSourceReadOptions): Promise<AgentSourceRead> {
    await check(options.signal);
    const requested = normalize(root, options.path);
    if (isSensitiveCredentialPath(requested)) throw new Error('Credential or secret files are excluded from authorized source reads.');
    if (!await authorized(requested) && !(requested.startsWith(root.name + '/') && await authorized(requested.slice(root.name.length + 1)))) throw new Error('Source path is outside the authorized selection.');
    const location = await resolveAuthorizedDocumentLocation(root, options.path), path = location.path;
    if (!await authorized(path)) throw new Error('Source path is outside the authorized selection.');
    if (isWorkspaceInstructionPath(path) && !(await resolveSelections()).some(selection => selection.kind === 'file' && selection.path === path)) {
      throw new Error('工作区规则文件需要显式选择，不能自动作为研究材料读取。');
    }
    const maxSourceBytes = bound(options.maxSourceBytes, 32_000_000, 128_000_000);
    if (isDesktopFileHandle(location.handle)) {
      const stat = await readDesktopFileMetadata(location.handle.fullPath);
      await check(options.signal);
      if (stat.size > maxSourceBytes) throw new Error('Source exceeds the extraction byte budget; choose a smaller source.');
    }
    const file = await location.handle.getFile();
    if (file.size > maxSourceBytes) throw new Error('Source exceeds the extraction byte budget; choose a smaller source.');
    const source = await openAgentDocumentSource(file, path, options.signal);
    try {
      await check(options.signal);
      if (options.expectedVersion && source.version !== options.expectedVersion) throw new Error('Source changed; select or reread its current revision.');
      const snapshot: AgentSourceSnapshot = { workspaceKey: input.workspaceKey, path, sourceId: sourceId(path), version: source.version,
        kind: source.kind, totalUnits: source.totalUnits, unitLabel: source.unitLabel, ...(input.permissionScope ? { permissionScope: input.permissionScope } : {}) };
      const requested = [...new Set(options.units ?? Array.from({ length: source.totalUnits }, (_, i) => i + 1))];
      const maxChars = bound(options.maxChars, 60_000, 1_000_000), maxUnits = bound(options.maxUnits, 512, 4096);
      const chunks: AgentSourceChunk[] = [], readUnits: number[] = [], unreadableUnits: Array<{ unit: number; reason: string }> = [];
      let scannedChars = 0;
      for (const unit of requested) {
        await check(options.signal);
        if (scannedChars >= maxChars || readUnits.length + unreadableUnits.length >= maxUnits) break;
        const result = await source.readUnit(unit, options.signal);
        await check(options.signal);
        if (result.status === 'unreadable') { unreadableUnits.push({ unit, reason: result.reason ?? 'unreadable' }); continue; }
        const startOffset = options.offsets?.[String(unit)] ?? 0;
        if (!Number.isSafeInteger(startOffset) || startOffset < 0 || startOffset > result.text.length) throw new Error('Invalid source unit offset.');
        const text = result.text.slice(startOffset, startOffset + maxChars - scannedChars);
        scannedChars += text.length;
        const completeUnit = startOffset === 0 && text.length === result.text.length;
        if (completeUnit) readUnits.push(unit);
        if (text) chunks.push({ sourceId: snapshot.sourceId, path, version: source.version, unit,
          locator: result.locator ?? `${path}#${source.unitLabel}=${unit}`, text, startOffset, endOffset: startOffset + text.length, completeUnit, unitLength: result.text.length });
        if (startOffset + text.length < result.text.length) break;
      }
      const pendingUnits = Array.from({ length: source.totalUnits }, (_, i) => i + 1).filter(unit => !readUnits.includes(unit));
    return { snapshot, chunks, readUnits, unreadableUnits, pendingUnits, complete: pendingUnits.length === 0, scannedChars, scannedUnits: readUnits };
    } finally { await source.close(); }
  }
  async function validateSnapshots(snapshots: readonly AgentSourceSnapshot[], signal?: AbortSignal): Promise<AgentSourceValidation> {
    const valid: AgentSourceSnapshot[] = [], invalid: AgentSourceInvalidation[] = [];
    for (const snapshot of snapshots) {
      abort(signal);
      if (snapshot.workspaceKey !== input.workspaceKey || snapshot.permissionScope !== input.permissionScope) { invalid.push({ path: snapshot.path, reason: 'scope' }); continue; }
      if (isSensitiveCredentialPath(snapshot.path)) { invalid.push({ path: snapshot.path, reason: 'scope' }); continue; }
      try {
        await check(signal);
        const location = await resolveAuthorizedDocumentLocation(root, snapshot.path);
        if (!await authorized(location.path)) { invalid.push({ path: snapshot.path, reason: 'scope' }); continue; }
        const file = await location.handle.getFile();
        if (await getAgentDocumentVersion(file, snapshot.path, signal) !== snapshot.version) invalid.push({ path: snapshot.path, reason: 'changed' });
        else { await check(signal); valid.push(snapshot); }
      } catch (error) { if (signal?.aborted) throw error; invalid.push(invalidation(snapshot.path, error)); }
    }
    return { valid, invalid };
  }
  async function search(options: AgentSourceSearchOptions): Promise<AgentSourceSearchResult> {
    await check(options.signal);
    const normalizedQuery = options.query.trim();
    if (!normalizedQuery || normalizedQuery.length > 512) throw new Error('Source search query must contain 1 to 512 characters.');
    const query = normalizedQuery.toLocaleLowerCase();
    const terms = sourceSearchTerms(normalizedQuery);
    const targetPaths: string[] = [];
    if (options.paths !== undefined) {
      if (!Array.isArray(options.paths) || !options.paths.length || options.paths.length > 100) throw new Error('Search paths must contain 1 to 100 authorized files.');
      for (const requested of options.paths) {
        if (typeof requested !== 'string' || isSensitiveCredentialPath(normalize(root, requested))) throw new Error('Credential or secret files are excluded from search.');
        const location = await resolveAuthorizedDocumentLocation(root, requested);
        if (!await authorized(location.path)) throw new Error('Search target is outside the authorized selection.');
        if (isWorkspaceInstructionPath(location.path) && !(await resolveSelections()).some(selection => selection.kind === 'file' && selection.path === location.path)) throw new Error('Workspace rules require explicit file selection.');
        if (!targetPaths.includes(location.path)) targetPaths.push(location.path);
      }
    }
    const pathsKey = JSON.stringify(targetPaths);
    const maxFiles = bound(options.maxFiles, 32, 64), maxChars = bound(options.maxChars, 180_000, 1_000_000);
    const maxScanChars = Math.min(maxChars, bound(options.maxScanChars, maxChars, 4_000_000)), maxUnits = bound(options.maxUnits, 512, 4096);
    const maxResults = bound(options.maxResults, 12, 100);
    const longestTerm = Math.max(...terms.map(term => term.length));
    const snippetChars = Math.max(longestTerm, bound(options.snippetChars, 600, 4000));
    const suppliedCursor = options.cursor;
    const claimCursor = suppliedCursor !== undefined && suppliedCursor !== 0;
    if (claimCursor && activeSearchCursors.has(suppliedCursor)) throw new Error('Source search continuation cursor is already in use.');
    if (claimCursor) activeSearchCursors.add(suppliedCursor);
    try {
    const state: SourceSearchContinuation = suppliedCursor === undefined || suppliedCursor === 0
      ? { query, pathsKey, fileIndex: 0, totalScannedChars: 0, unit: 1, offset: 0, overlap: '', scannedUnits: [], unreadableUnits: [], revisions: [], expiresAt: Date.now() + 600000, incompletePaths: [] }
      : { ...searchCursors.get(suppliedCursor)! };
    if (suppliedCursor !== undefined && suppliedCursor !== 0 && !searchCursors.has(suppliedCursor)) throw new Error('Source search continuation cursor is unknown or expired; restart the bounded search.');
    if (state.expiresAt < Date.now()) { if (suppliedCursor) searchCursors.delete(suppliedCursor); throw new Error('Source search continuation cursor expired; restart from cursor 0.'); }
    if (state.query !== query || state.pathsKey !== pathsKey) throw new Error('Source search continuation cursor belongs to a different query or target paths.');
    if (state.revisions.length) {
      const validation = await validateSnapshots(state.revisions, options.signal);
      if (validation.invalid.length) throw new Error('Source changed during paged search; restart from cursor 0.');
    }
    // Cursor values are opaque, workspace/index-local, query-bound checkpoints; zero always means a new scan.
    const pageStart = state.fileIndex;
    const page = targetPaths.length ? { entries: targetPaths.slice(pageStart, pageStart + maxFiles).map(path => ({ path, supported: isAgentDocumentPath(path) })), complete: pageStart + maxFiles >= targetPaths.length }
      : await list({ cursor: pageStart, limit: maxFiles, signal: options.signal });
    const hits: AgentSourceChunk[] = [], reads: AgentSourceRead[] = [], invalid: AgentSourceInvalidation[] = [], coverage: AgentSourceSearchCoverage[] = [];
    let remainingChars = maxChars, remainingUnits = maxUnits, remainingScanChars = maxScanChars, scannedChars = 0, scannedFiles = 0, extractedChars = 0, extractedUnits = 0;
    let returnedChars = 0;
    let entryIndex = 0;
    const sensitive = (path: string) => isSensitiveCredentialPath(path);
    while (entryIndex < page.entries.length && remainingChars > 0 && remainingScanChars > 0 && remainingUnits > 0 && hits.length < maxResults && returnedChars < 60000) {
      await check(options.signal);
      const entry = page.entries[entryIndex];
      if (!entry.supported) { entryIndex++; state.fileIndex++; state.path = undefined; state.snapshot = undefined; continue; }
      if (sensitive(entry.path)) { entryIndex++; state.fileIndex++; state.path = undefined; state.snapshot = undefined; continue; }
      scannedFiles++;
      let source: Awaited<ReturnType<typeof openAgentDocumentSource>> | undefined;
      let snapshot: AgentSourceSnapshot | undefined;
      try {
        if (!await authorized(entry.path)) throw new Error('Source path is outside the authorized selection.');
        const location = await resolveAuthorizedDocumentLocation(root, entry.path);
        if (!await authorized(location.path) || isSensitiveCredentialPath(location.path)) throw new Error('Source path is outside the authorized source scope.');
        const maxSourceBytes = 32_000_000;
        if (isDesktopFileHandle(location.handle)) {
          const stat = await readDesktopFileMetadata(location.handle.fullPath); await check(options.signal);
          if (stat.size > maxSourceBytes) throw new Error('Source exceeds the extraction byte budget; choose a smaller source.');
        }
        const file = await location.handle.getFile();
        if (file.size > maxSourceBytes) throw new Error('Source exceeds the extraction byte budget; choose a smaller source.');
        source = await openAgentDocumentSource(file, location.path, options.signal); await check(options.signal);
        const expected = state.path === location.path ? state.snapshot : undefined;
        if (expected && source.version !== expected.version) throw new Error('Source changed during paged search; restart from cursor 0.');
        snapshot = { workspaceKey: input.workspaceKey, path: location.path, sourceId: sourceId(location.path), version: source.version, kind: source.kind,
          totalUnits: source.totalUnits, unitLabel: source.unitLabel, ...(input.permissionScope ? { permissionScope: input.permissionScope } : {}) };
        state.path = location.path; state.snapshot = snapshot;
        if (!state.revisions.some(item => item.path === snapshot!.path)) {
          if (state.revisions.length >= 100) throw new Error('Search continuation revision budget exceeded; target fewer source paths.');
          state.revisions = [...state.revisions, snapshot];
        }
      } catch (error) {
        await source?.close();
        if (options.signal?.aborted) throw error;
        if (state.snapshot?.path === entry.path && /changed|revision|restart/i.test(error instanceof Error ? error.message : String(error))) throw error;
        state.incompletePaths = [...new Set([...state.incompletePaths, entry.path])];
        invalid.push(invalidation(entry.path, error)); entryIndex++; state.fileIndex++; state.path = undefined; state.snapshot = undefined; state.unit = 1; state.offset = 0; state.overlap = '';
        continue;
      }
      const scannedUnits = new Set<number>(state.scannedUnits), unreadableUnits: Array<{ unit: number; reason: string }> = [...state.unreadableUnits];
      let fileScannedChars = 0;
      let partialUnit: AgentSourceSearchCoverage['partialUnit'];
      try {
      while (source && state.unit <= source.totalUnits && remainingChars > 0 && remainingScanChars > 0 && remainingUnits > 0 && hits.length < maxResults && returnedChars < 60000) {
        await check(options.signal);
        const unit = state.unit, result = await source.readUnit(unit, options.signal); await check(options.signal);
        remainingUnits--;
        extractedUnits++; extractedChars += result.text.length;
        if (result.status === 'unreadable') {
          unreadableUnits.push({ unit, reason: result.reason ?? 'unreadable' }); state.unit++; state.offset = 0; state.overlap = ''; continue;
        }
        const availableChars = Math.min(result.text.length - state.offset, remainingChars, remainingScanChars);
        if (availableChars <= 0 && state.offset >= result.text.length) { scannedUnits.add(unit); state.unit++; state.offset = 0; state.overlap = ''; continue; }
        if (availableChars <= 0) break;
        const startOffset = state.offset, segment = result.text.slice(startOffset, startOffset + availableChars);
        const combined = state.overlap + segment;
        const combinedStart = Math.max(0, startOffset - state.overlap.length);
        const matches = terms.flatMap(term => {
          const expression = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
          return [...combined.matchAll(expression)].map(match => ({ start: match.index!, length: match[0].length }));
        }).sort((a,b) => a.start - b.start || b.length - a.length);
        let consumedChars = segment.length;
        for (const match of matches) {
          if (hits.length >= maxResults || returnedChars >= 60000) break;
          const matchStartOffset = combinedStart + match.start, matchEndOffset = matchStartOffset + match.length;
          if (matchEndOffset > startOffset) {
            const context = Math.max(0, Math.floor((snippetChars - match.length) / 2));
            const availableOutput = 60000 - returnedChars;
            if (availableOutput < match.length) { consumedChars = Math.max(0, matchStartOffset - startOffset); break; }
            const excerptSize = Math.min(snippetChars, availableOutput);
            const excerptStart = Math.max(0, matchStartOffset - Math.min(context, excerptSize - match.length));
            const excerptEnd = Math.min(result.text.length, excerptStart + excerptSize);
            const text = result.text.slice(excerptStart, excerptEnd);
            returnedChars += text.length;
            hits.push({ sourceId: snapshot!.sourceId, path: snapshot!.path, version: snapshot!.version, unit, locator: result.locator ?? `${snapshot!.path}#${source.unitLabel}=${unit}`,
              text, startOffset: excerptStart, endOffset: excerptEnd, matchStartOffset, matchEndOffset,
              completeUnit: startOffset + segment.length === result.text.length && excerptStart === 0 && excerptEnd === result.text.length, unitLength: result.text.length });
            if (hits.length === maxResults || returnedChars >= 60000) consumedChars = Math.max(1, matchEndOffset - startOffset);
          }
        }
        state.offset += consumedChars; remainingChars -= segment.length; remainingScanChars -= segment.length; scannedChars += segment.length; fileScannedChars += segment.length;
        state.totalScannedChars += segment.length;
        const overlapLength = Math.min(Math.max(...terms.map(term => term.length)) - 1, state.offset);
        state.overlap = overlapLength ? result.text.slice(state.offset - overlapLength, state.offset) : '';
        if (state.offset >= result.text.length) { scannedUnits.add(unit); state.unit++; state.offset = 0; state.overlap = ''; partialUnit = undefined; }
        else { partialUnit = { unit, startOffset, endOffset: state.offset, totalChars: result.text.length }; break; }
      }
      state.scannedUnits = [...scannedUnits]; state.unreadableUnits = [...unreadableUnits];
      if (unreadableUnits.length) state.incompletePaths = [...new Set([...state.incompletePaths, snapshot!.path])];
      const pending = pendingSearchUnits(source!.totalUnits, scannedUnits), pendingUnits = pending.units;
      coverage.push({ path: snapshot!.path, sourceId: snapshot!.sourceId, version: snapshot!.version, totalUnits: source!.totalUnits,
        scannedUnits: [...scannedUnits], unreadableUnits, pendingUnits, pendingUnitCount: pending.count, pendingUnitsTruncated: pending.count > pendingUnits.length,
        ...(partialUnit ? { partialUnit } : {}), complete: pending.count === 0 && unreadableUnits.length === 0 && !partialUnit });
      // Search presents only bounded matched excerpts; scanned pages are separate from complete read evidence.
      const fileHits = hits.filter(hit => hit.path === snapshot!.path);
      if (fileHits.length) reads.push({ snapshot: snapshot!, chunks: fileHits, complete: false, readUnits: [], pendingUnits: pendingSearchUnits(source!.totalUnits).units,
        unreadableUnits, scannedChars: fileScannedChars, scannedUnits: [...scannedUnits] });
      } finally { await source!.close(); }
      const fileDone = state.unit > source!.totalUnits || (state.unit === source!.totalUnits + 1);
      if (fileDone) { entryIndex++; state.fileIndex++; state.path = undefined; state.sourceId = undefined; state.version = undefined; state.snapshot = undefined; state.unit = 1; state.offset = 0; state.overlap = ''; state.scannedUnits = []; state.unreadableUnits = []; }
      else break;
      if (hits.length >= maxResults || returnedChars >= 60000 || remainingChars <= 0 || remainingScanChars <= 0 || remainingUnits <= 0) break;
    }
    await check(options.signal);
    if (suppliedCursor && suppliedCursor !== 0) searchCursors.delete(suppliedCursor);
    const pageConsumed = entryIndex >= page.entries.length;
    const hasMore = !pageConsumed || !page.complete || Boolean(state.path);
    const complete = !hasMore && invalid.length === 0 && state.incompletePaths.length === 0 && coverage.every(item => item.complete);
    let nextCursor: number | undefined;
    if (hasMore) {
      nextCursor = ++nextSearchCursor;
      searchCursors.set(nextCursor, { ...state, scannedUnits: [...state.scannedUnits], unreadableUnits: [...state.unreadableUnits], expiresAt: Date.now() + 600000 });
      while (searchCursors.size > maxSearchCursors) { const oldest = searchCursors.keys().next().value as number | undefined; if (oldest === undefined) break; searchCursors.delete(oldest); }
    }
    const budgetExhausted = Boolean(nextCursor && (remainingChars <= 0 || remainingScanChars <= 0 || remainingUnits <= 0 || hits.length >= maxResults || returnedChars >= 60000));
    return { hits, reads, invalid, coverage, complete, ...(nextCursor ? { nextCursor } : {}), scannedFiles, scannedChars, totalScannedChars: state.totalScannedChars,
      maxChars, maxScanChars, maxResults, snippetChars, budgetExhausted, queryTerms: terms, extractedChars, extractedUnits, maxSourceBytes: 32_000_000, incompletePaths: state.incompletePaths };
    } finally { if (claimCursor) activeSearchCursors.delete(suppliedCursor); }
  }
  return { list, read, search, validateSnapshots,
    assertScope(rootHandle, workspaceKey) { if (rootHandle !== root || workspaceKey !== input.workspaceKey) throw new Error('Source index workspace scope does not match the PDF tool workspace.'); },
    invalidate() { invalidated = true; entries.length = 0; seen.clear(); searchCursors.clear(); activeSearchCursors.clear(); void iterator?.return(undefined); } };
}
