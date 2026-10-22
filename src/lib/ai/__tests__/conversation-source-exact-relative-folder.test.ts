import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConversationSourceTargets } from '../conversation-source-targeting';
import { captureAgentDocumentSources } from '../document-source-capture';
import { buildSourceSelectionMention } from '../source-index';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';

const relativePath = 'Theoretical Research/taiyi/essay/06_fast_long_range_and_native_gates';
const fullPath = `C:/workspace/atom/${relativePath}`;
const requestSuffix = '中的文章都阅读并讲述文章内容，对话内回复';

function largeWorkspace() {
  const root = new SourceTestDirectory('atom');
  Object.assign(root, { fullPath: 'C:/workspace/atom' });
  const gates = root.add(new SourceTestDirectory('Theoretical Research'))
    .add(new SourceTestDirectory('taiyi'))
    .add(new SourceTestDirectory('essay'))
    .add(new SourceTestDirectory('06_fast_long_range_and_native_gates'));
  const alpha = gates.add(new SourceTestFile('01_alpha.md', '# Alpha paper\nA unique first result.'));
  const nested = gates.add(new SourceTestDirectory('review notes'));
  const beta = nested.add(new SourceTestFile('02_beta.txt', 'Beta paper has a second unique result.'));
  // A same-basename directory must not make the fully qualified target ambiguous.
  root.add(new SourceTestDirectory('unrelated'))
    .add(new SourceTestDirectory('06_fast_long_range_and_native_gates'))
    .add(new SourceTestFile('wrong.md', 'Never selected.'));
  let rootEnumerations = 0;
  root.values = async function* () { rootEnumerations++; throw new Error('Exact directory targeting must not enumerate the workspace root.'); };
  for (let index = 0; index < 12020; index++) root.add(new SourceTestFile(`unrelated-${index}.txt`, `irrelevant-${index}`));
  const directoryRequests: string[] = [];
  const originalGetDirectory = root.getDirectoryHandle.bind(root);
  root.getDirectoryHandle = async (name, options) => { directoryRequests.push(name); return originalGetDirectory(name, options); };
  return { root, gates, alpha, beta, rootEnumerations: () => rootEnumerations, directoryRequests };
}

afterEach(() => vi.restoreAllMocks());

