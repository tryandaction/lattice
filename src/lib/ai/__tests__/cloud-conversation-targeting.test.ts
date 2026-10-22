import { describe, expect, it } from 'vitest';
import type { CloudLibrarySourceProvider, CloudLibraryResource } from '@/lib/shared-library/source-provider';
import type { Item } from '@/lib/shared-library/domain';
import type { CloudAgentSourceSnapshot } from '../cloud-source';
import { resolveCloudConversationTargets } from '../cloud-conversation-targeting';

function resource(itemId: string, name = `${itemId}.md`): CloudLibraryResource {
  return { id: `lattice-cloud:account:lib:${itemId}`, libraryId: 'lib', itemId, name, path: `cloud://${itemId}`, kind: 'markdown', role: 'viewer', versionId: 'v1', content: null };
}
function snapshot(value: CloudLibraryResource, providerScope = 'account'): CloudAgentSourceSnapshot {
  return { path: value.id, sourceId: value.id, workspaceKey: 'cloud:lib', version: 'v1', kind: 'markdown', totalUnits: 1, unitLabel: 'section', providerScope,
    cloudIdentity: { resourceId: value.id, libraryId: value.libraryId, itemId: value.itemId, name: value.name, role: value.role, version: 'v1', versionId: 'v1' } };
}
function item(id: string, name: string, kind: Item['kind'] = 'markdown'): Item {
  return { id, canonicalName: name, title: name, kind, libraryId: 'lib', status: 'active', metadata: {}, createdBy: 'user', createdAt: 'today', updatedAt: 'today' };
}
function fixture() {
  const resources = new Map([['prior', resource('prior', '量子纠错.md')], ['active', resource('active', '会议记录.md')], ['unopened', resource('unopened', '未打开 资料.md')]]);
  const listed: string[] = [], read: string[] = [];
  const provider: CloudLibrarySourceProvider = { scope: 'account', list: async (library, parent) => { listed.push(`${library}:${parent ?? ''}`); return [item('prior', '量子纠错.md'), item('active', '会议记录.md'), item('unopened', '未打开 资料.md')]; },
    read: async (_library, id) => { read.push(id); const value = resources.get(id); if (!value) throw new Error('permission denied'); return value; }, search: async () => ({ results: [] }), save: async () => {} };
  return { provider, resources, listed, read, knownSnapshots: [snapshot(resources.get('prior')!)], activeResource: resources.get('active')! };
}

