import type { AsyncAssetResolver } from '@/lib/asset-source-context';
import type { Item } from './domain';
import type { CloudLibrarySourceProvider } from './source-provider';

export function createCloudAssetResolver(input: { provider: CloudLibrarySourceProvider; libraryId: string; itemId: string; getItems: () => readonly Item[]; isCurrent?: () => boolean }): AsyncAssetResolver {
  const scope = input.provider.scope;
  const check = () => { if (input.provider.scope !== scope || input.isCurrent && !input.isCurrent()) throw new Error('云资源账号或来源权限已变化。'); };
  return async (href, relativeTo) => {
    check();
    if (!href.trim() || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(href.trim())) return null;
    const items = input.getItems().filter(item => item.libraryId === input.libraryId && item.status === 'active');
    const current = items.find(item => item.id === input.itemId);
    if (!current) throw new Error('云资源来源已关闭或无权限。');
    const parentOf = (item?: Item) => typeof item?.metadata.parentItemId === 'string' ? item.metadata.parentItemId : undefined;
    let parent = parentOf(current);
    const base = relativeTo?.split(/[?#]/u, 1)[0].replace(/\\/gu, '/');
    const path = decodeURIComponent(href.split(/[?#]/u, 1)[0]).replace(/\\/gu, '/');
    if (/[\u0000-\u001f]/u.test(path)) throw new Error('云资源路径无效。');
    const combined = path.startsWith('/') ? path : base ? `${base.slice(0, base.lastIndexOf('/') + 1)}${path}` : path;
    if (combined.startsWith('/')) parent = undefined;
    let match: Item | undefined;
    for (const segment of combined.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') { parent = parentOf(items.find(item => item.id === parent)); continue; }
      check();
      const entries = await input.provider.list(input.libraryId, parent);
      check();
      const matches = entries.filter(item => item.libraryId === input.libraryId && item.status === 'active' && item.canonicalName === segment);
      if (matches.length !== 1) throw new Error(`云库中未找到唯一资源：${href}`);
      match = matches[0]; parent = match.id;
    }
    if (!match || match.kind === 'folder') throw new Error(`云库中未找到图片资源：${href}`);
    const resource = await input.provider.read(input.libraryId, match.id);
    check();
    if (resource.libraryId !== input.libraryId || resource.itemId !== match.id || !resource.content) throw new Error('云资源身份或权限已变化。');
    const content = resource.content;
    return new Blob([content.kind === 'text' ? content.text : content.data], { type: content.mimeType });
  };
}