describe('exact relative folder requests with spaces', () => {
  it('reports a missing explicit directory without scanning or substituting the previous paper', async () => {
    const fixture = largeWorkspace();
    await expect(resolveConversationSourceTargets({
      query: 'Theoretical Research/taiyi/missing' + requestSuffix,
      knownPaths: ['old.md'], referentPaths: ['old.md'], activePath: 'active.pdf',
      rootHandle: fixture.root.handle(),
    })).rejects.toThrow(/未找到.*文件夹.*missing/);
    expect(fixture.rootEnumerations()).toBe(0);
  });

  it.each(['“Theoretical Research/taiyi/missing”中的', '《Theoretical Research/taiyi/missing》中的', '"Theoretical Research/taiyi/missing"中的'])(
    'rejects missing quoted relative folders before parent discovery: %s', async quotedPath => {
      const fixture = largeWorkspace();
      await expect(resolveConversationSourceTargets({
        query: `请阅读${quotedPath}文章都阅读并讲述文章内容`,
        knownPaths: ['old.md'], referentPaths: ['old.md'], activePath: 'active.pdf',
        rootHandle: fixture.root.handle(),
      })).rejects.toThrow(/未找到.*文件夹.*missing/);
      expect(fixture.rootEnumerations()).toBe(0);
    });
  it('resolves a plain relative path with a Chinese suffix and reads only that folder', async () => {
    const fixture = largeWorkspace();
    const result = await resolveConversationSourceTargets({ query: relativePath + requestSuffix, knownPaths: [], rootHandle: fixture.root.handle(), workspaceRootPath: 'C:/workspace/atom' });
    expect(result.selections).toEqual([{ kind: 'folder', path: fullPath }]);
    expect(fixture.rootEnumerations()).toBe(0);
    expect(fixture.directoryRequests.filter(name => name === 'Theoretical Research')).toHaveLength(1);
    expect(fixture.directoryRequests).not.toContain('Research');

    const sources = await captureAgentDocumentSources({ activeTab: null, rootHandle: fixture.root.handle(), query: relativePath + requestSuffix, contextSelections: result.selections });
    try {
      expect(sources.map(source => source.path)).toEqual([
        `${relativePath}/01_alpha.md`,
        `${relativePath}/review notes/02_beta.txt`,
      ]);
      expect(await Promise.all(sources.map(async source => (await source.readUnit(1)).text))).toEqual([
        '# Alpha paper\nA unique first result.',
        'Beta paper has a second unique result.',
      ]);
      expect(fixture.rootEnumerations()).toBe(0);
    } finally { await Promise.all(sources.map(source => source.close())); }
  });

  it('resolves the shared encoded @folder mention when Chinese request text touches its suffix', async () => {
    const fixture = largeWorkspace();
    const mention = buildSourceSelectionMention({ kind: 'folder', path: relativePath });
    const result = await resolveConversationSourceTargets({ query: mention + requestSuffix, knownPaths: [], rootHandle: fixture.root.handle() });
    expect(result.selections).toEqual([{ kind: 'folder', path: relativePath }]);
    expect(fixture.rootEnumerations()).toBe(0);

    const sources = await captureAgentDocumentSources({ activeTab: null, rootHandle: fixture.root.handle(), query: mention + requestSuffix });
    try {
      expect(sources.map(source => source.path)).toEqual([
        `${relativePath}/01_alpha.md`,
        `${relativePath}/review notes/02_beta.txt`,
      ]);
      expect(await Promise.all(sources.map(async source => (await source.readUnit(1)).text))).toEqual([
        '# Alpha paper\nA unique first result.',
        'Beta paper has a second unique result.',
      ]);
      expect(fixture.rootEnumerations()).toBe(0);
    } finally { await Promise.all(sources.map(source => source.close())); }
  });

  it('resolves an unencoded @ followed by a spaced relative folder path', async () => {
    const fixture = largeWorkspace();
    const query = '@' + relativePath + requestSuffix;
    const result = await resolveConversationSourceTargets({ query, knownPaths: [], rootHandle: fixture.root.handle() });
    expect(result.selections).toEqual([{ kind: 'folder', path: fullPath }]);
    expect(fixture.rootEnumerations()).toBe(0);
  });

  it('rejects an encoded traversal folder mention before any workspace enumeration', async () => {
    const fixture = largeWorkspace();
    await expect(resolveConversationSourceTargets({ query: '@folder:Theoretical%20Research/taiyi/../private 中的文章', knownPaths: [], rootHandle: fixture.root.handle() }))
      .rejects.toThrow(/路径|path|遍历|traversal/i);
    expect(fixture.rootEnumerations()).toBe(0);
  });

  it('rejects traversal in a plain relative folder request instead of scanning the parent', async () => {
    const fixture = largeWorkspace();
    const query = 'Theoretical Research/taiyi/essay/../unrelated 中的文章都阅读并讲述文章内容';
    await expect(resolveConversationSourceTargets({ query, knownPaths: [], rootHandle: fixture.root.handle() })).rejects.toThrow(/路径|path|遍历|traversal/i);
    expect(fixture.rootEnumerations()).toBe(0);
  });

  it('keeps an exact path distinct from a same-named directory elsewhere in the workspace', async () => {
    const fixture = largeWorkspace();
    const result = await resolveConversationSourceTargets({ query: relativePath + requestSuffix, knownPaths: [], rootHandle: fixture.root.handle() });
    expect(result.selections).toEqual([{ kind: 'folder', path: fullPath }]);
    const sources = await captureAgentDocumentSources({ activeTab: null, rootHandle: fixture.root.handle(), query: relativePath + requestSuffix, contextSelections: result.selections });
    try { expect(sources.some(source => source.path.includes('unrelated/'))).toBe(false); }
    finally { await Promise.all(sources.map(source => source.close())); }
  });

  it('rejects a path rooted in another workspace without falling back to the current workspace root', async () => {
    const fixture = largeWorkspace();
    const query = 'C:/private/atom/' + relativePath + requestSuffix;
    await expect(resolveConversationSourceTargets({ query, knownPaths: [], rootHandle: fixture.root.handle(), workspaceRootPath: 'C:/workspace/atom' })).rejects.toThrow(/授权.*目录|目录.*授权|outside/i);
    expect(fixture.rootEnumerations()).toBe(0);
  });
});
