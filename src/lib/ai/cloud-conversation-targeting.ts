import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
import { parseCloudSourceSelections, type CloudAgentSourceSelection, type CloudAgentSourceSnapshot } from './cloud-source';
import { resolveConversationSourceTargets } from './conversation-source-targeting';
import { isAgentDocumentPath } from './document-source';
import { hasNamedDocumentReference, requestsIndependentAnswer, documentSourceReferenceQuery } from './document-reference-intent';

export interface ResolveCloudConversationTargetsInput {
  query: string;
  provider: CloudLibrarySourceProvider;
  knownSnapshots: readonly CloudAgentSourceSnapshot[];
  activeResource: CloudLibraryResource | null;
  referentPaths?: readonly string[];
  signal?: AbortSignal;
}

export interface CloudConversationTargets {
  paths: string[];
  selections: CloudAgentSourceSelection[];
  reason: string;
}

export async function resolveCloudConversationTargets(input: ResolveCloudConversationTargetsInput): Promise<CloudConversationTargets> {
  const scope = input.provider.scope;
  const check = () => {
    if (input.signal?.aborted) throw new DOMException('Cloud source targeting cancelled', 'AbortError');
    if (input.provider.scope !== scope) throw new Error('云账号或权限 scope 已变化，请重新选择来源。');
  };
  check();
  const scoped = input.knownSnapshots.filter(snapshot => snapshot.providerScope === scope);
  const libraryId = input.activeResource?.libraryId ?? scoped[0]?.cloudIdentity.libraryId;
  const known = scoped.filter(snapshot => snapshot.cloudIdentity.libraryId === libraryId)
    .filter((snapshot, index, all) => all.findIndex(other => other.cloudIdentity.itemId === snapshot.cloudIdentity.itemId) === index);
  const identities = new Map(known.map(snapshot => [snapshot.path, snapshot.cloudIdentity]));
  if (input.activeResource) identities.set(input.activeResource.id, { resourceId: input.activeResource.id, libraryId: input.activeResource.libraryId,
    itemId: input.activeResource.itemId, name: input.activeResource.name, role: input.activeResource.role, version: '', versionId: input.activeResource.versionId });

  async function verified(selections: CloudAgentSourceSelection[], reason: string): Promise<CloudConversationTargets> {
    const unique = selections.filter((selection, index, all) => all.findIndex(other => other.libraryId === selection.libraryId && other.itemId === selection.itemId && other.kind === selection.kind) === index);
    const paths: string[] = [];
    for (const selection of unique) {
      if (selection.kind === 'folder') continue;
      check();
      const fresh = await input.provider.read(selection.libraryId, selection.itemId, input.signal);
      check();
      if (fresh.libraryId !== selection.libraryId || fresh.itemId !== selection.itemId) throw new Error('云来源的账号或权限范围已变化。');
      const previous = [...identities.values()].find(identity => identity.libraryId === selection.libraryId && identity.itemId === selection.itemId);
      if (previous && (fresh.id !== previous.resourceId || fresh.role !== previous.role)) throw new Error('云来源的身份或角色权限已变化，请重新选择来源。');
      paths.push(fresh.id);
    }
    return { paths, selections: unique, reason };
  }
  const explicit = parseCloudSourceSelections(input.query);
  if (explicit.length) return verified(explicit, 'explicit-selection');
  input = { ...input, query: documentSourceReferenceQuery(input.query) };
  if (requestsIndependentAnswer(input.query)) return { paths: [], selections: [], reason: 'general' };

  const references = hasNamedDocumentReference(input.query);
  const active = input.activeResource;
  const currentFolder = /(?:当前|现在|这个|这份|此|该|选中|打开)(?:正?在)?(?:打开|选中)?的?(?:文件夹|目录)|\b(?:this|(?:the\s+)?(?:current(?:ly)?|active|selected|open(?:ed)?))\s+(?:folder|directory)\b/iu.test(input.query);
  if (!references && active?.kind === 'folder' && currentFolder) {
    // A cloud directory is a discovery scope, never a local path or quoted file.
    const fresh = await input.provider.read(active.libraryId, active.itemId, input.signal);
    check();
    if (fresh.id !== active.id || fresh.libraryId !== active.libraryId || fresh.itemId !== active.itemId || fresh.role !== active.role || fresh.kind !== 'folder') {
      throw new Error('当前云目录的身份或权限已变化，请重新选择来源。');
    }
    return { paths: [], selections: [{ libraryId: fresh.libraryId, itemId: fresh.itemId, kind: 'folder' }], reason: 'current-folder' };
  }
  const initial = references ? null : await resolveConversationSourceTargets({ query: input.query, knownPaths: known.map(snapshot => snapshot.path), referentPaths: input.referentPaths, activePath: input.activeResource?.id, signal: input.signal });
  const directReference = /当前|现在|打开|选中|选区|这份|本文|文中|之前|前面|上一|继续|接着|刚才|\b(?:current|active|selected|this|previous|prior|earlier|continue|its|it)\b/iu.test(input.query);
  const namedAction = /总结|阅读|通读|分析|解释|讲解|比较|对比|查找|搜索|\b(?:summari[sz]e|read|analy[sz]e|explain|compare|find|search)\b/iu.test(input.query);
  let selected = initial?.paths.map(path => identities.get(path)).filter((identity): identity is NonNullable<typeof identity> => Boolean(identity))
    .map(identity => ({ libraryId: identity.libraryId, itemId: identity.itemId, kind: 'file' as const })) ?? [];
  let reason = initial?.reason ?? 'general';

  if (references || (namedAction && !directReference)) {
    if (!libraryId) throw new Error('请先选择要查找文件的云文献库。');
    const aliases = new Map<string, Set<string>>();
    const visited = new Set<string>();
    let entries = 0;
    const add = (path: string, itemId: string) => { const ids = aliases.get(path) ?? new Set<string>(); ids.add(itemId); aliases.set(path, ids); };
    async function walk(parent?: string, prefix = ''): Promise<void> {
      check();
      const key = parent ?? '';
      if (visited.has(key)) return;
      if (visited.size >= 256) throw new Error('云目录定位超过目录预算，请指定更小范围或使用明确的云来源。');
      visited.add(key);
      const items = await input.provider.list(libraryId!, parent, input.signal);
      check();
      for (const item of items) {
        if (++entries > 5000) throw new Error('云目录定位超过条目预算，请指定更小范围或使用明确的云来源。');
        if (item.libraryId !== libraryId || item.status !== 'active') continue;
        const name = item.canonicalName || item.title;
        const path = prefix ? `${prefix}/${name}` : name;
        if (item.kind === 'folder') await walk(item.id, path);
        else if (isAgentDocumentPath(name) || ['pdf', 'markdown', 'notebook', 'docx', 'pptx'].includes(item.kind)) {
          add(path, item.id);
          if (item.title && item.title !== name && item.title !== name.replace(/\.[^.]+$/u, '')) add(prefix ? `${prefix}/${item.title}` : item.title, item.id);
        }
      }
    }
    await walk();
    const activePath = input.activeResource ? [...aliases].find(([, ids]) => ids.has(input.activeResource!.itemId))?.[0] ?? input.activeResource.id : undefined;
    const named = await resolveConversationSourceTargets({ query: input.query, knownPaths: [...aliases.keys()], activePath, signal: input.signal });
    if (named.reason === 'named-files' || named.reason === 'active-named-file') {
      selected = named.paths.flatMap(path => {
        if (path === input.activeResource?.id) return [{ libraryId: input.activeResource.libraryId, itemId: input.activeResource.itemId, kind: 'file' as const }];
        const ids = aliases.get(path);
        if (!ids?.size) return [];
        if (ids.size > 1) throw new Error(`云文件路径“${path}”对应多个来源，请用云来源选择器指定：${[...ids].join('、')}`);
        return [{ libraryId, itemId: [...ids][0], kind: 'file' as const }];
      });
      reason = named.reason;
    }
  }
  return verified(selected, reason);
}