describe('cloud conversation source targeting', () => {
  it('keeps prior conversation referent after switching active cloud files without listing', async () => {
    const state = fixture();
    const result = await resolveCloudConversationTargets({ ...state, query: '继续详细解释本文' });
    expect(result.paths).toEqual(['lattice-cloud:account:lib:prior']);
    expect(state.listed).toEqual([]);
    expect(state.read).toEqual(['prior']);
  });
  it('explicitly switches to the current cloud file', async () => {
    const state = fixture();
    const result = await resolveCloudConversationTargets({ ...state, query: '解释当前文件' });
    expect(result.paths).toEqual(['lattice-cloud:account:lib:active']);
    expect(state.listed).toEqual([]);
  });
  it('discovers unopened names from metadata and reads only the selected file', async () => {
    const state = fixture();
    const result = await resolveCloudConversationTargets({ ...state, query: '阅读“未打开 资料.md”' });
    expect(result.paths).toEqual(['lattice-cloud:account:lib:unopened']);
    expect(result.selections).toEqual([{ libraryId: 'lib', itemId: 'unopened', kind: 'file' }]);
    expect(state.read).toEqual(['unopened']);
  });
  it('reports duplicate names with folder paths and accepts the full display path', async () => {
    const state = fixture();
    state.resources.set('copy', resource('copy', '量子纠错.md'));
    state.provider.list = async (_library, parent) => parent === undefined ? [item('papers', '论文', 'folder'), item('drafts', '草稿', 'folder')]
      : parent === 'papers' ? [item('prior', '量子纠错.md')] : [item('copy', '量子纠错.md')];
    await expect(resolveCloudConversationTargets({ ...state, query: '总结量子纠错.md' })).rejects.toThrow(/论文\/量子纠错\.md.*草稿\/量子纠错\.md|草稿\/量子纠错\.md.*论文\/量子纠错\.md/s);
    const result = await resolveCloudConversationTargets({ ...state, query: '总结“草稿/量子纠错.md”' });
    expect(result.paths).toEqual(['lattice-cloud:account:lib:copy']);
  });
  it('includes a nested active resource when comparing a named cloud file with the current file', async () => {
    const state = fixture();
    state.provider.list = async (_library, parent) => parent === undefined ? [item('prior', '量子纠错.md'), item('notes', 'notes', 'folder')]
      : [item('active', '会议记录.md')];
    const result = await resolveCloudConversationTargets({ ...state, query: '比较量子纠错.md和当前文件' });
    expect(result.paths).toEqual(['lattice-cloud:account:lib:prior', 'lattice-cloud:account:lib:active']);
    expect(state.read).toEqual(['prior', 'active']);
  });
  it('preserves explicit cloud folder selection without enumerating its content', async () => {
    const state = fixture();
    const result = await resolveCloudConversationTargets({ ...state, query: '@cloud-folder:lib:papers 总结当前文件' });
    expect(result.selections).toEqual([{ libraryId: 'lib', itemId: 'papers', kind: 'folder' }]);
    expect(state.listed).toEqual([]);
    expect(state.read).toEqual([]);
  });
  it('ignores snapshots from another account and uses the most recent remaining library when active is closed', async () => {
    const state = fixture();
    const foreign = snapshot(resource('foreign'), 'other-account');
    const result = await resolveCloudConversationTargets({ ...state, knownSnapshots: [foreign, ...state.knownSnapshots], activeResource: null, query: '继续阅读' });
    expect(result.paths).toEqual(['lattice-cloud:account:lib:prior']);
    expect(state.read).toEqual(['prior']);
  });
  it('rejects role changes and provider scope mutations before returning identities', async () => {
    const state = fixture();
    state.resources.get('prior')!.role = 'editor';
    await expect(resolveCloudConversationTargets({ ...state, query: '继续阅读' })).rejects.toThrow(/权限|role/i);
    const next = fixture();
    next.provider.list = async () => { Object.defineProperty(next.provider, 'scope', { value: 'other-account' }); return [item('unopened', '未打开 资料.md')]; };
    await expect(resolveCloudConversationTargets({ ...next, query: '阅读“未打开 资料.md”' })).rejects.toThrow(/scope|权限|账号/i);
  });
  it('does not list or read cloud sources for an unrelated general question', async () => {
    const state = fixture();
    expect((await resolveCloudConversationTargets({ ...state, query: '法国的首都是哪里？' })).paths).toEqual([]);
    expect(state.listed).toEqual([]);
    expect(state.read).toEqual([]);
  });
  it('matches a human title without duplicating the canonical filename stem', async () => {
    const state = fixture();
    state.provider.list = async () => [{ ...item('prior', '量子纠错.md'), title: '量子纠错' }, { ...item('unopened', '未打开 资料.md'), title: '实验附录' }];
    expect((await resolveCloudConversationTargets({ ...state, query: '阅读“量子纠错”' })).paths).toEqual(['lattice-cloud:account:lib:prior']);
    expect((await resolveCloudConversationTargets({ ...state, query: '阅读“实验附录”' })).paths).toEqual(['lattice-cloud:account:lib:unopened']);
  });
  it('cancels before listing or reading', async () => {
    const state = fixture();
    const controller = new AbortController(); controller.abort();
    await expect(resolveCloudConversationTargets({ ...state, query: '阅读“未打开 资料.md”', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.listed).toEqual([]);
    expect(state.read).toEqual([]);
  });
  it('does not traverse metadata belonging to a different library', async () => {
    const state = fixture();
    state.provider.list = async () => [{ ...item('foreign-folder', '其他文件夹', 'folder'), libraryId: 'other-library' }, item('unopened', '未打开 资料.md')];
    const result = await resolveCloudConversationTargets({ ...state, query: '阅读“未打开 资料.md”' });
    expect(result.selections).toEqual([{ libraryId: 'lib', itemId: 'unopened', kind: 'file' }]);
    expect(state.read).toEqual(['unopened']);
  });
});
