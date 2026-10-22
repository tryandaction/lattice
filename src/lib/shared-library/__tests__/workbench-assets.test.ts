import { describe, expect, it } from 'vitest';
import { createCloudAssetResolver } from '../workbench-assets';
import type { Item } from '../domain';
import type { CloudLibrarySourceProvider } from '../source-provider';

function entry(id: string, name: string, parent?: string, kind: Item['kind'] = 'image'): Item {
  return { id, libraryId: 'lib', canonicalName: name, title: name, kind, metadata: parent ? { parentItemId: parent } : {}, status: 'active', createdBy: 'u', createdAt: '', updatedAt: '' };
}
function fixture() {
  const items = [entry('a', 'a', undefined, 'folder'), entry('b', 'b', undefined, 'folder'), entry('doc-a', 'note.md', 'a', 'markdown'), entry('doc-b', 'note.md', 'b', 'markdown'), entry('img-a', 'plot.png', 'a'), entry('img-b', 'plot.png', 'b'), entry('styles', 'styles', 'a', 'folder'), entry('style', 'style.css', 'styles', 'code')];
  const reads: string[] = [];
  const provider: CloudLibrarySourceProvider = { scope: 'account', list: async (lib, parent) => items.filter(item => item.libraryId === lib && item.metadata.parentItemId === parent),
    read: async (lib, id) => { reads.push(id); const item = items.find(item => item.id === id)!; return { id: `cloud:${id}`, itemId: id, libraryId: lib, name: item.canonicalName, kind: item.kind, path: '', role: 'viewer', content: { kind: 'text', text: id, mimeType: 'image/png', updatedAt: '' } }; }, search: async () => ({ results: [] }), save: async () => {} };
  return { items, provider, reads };
}
describe('cloud workbench assets', () => {
  it('keeps the same relative image path bound to each cloud tab identity', async () => {
    const f = fixture();
    const a = createCloudAssetResolver({ ...f, libraryId: 'lib', itemId: 'doc-a', getItems: () => f.items });
    const b = createCloudAssetResolver({ ...f, libraryId: 'lib', itemId: 'doc-b', getItems: () => f.items });
    expect(await (await a('plot.png'))?.text()).toBe('img-a');
    expect(await (await b('plot.png'))?.text()).toBe('img-b');
    expect(f.reads).toEqual(['img-a', 'img-b']);
  });
  it('resolves stylesheet resources relative to the stylesheet and parent paths within the same library', async () => {
    const f = fixture();
    const resolve = createCloudAssetResolver({ ...f, libraryId: 'lib', itemId: 'doc-a', getItems: () => f.items });
    expect(await (await resolve('../plot.png', 'styles/style.css'))?.text()).toBe('img-a');
    expect(await (await resolve('../b/plot.png'))?.text()).toBe('img-b');
  });
  it('rejects ambiguous paths, stale accounts and revoked source identity', async () => {
    const f = fixture(); let current = true;
    const resolve = createCloudAssetResolver({ ...f, libraryId: 'lib', itemId: 'doc-a', getItems: () => f.items, isCurrent: () => current });
    f.items.push(entry('duplicate', 'plot.png', 'a'));
    await expect(resolve('plot.png')).rejects.toThrow(/唯一|多个/);
    current = false; await expect(resolve('plot.png')).rejects.toThrow(/权限|账号|来源/);
    const other = fixture(), account = createCloudAssetResolver({ ...other, libraryId: 'lib', itemId: 'doc-a', getItems: () => other.items });
    Object.defineProperty(other.provider, 'scope', { value: 'changed' });
    await expect(account('plot.png')).rejects.toThrow(/权限|账号|来源/);
  });
  it('leaves external URLs alone and never reads another library returned in metadata', async () => {
    const f = fixture(); const resolve = createCloudAssetResolver({ ...f, libraryId: 'lib', itemId: 'doc-a', getItems: () => f.items });
    expect(await resolve('https://example.com/plot.png')).toBeNull();
    f.provider.list = async () => [{ ...entry('other', 'plot.png', 'a'), libraryId: 'other' }];
    await expect(resolve('plot.png')).rejects.toThrow(/唯一|找到/); expect(f.reads).toEqual([]);
  });
  it('does not return asset bytes when the account changes during the final read', async () => {
    const f = fixture(), original = f.provider.read;
    const resolve = createCloudAssetResolver({ ...f, libraryId: 'lib', itemId: 'doc-a', getItems: () => f.items });
    f.provider.read = async (...args) => { const resource = await original(...args); Object.defineProperty(f.provider, 'scope', { value: 'changed' }); return resource; };
    await expect(resolve('plot.png')).rejects.toThrow(/权限|账号|来源/);
  });
});
