import { describe, expect, it } from 'vitest';
import { bindConversationSources } from '../conversation-source-binding';
import { resolveConversationSourceTargets } from '../conversation-source-targeting';
import { resolveCloudConversationTargets } from '../cloud-conversation-targeting';
import { documentSourceReferenceQuery } from '../document-reference-intent';
import type { ChatMessage } from '@/stores/ai-chat-store';
import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';

const paperPath = 'essay/Synthetic BB1 2026.pdf';
const actualRequest = '请根据刚才那篇已讨论的论文，使用 lattice.pdf.proposeChild 真实工具准备完整 Markdown 子文件 qa-bb1.md，包含BB1定义、幅度误差补偿机制和61.7 MHz、7.6 microseconds、99.87 percent三项参数及原文引用。保留待我在AI工作台审查并写回；不要只在聊天里承诺，也不要把草稿说成已经保存。';
function fixture() {
  const root = new SourceTestDirectory('workspace');
  const paper = root.add(new SourceTestDirectory('essay')).add(new SourceTestFile('Synthetic BB1 2026.pdf', '%PDF synthetic'));
  const note = root.add(new SourceTestDirectory('notes')).add(new SourceTestFile('other.md', 'Unrelated note'));
  root.add(new SourceTestFile('qa-bb1.md', '# Existing output-name decoy'));
  root.add(new SourceTestFile('lattice.pdf', '%PDF genuine file, not a dotted operation'));
  const messages: ChatMessage[] = [
    { id: 'q', role: 'user', content: '解释刚才那篇论文', timestamp: 1 },
    { id: 'a', role: 'assistant', content: '这篇论文解释了BB1。', timestamp: 2,
      documentContext: { workspaceKey: 'original-workspace', paths: [paperPath] } },
  ];
  return { root, paper, note, messages };
}

