import { isAgentDocumentPath, isWorkspaceInstructionPath } from './document-source';
import { isSensitiveCredentialPath } from './source-index';

export interface MentionWorkspaceEntry {
  kind: 'file' | 'folder';
  path: string;
  name: string;
}

const ignoredDirectories = new Set(['node_modules', 'dist', 'build', 'target', 'cache', 'credentials', 'credential', 'secrets', 'secret-store', 'private-keys']);

export function normalizeMentionFolderPath(value: string, encoded = false): string {
  const decoded = encoded ? decodeURIComponent(value) : value;
  const path = decoded.replace(/\\/g, '/').replace(/\/+$/gu, '');
  if (path === '.' || path === '') return '';
  if (path.startsWith('/') || /^[a-z]:\//iu.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f]/u.test(part))) {
    throw new Error('Invalid mention folder path.');
  }
  return path;
}

export function inferMentionFolderPath(query: string): string | null {
  const match = /(?:中|里|下|内)(?:的)?(?=(?:文章|论文|文档|文件|资料|笔记|所有|全部|有哪些|有哪|包含|含有|都|查找|搜索|阅读|通读|总结|分析|解释|讲述|比较|对比|内容))/u.exec(query);
  if (!match) return null;
  try {
    const path = normalizeMentionFolderPath(query.slice(0, match.index));
    return path.includes('/') ? path : null;
  } catch { return null; }
}

export async function listMentionWorkspaceEntries(
  root: FileSystemDirectoryHandle,
  folderPath = '',
  query = '',
): Promise<MentionWorkspaceEntry[]> {
  const normalized = normalizeMentionFolderPath(folderPath);
  const permission = (root as FileSystemDirectoryHandle & { queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState> }).queryPermission;
  if (permission && await permission.call(root, { mode: 'read' }) !== 'granted') throw new DOMException('Workspace read permission was revoked.', 'NotAllowedError');
  let directory = root;
  let parts = normalized ? normalized.split('/') : [];
  if (parts[0]?.toLocaleLowerCase() === root.name.toLocaleLowerCase() && parts.length > 1) {
    const resolve = async (candidate: string[]) => {
      let handle = root;
      for (const part of candidate) handle = await handle.getDirectoryHandle(part);
      return { handle, parts: candidate };
    };
    const candidates = await Promise.allSettled([resolve(parts), resolve(parts.slice(1))]);
    const unexpected = candidates.find(result => result.status === 'rejected'
      && (!(result.reason instanceof DOMException) || !['NotFoundError', 'TypeMismatchError'].includes(result.reason.name)));
    if (unexpected?.status === 'rejected') throw unexpected.reason;
    const matches = candidates.filter((result): result is PromiseFulfilledResult<{ handle: FileSystemDirectoryHandle; parts: string[] }> => result.status === 'fulfilled');
    if (matches.length > 1) throw new Error('Folder path is ambiguous in the authorized workspace. Use a root-relative path.');
    if (!matches.length) throw new DOMException('Mention folder not found.', 'NotFoundError');
    directory = matches[0].value.handle;
    parts = matches[0].value.parts;
  }
  if (directory === root) for (const part of parts) directory = await directory.getDirectoryHandle(part);

  const prefix = parts.join('/');
  const needle = query.trim().toLocaleLowerCase();
  const entries: MentionWorkspaceEntry[] = [];
  let inspected = 0;
  for await (const entry of directory.values()) {
    if (++inspected > 20_000) throw new Error('This folder has too many entries to browse at once. Search within a smaller folder.');
    if (entry.name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      if (ignoredDirectories.has(entry.name.toLocaleLowerCase()) || isSensitiveCredentialPath(path)) continue;
      if (needle && !path.toLocaleLowerCase().includes(needle) && !entry.name.toLocaleLowerCase().includes(needle)) continue;
      entries.push({ kind: 'folder', path, name: entry.name });
    } else if (!isSensitiveCredentialPath(path) && isAgentDocumentPath(path) && !isWorkspaceInstructionPath(path)) {
      if (!needle || path.toLocaleLowerCase().includes(needle) || entry.name.toLocaleLowerCase().includes(needle)) entries.push({ kind: 'file', path, name: entry.name });
    }
  }
  if (permission && await permission.call(root, { mode: 'read' }) !== 'granted') throw new DOMException('Workspace read permission was revoked.', 'NotAllowedError');
  return entries.sort((left, right) => left.kind === right.kind
    ? left.name.localeCompare(right.name) : left.kind === 'folder' ? -1 : 1);
}