describe('output targets are distinct from document sources', () => {
  it('keeps the real four-turn child-file request bound to the original paper after another tab opens', async () => {
    const { root, paper, note, messages } = fixture();
    const binding = bindConversationSources({ query: actualRequest, messages, localWorkspaceKey: 'other-workspace', activeCloud: false, activeLocalPath: 'notes/other.md' });
    expect(binding).toMatchObject({ workspaceKey: 'original-workspace', referentPaths: [paperPath] });
    root.values = async function* () { throw new Error('An output filename or tool identifier must not trigger workspace source discovery'); };
    const targets = await resolveConversationSourceTargets({ query: actualRequest, rootHandle: root.handle(), knownPaths: [paperPath],
      referentPaths: binding.referentPaths, activePath: 'notes/other.md', includeActiveDocumentContext: true });
    expect(targets.paths).toEqual([paperPath]);
    expect(targets.selections).toEqual([{ kind: 'file', path: paperPath }]);
    expect(paper.reads).toBe(0);
    expect(note.reads).toBe(0);
  });

  it.each([
    '请根据刚才的论文生成 qa-bb1.md',
    '请根据刚才的论文创建名为“qa-bb1.md”的完整子文件',
    '请根据刚才的论文生成 Markdown 子文件 `qa-bb1.md`',
    'Use lattice.pdf.proposeChild to create qa-bb1.md from the previous paper.',
    'Prepare a Markdown child file named "qa-bb1.md" from the previous paper.',
  ])('does not read an existing decoy whose name is the create target: %s', async query => {
    const { root } = fixture();
    const target = await resolveConversationSourceTargets({ query, rootHandle: root.handle(), knownPaths: [paperPath], referentPaths: [paperPath], activePath: 'notes/other.md' });
    expect(target.paths).toEqual([paperPath]);
  });

  it('still resolves a named original source while excluding only the explicit create target', async () => {
    const { root } = fixture();
    const target = await resolveConversationSourceTargets({ query: '读取“essay/Synthetic BB1 2026.pdf”，使用 lattice.pdf.proposeChild 生成子文件 qa-bb1.md', rootHandle: root.handle(), knownPaths: [], activePath: 'notes/other.md' });
    expect(target.paths).toEqual([paperPath]);
  });

  it.each(['阅读 qa-bb1.md', '请解释 qa-bb1.md 的内容', '更新 qa-bb1.md'])('still locates an existing named source for %s', async query => {
    const { root } = fixture();
    const target = await resolveConversationSourceTargets({ query, rootHandle: root.handle(), knownPaths: [paperPath], referentPaths: [paperPath], activePath: 'notes/other.md' });
    expect(target.paths).toEqual(['qa-bb1.md']);
  });

  it('keeps a real file called lattice.pdf readable and does not hide missing input files', async () => {
    const { root } = fixture();
    expect((await resolveConversationSourceTargets({ query: '阅读 lattice.pdf', rootHandle: root.handle(), knownPaths: [] })).paths).toEqual(['lattice.pdf']);
    await expect(resolveConversationSourceTargets({ query: '根据 missing.pdf 生成 qa-bb1.md', rootHandle: root.handle(), knownPaths: [paperPath], referentPaths: [paperPath] })).rejects.toThrow(/missing\.pdf/);
  });

  it('preserves explicit source selection ahead of output-target interpretation', async () => {
    const { root } = fixture();
    const target = await resolveConversationSourceTargets({ query: '@qa-bb1.md 根据刚才的论文生成 qa-bb1.md，使用 lattice.pdf.proposeChild', rootHandle: root.handle(), knownPaths: [paperPath], referentPaths: [paperPath] });
    expect(target.paths).toEqual(['qa-bb1.md']);
  });

  it('keeps repeated source-query normalization from consuming a later input filename', () => {
    const query = '生成 qa-bb1.md methods.md';
    const once = documentSourceReferenceQuery(query);
    expect(once).toContain('methods.md');
    expect(documentSourceReferenceQuery(once)).toBe(once);
  });

  it('preserves a prior cloud paper when the new filename is an output instead of switching to a local note', async () => {
    const source: CloudLibraryResource = { id: 'lattice-cloud:account:library:paper', libraryId: 'library', itemId: 'paper', name: 'paper.pdf', kind: 'pdf',
      path: 'cloud://paper', role: 'editor', versionId: 'v1', content: null };
    const snapshot = { path: source.id, sourceId: source.id, workspaceKey: 'cloud:library', version: 'v1', kind: 'pdf' as const, unitLabel: 'page' as const, totalUnits: 20, providerScope: 'account',
      cloudIdentity: { resourceId: source.id, libraryId: source.libraryId, itemId: source.itemId, name: source.name, role: source.role, version: 'v1', versionId: 'v1' } };
    const messages: ChatMessage[] = [{ id: 'q', role: 'user', content: '解释论文', timestamp: 1 },
      { id: 'a', role: 'assistant', content: 'BB1定义。', timestamp: 2, documentContext: { workspaceKey: 'cloud:library', paths: [source.id], cloudSnapshots: [snapshot] } }];
    const binding = bindConversationSources({ query: actualRequest, messages, localWorkspaceKey: 'local', activeCloud: false, activeLocalPath: 'notes/other.md', providerScope: 'account' });
    expect(binding).toMatchObject({ kind: 'cloud', workspaceKey: 'cloud:library', referentPaths: [source.id], providerScope: 'account' });
    const read: string[] = [];
    const provider: CloudLibrarySourceProvider = { scope: 'account', read: async (_library, item) => { read.push(item); return source; }, list: async () => { throw new Error('Output targets must not force full cloud discovery'); }, search: async () => ({ results: [] }), save: async () => {} };
    const target = await resolveCloudConversationTargets({ query: actualRequest, provider, knownSnapshots: [snapshot], referentPaths: binding.referentPaths, activeResource: null });
    expect(target.paths).toEqual([source.id]);
    expect(read).toEqual(['paper']);
  });
});
