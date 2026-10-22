import { describe, expect, it } from 'vitest';
import { resolveConversationSourceTargets } from '../conversation-source-targeting';
import { createAuthorizedSourceIndex } from '../source-index';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';

const prior = ['papers/量子纠错.md'];

function workspace() {
  const root = new SourceTestDirectory('workspace');
  root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('量子纠错.md', 'private paper text'));
  root.add(new SourceTestDirectory('notes')).add(new SourceTestFile('会议记录.md', 'private meeting text'));
  return root;
}

describe('conversation source targeting', () => {
  it('targets the authorized workspace for a whole-directory request instead of the unrelated active document', async () => {
    const root = workspace();
    const result = await resolveConversationSourceTargets({ query: '阅读当前工作区中的所有论文并逐篇讲解', activePath: 'notes/会议记录.md', knownPaths: prior, rootHandle: root.handle(), includeActiveDocumentContext: true });
    expect(result).toMatchObject({ paths: [], selections: [{ kind: 'folder', path: '.' }], reason: 'workspace-discovery' });
  });
  it('retains an open PDF identity for an unqualified scientific question without reading bytes', async () => {
    const root = workspace();
    const pdf = root.add(new SourceTestFile('Senoo 2026.pdf', 'must remain unread during targeting'));
    const result = await resolveConversationSourceTargets({
      query: 'Z2-ordered Greenberger–Horne–Zeilinger (GHZ) states是什么思想',
      knownPaths: prior, activePath: 'Senoo 2026.pdf', rootHandle: root.handle(), includeActiveDocumentContext: true,
    });
    expect(result).toMatchObject({ paths: ['Senoo 2026.pdf'], selections: [{ kind: 'file', path: 'Senoo 2026.pdf' }], reason: 'active-document-context' });
    expect(pdf.reads).toBe(0);
  });

  it('does not scan unrelated folders when explaining a concept in the open document context', async () => {
    const root = workspace();
    root.values = async function* () { throw new Error('Concept explanation must not discover the entire workspace'); };
    const result = await resolveConversationSourceTargets({ query: '解释 Z2-ordered GHZ states 的思想', knownPaths: [], activePath: 'Senoo 2026.pdf', rootHandle: root.handle(), includeActiveDocumentContext: true });
    expect(result.paths).toEqual(['Senoo 2026.pdf']);
    expect(result.reason).toBe('active-document-context');
  });

  it.each(['分析 GHZ 态的物理意义', '梳理 GHZ 态的物理意义', '分析“GHZ”态的物理意义', '比较“GHZ”和“W”态'])('does not mistake a scientific subject for a same-name file: %s', async query => {
    const root = workspace();
    const unrelated = root.add(new SourceTestFile('GHZ.md', 'unrelated note'));
    const result = await resolveConversationSourceTargets({ query, knownPaths: ['GHZ.md'], referentPaths: [], activePath: 'Senoo 2026.pdf', rootHandle: root.handle(), includeActiveDocumentContext: true });
    expect(result.paths).toEqual(['Senoo 2026.pdf']);
    expect(result.reason).toBe('active-document-context');
    expect(unrelated.reads).toBe(0);
  });

  it.each(['Compare GHZ and W states', 'Compare "GHZ" and "W" states'])('does not scan the workspace for a comparison between scientific concepts: %s', async query => {
    const root = workspace();
    root.values = async function* () { throw new Error('Concept comparison must not discover the entire workspace'); };
    const result = await resolveConversationSourceTargets({ query, knownPaths: [], activePath: 'Senoo 2026.pdf', rootHandle: root.handle(), includeActiveDocumentContext: true });
    expect(result.paths).toEqual(['Senoo 2026.pdf']);
    expect(result.reason).toBe('active-document-context');
  });

  it.each(['阅读 StudyAlpha', '总结 StudyAlpha', 'Read StudyAlpha', 'Summarize StudyAlpha', '阅读“StudyAlpha”', 'Summarize "StudyAlpha"', '换个话题，阅读“StudyAlpha”'])('still discovers a filename stem in an explicit reading request: %s', async query => {
    const root = workspace();
    root.add(new SourceTestFile('StudyAlpha.md', 'requested study'));
    const result = await resolveConversationSourceTargets({ query, knownPaths: [], activePath: 'Senoo 2026.pdf', rootHandle: root.handle(), includeActiveDocumentContext: true });
    expect(result.paths).toEqual(['StudyAlpha.md']);
  });

  it.each(['比较 StudyAlpha 和 StudyBeta 两篇论文', 'Compare StudyAlpha and StudyBeta papers', '比较“StudyAlpha”和“StudyBeta”两篇论文'])('still discovers titles explicitly framed as separate documents: %s', async query => {
    const root = workspace();
    root.add(new SourceTestFile('StudyAlpha.pdf', 'first study'));
    root.add(new SourceTestFile('StudyBeta.pdf', 'second study'));
    const result = await resolveConversationSourceTargets({ query, knownPaths: prior, activePath: 'Senoo 2026.pdf', rootHandle: root.handle(), includeActiveDocumentContext: true });
    expect(result.paths).toEqual(['StudyAlpha.pdf', 'StudyBeta.pdf']);
  });

  it.each(['换个话题，GHZ态是什么？', '不结合当前论文，解释 GHZ 态', 'Explain GHZ in general, without using the current PDF', '你好'])('does not bind the open PDF for an explicit independent request: %s', async query => {
    const result = await resolveConversationSourceTargets({ query, knownPaths: prior, activePath: 'Senoo 2026.pdf', includeActiveDocumentContext: true });
    expect(result.paths).toEqual([]);
    expect(result.selections).toBeUndefined();
  });

  it('keeps a genuine follow-up on its prior source even while another PDF is active', async () => {
    const result = await resolveConversationSourceTargets({ query: '为什么需要回波？', knownPaths: prior, referentPaths: prior, activePath: 'Senoo 2026.pdf', includeActiveDocumentContext: true });
    expect(result.paths).toEqual(prior);
    expect(result.reason).toBe('conversation-followup');
  });
  it('keeps long pasted Markdown with TeX commands independent of filesystem authorization', async () => {
    const query = `# 演算\n\n${'普通数学文本。'.repeat(7000)}\n$$\\int_0^1 \\frac{x}{1+x} dx$$\n\\alpha + \\beta\n\\frac{1}{2}\n继续完成推导。`;
    const result = await resolveConversationSourceTargets({ query, knownPaths: [] });
    expect(result).toEqual({ paths: [], reason: 'general' });
  });

  it.each([
    '解释下面的代码：\n```python\npath = "/private/essay"\n```',
    '解释下面的代码：\n```typescript\nconst path = "C:\\private\\essay";\n```',
    '计算公式：$$ \\alpha /beta + \\frac{1}{2} $$',
  ])('does not treat paths inside pasted code or mathematical notation as source requests: %s', async query => {
    expect(await resolveConversationSourceTargets({ query, knownPaths: [] })).toEqual({ paths: [], reason: 'general' });
  });

  describe('natural absolute source paths', () => {
    function absoluteWorkspace(rootPath = 'C:/universe/MyStudy/atom/Theoretical Research/taiyi') {
      const root = new SourceTestDirectory(rootPath.split('/').at(-1)!);
      Object.assign(root, { fullPath: rootPath });
      const essay = root.add(new SourceTestDirectory('essay'));
      const paper = essay.add(new SourceTestFile('单比特 门.md', 'selected source'));
      root.add(new SourceTestDirectory('研究 中文')).add(new SourceTestDirectory('处理中')).add(new SourceTestFile('other.md', 'other'));
      root.values = async function* () { throw new Error('Whole workspace discovery is forbidden for an absolute path'); };
      return { root, rootPath, essay, paper };
    }

    it.each(['中有哪些文章做了单比特门并将0，1编码在亚稳态', '里有哪些文章', '下有哪些文章', ' 有哪些文章', '/ 有哪些文章'])('resolves a pasted directory with spaces and an adjoining query: %s', async suffix => {
      const { root, rootPath, paper } = absoluteWorkspace();
      const result = await resolveConversationSourceTargets({ query: `${rootPath}/essay${suffix}`, knownPaths: prior, activePath: 'unrelated.md', rootHandle: root.handle(), workspaceRootPath: rootPath });
      expect(result.paths).toEqual([]);
      expect(result.selections).toEqual([{ kind: 'folder', path: `${rootPath}/essay` }]);
      expect(paper.reads).toBe(0);
    });

    it.each(['C:/资料/Theoretical Research/taiyi', '/home/研究/Theoretical Research/taiyi'])('preserves Chinese directory names and chooses their longest metadata match: %s', async rootPath => {
      const { root } = absoluteWorkspace(rootPath);
      const result = await resolveConversationSourceTargets({ query: `请查找“${rootPath}/研究 中文/处理中”里的文章`, knownPaths: [], rootHandle: root.handle() });
      expect(result.selections).toEqual([{ kind: 'folder', path: `${rootPath}/研究 中文/处理中` }]);
    });

    it.each(['C:/资料/Theoretical Research/taiyi', '/home/研究/Theoretical Research/taiyi'])('uses metadata to distinguish an absolute file from a directory: %s', async rootPath => {
      const { root, paper } = absoluteWorkspace(rootPath);
      const result = await resolveConversationSourceTargets({ query: `总结 ${rootPath}/essay/单比特 门.md的内容`, knownPaths: prior, activePath: 'unrelated.md', rootHandle: root.handle() });
      expect(result.paths).toEqual([`${rootPath}/essay/单比特 门.md`]);
      expect(result.selections).toEqual([{ kind: 'file', path: `${rootPath}/essay/单比特 门.md` }]);
      expect(paper.reads).toBe(0);
    });

    it('keeps a directory whose name looks like a document as a folder selection', async () => {
      const { root, rootPath } = absoluteWorkspace();
      root.add(new SourceTestDirectory('sources.md')).add(new SourceTestFile('paper.md', 'source'));
      const result = await resolveConversationSourceTargets({ query: `${rootPath}/sources.md中有哪些论文`, knownPaths: prior, rootHandle: root.handle() });
      expect(result.paths).toEqual([]);
      expect(result.selections).toEqual([{ kind: 'folder', path: `${rootPath}/sources.md` }]);
    });

    it('supports Windows backslashes without treating the path as a document name', async () => {
      const { root } = absoluteWorkspace();
      const result = await resolveConversationSourceTargets({ query: 'C:\\universe\\MyStudy\\atom\\Theoretical Research\\taiyi\\essay中有哪些文章', knownPaths: [], rootHandle: root.handle() });
      expect(result.selections).toEqual([{ kind: 'folder', path: 'C:/universe/MyStudy/atom/Theoretical Research/taiyi/essay' }]);
    });

    it('normalizes a Windows drive path containing Chinese directory names without changing TeX in the query', async () => {
      const { root } = absoluteWorkspace('C:/资料/Theoretical Research/taiyi');
      const result = await resolveConversationSourceTargets({ query: '查找“C:\\资料\\Theoretical Research\\taiyi\\研究 中文\\处理中”里的文章，公式为 \\alpha', knownPaths: [], rootHandle: root.handle() });
      expect(result.selections).toEqual([{ kind: 'folder', path: 'C:/资料/Theoretical Research/taiyi/研究 中文/处理中' }]);
    });

    it.each(['C:/资料/taiyi', '/home/研究/taiyi'])('targets the absolute workspace root precisely: %s', async rootPath => {
      const { root } = absoluteWorkspace(rootPath);
      const result = await resolveConversationSourceTargets({ query: `${rootPath}中有哪些论文`, knownPaths: [], rootHandle: root.handle() });
      expect(result.selections).toEqual([{ kind: 'folder', path: rootPath }]);
      const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: result.selections! });
      const read = await index.read({ path: 'essay/单比特 门.md' });
      expect(read.chunks.map(chunk => chunk.text).join('')).toBe('selected source');
    });

    it('preserves absolute identity when a child shares the workspace basename', async () => {
      const { root, rootPath } = absoluteWorkspace();
      root.add(new SourceTestDirectory('taiyi')).add(new SourceTestDirectory('essay')).add(new SourceTestFile('private.md', 'unselected'));
      const result = await resolveConversationSourceTargets({ query: `${rootPath}/essay里有哪些文章`, knownPaths: [], rootHandle: root.handle() });
      const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: result.selections! });
      expect((await index.read({ path: 'essay/单比特 门.md' })).chunks.map(chunk => chunk.text).join('')).toBe('selected source');
      await expect(index.read({ path: 'taiyi/essay/private.md' })).rejects.toThrow(/selection|authorized/i);
    });

    it.each(['C:/universe/MyStudy/atom/Theoretical Research/taiyi/missing', 'C:/universe/MyStudy/atom/Theoretical Research/taiyi/essay/missing'])('rejects a missing absolute directory instead of falling back to a parent or active file: %s', async path => {
      const { root } = absoluteWorkspace();
      await expect(resolveConversationSourceTargets({ query: `${path}中有哪些文章`, knownPaths: prior, activePath: 'unrelated.md', rootHandle: root.handle() })).rejects.toThrow(/未找到|不存在/);
    });

    it.each(['C:/private/essay', 'C:/universe/MyStudy/atom/Theoretical Research/taiyi-other/essay', '/private/essay'])('rejects an absolute directory outside authorization before accessing the workspace: %s', async path => {
      const { root } = absoluteWorkspace();
      root.getDirectoryHandle = async () => { throw new Error('Outside paths must not access workspace metadata'); };
      await expect(resolveConversationSourceTargets({ query: `${path}中有哪些文章`, knownPaths: prior, activePath: 'unrelated.md', rootHandle: root.handle() })).rejects.toThrow(/授权.*目录|目录.*授权/);
    });

    it('asks for the specified directory authorization when no workspace is open', async () => {
      await expect(resolveConversationSourceTargets({ query: 'C:/private/essay中有哪些文章', knownPaths: prior, activePath: 'unrelated.md' })).rejects.toThrow(/授权.*目录|目录.*授权/);
    });

    it('does not expand the native handle authorization to a different supplied workspace path', async () => {
      const { root } = absoluteWorkspace();
      await expect(resolveConversationSourceTargets({ query: 'C:/private/essay中有哪些文章', knownPaths: prior, rootHandle: root.handle(), workspaceRootPath: 'C:/private' })).rejects.toThrow(/授权.*目录|目录.*授权/);
    });

    it('rejects traversal and revoked permissions without falling back to the active file', async () => {
      const { root, rootPath } = absoluteWorkspace();
      await expect(resolveConversationSourceTargets({ query: `${rootPath}/essay/../private中有哪些文章`, knownPaths: prior, activePath: 'unrelated.md', rootHandle: root.handle() })).rejects.toThrow(/路径|path/i);
      root.permission = 'denied';
      await expect(resolveConversationSourceTargets({ query: `${rootPath}/essay中有哪些文章`, knownPaths: prior, activePath: 'unrelated.md', rootHandle: root.handle() })).rejects.toThrow(/权限|permission/i);
    });

    it('rejects a missing quoted literal instead of shortening its Chinese directory name', async () => {
      const { root, rootPath } = absoluteWorkspace();
      await expect(resolveConversationSourceTargets({ query: `查找“${rootPath}/essay中不存在”里的文章`, knownPaths: prior, rootHandle: root.handle() })).rejects.toThrow(/未找到|不存在/);
    });

    it('does not shorten a nonexistent Chinese basename at an ordinary character', async () => {
      const { root, rootPath } = absoluteWorkspace();
      await expect(resolveConversationSourceTargets({ query: `${rootPath}/essay中国中有哪些文章`, knownPaths: prior, rootHandle: root.handle() })).rejects.toThrow(/未找到|不存在/);
    });

    it('does not shorten a nonexistent directory containing spaces to a matching prefix', async () => {
      const { root, rootPath } = absoluteWorkspace();
      await expect(resolveConversationSourceTargets({ query: `${rootPath}/essay Missing中有哪些文章`, knownPaths: prior, activePath: 'unrelated.md', rootHandle: root.handle() })).rejects.toThrow(/未找到|不存在/);
    });

    it('accepts an absolute path adjoining a Chinese request verb', async () => {
      const { root, rootPath } = absoluteWorkspace();
      const result = await resolveConversationSourceTargets({ query: `请查找${rootPath}/essay中有哪些文章`, knownPaths: prior, rootHandle: root.handle() });
      expect(result.selections).toEqual([{ kind: 'folder', path: `${rootPath}/essay` }]);
    });

    it('validates every absolute path instead of ignoring an outside path', async () => {
      const { root, rootPath } = absoluteWorkspace();
      await expect(resolveConversationSourceTargets({ query: `比较 ${rootPath}/essay 和 C:/private/essay 中的文章`, knownPaths: prior, rootHandle: root.handle() })).rejects.toThrow(/授权.*目录|目录.*授权/);
    });

    it('resolves two authorized absolute directories independently', async () => {
      const { root, rootPath } = absoluteWorkspace();
      const result = await resolveConversationSourceTargets({ query: `比较“${rootPath}/essay”和“${rootPath}/研究 中文/处理中”里的文章`, knownPaths: prior, rootHandle: root.handle() });
      expect(result.selections).toEqual([{ kind: 'folder', path: `${rootPath}/essay` }, { kind: 'folder', path: `${rootPath}/研究 中文/处理中` }]);
    });

    it('keeps local absolute targeting when a web reference is also present', async () => {
      const { root, rootPath } = absoluteWorkspace();
      const result = await resolveConversationSourceTargets({ query: `${rootPath}/essay中有哪些文章，参考https://example.com`, knownPaths: prior, rootHandle: root.handle() });
      expect(result.selections).toEqual([{ kind: 'folder', path: `${rootPath}/essay` }]);
    });

    it('does not interpret a slash in the query as a missing path segment', async () => {
      const { root, rootPath } = absoluteWorkspace();
      const result = await resolveConversationSourceTargets({ query: `${rootPath}/essay中哪些文章将0/1编码在亚稳态`, knownPaths: prior, rootHandle: root.handle() });
      expect(result.selections).toEqual([{ kind: 'folder', path: `${rootPath}/essay` }]);
    });

    it('recognizes a POSIX path with a single directory component', async () => {
      const { root } = absoluteWorkspace('/research');
      const result = await resolveConversationSourceTargets({ query: '/research中有哪些文章', knownPaths: prior, rootHandle: root.handle() });
      expect(result.selections).toEqual([{ kind: 'folder', path: '/research' }]);
    });
  });

  it('keeps the latest discussed files as referents while earlier files remain discoverable', async () => {
    const result = await resolveConversationSourceTargets({ query: '它的结果是多少？', knownPaths: ['second.md', 'first.md'], referentPaths: ['second.md'], activePath: 'unrelated.md' });
    expect(result.paths).toEqual(['second.md']);
  });
  it.each(['本文中的“单比特门”详细讲解', '本文当前方法的局限是什么？', 'Explain the current limitations of this paper'])('does not change source to a quoted term matching a note stem: %s', async query => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('Senoo.pdf', 'PDF'));
    const note = root.add(new SourceTestDirectory('notes')).add(new SourceTestFile('单比特门.md', 'NOT PAPER'));
    const target = await resolveConversationSourceTargets({ query, knownPaths: ['papers/Senoo.pdf'], referentPaths: ['papers/Senoo.pdf'], activePath: 'AGENTS.md', rootHandle: root.handle(), relocateReferents: true });
    expect(target.paths).toEqual(['papers/Senoo.pdf']);
    expect(note.reads).toBe(0);
  });
  it.each(['换个话题，分析另一篇论文', 'Now explain a different paper'])('does not use the prior paper for an explicit different paper: %s', async query => {
    const target = await resolveConversationSourceTargets({ query, knownPaths: ['papers/Senoo.pdf'], referentPaths: ['papers/Senoo.pdf'], activePath: 'papers/New.pdf' });
    expect(target.paths).toEqual(['papers/New.pdf']);
  });
  it('relocates a historical basename within the authorized workspace and never reads metadata candidates', async () => {
    const root = new SourceTestDirectory('workspace');
    const paper = root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('Senoo 2026.pdf', 'SYNTHETIC PDF'));
    const target = await resolveConversationSourceTargets({ query: '本文单比特门详细讲解', knownPaths: ['archive/Senoo 2026.pdf'], referentPaths: ['archive/Senoo 2026.pdf'], activePath: 'AGENTS.md', rootHandle: root.handle(), relocateReferents: true });
    expect(target.paths).toEqual(['papers/Senoo 2026.pdf']);
    expect(paper.reads).toBe(0);
  });
  it('reports missing or ambiguous prior papers rather than falling back to the active note', async () => {
    const root = new SourceTestDirectory('workspace');
    await expect(resolveConversationSourceTargets({ query: '本文单比特门详细讲解', knownPaths: ['paper.pdf'], referentPaths: ['paper.pdf'], activePath: 'notes/CZ.md', rootHandle: root.handle(), relocateReferents: true })).rejects.toThrow(/未找到.*paper.pdf/);
    for (const folder of ['first', 'second']) root.add(new SourceTestDirectory(folder)).add(new SourceTestFile('paper.pdf', 'PDF'));
    await expect(resolveConversationSourceTargets({ query: '本文单比特门详细讲解', knownPaths: ['paper.pdf'], referentPaths: ['paper.pdf'], activePath: 'notes/CZ.md', rootHandle: root.handle(), relocateReferents: true })).rejects.toThrow(/多个|明确|歧义/);
  });
  it.each(['继续详细解释', '上一份文件的主要贡献是什么？', '本文的局限是什么？', 'Explain its assumptions'])('keeps the conversation referent after opening another file: %s', async query => {
    const result = await resolveConversationSourceTargets({ query, knownPaths: prior, activePath: 'notes/会议记录.md' });
    expect(result.paths).toEqual(['papers/量子纠错.md']);
  });

  it.each(['总结当前打开的文件', '解释这份文件', '解释这个打开的文件', 'read the newly opened file'])('honors an explicit current-file reference without changing the catalog: %s', async query => {
    const knownPaths = Object.freeze(['papers/量子纠错.md']);
    const result = await resolveConversationSourceTargets({ query, knownPaths, activePath: 'notes/会议记录.md' });
    expect(result.paths).toEqual(['notes/会议记录.md']);
    expect(knownPaths).toEqual(['papers/量子纠错.md']);
  });

  it('compares the prior conversation document with the newly active document', async () => {
    const result = await resolveConversationSourceTargets({ query: '把前面的论文和当前文件比较', knownPaths: prior, activePath: 'notes/会议记录.md' });
    expect(result.paths).toEqual(['papers/量子纠错.md', 'notes/会议记录.md']);
  });

  it.each(['Summarize this selected annotation.', '解释选中段落', 'Use the current note.'])('preserves the explicitly active note or selection referent: %s', async query => {
    const result = await resolveConversationSourceTargets({ query, knownPaths: prior, activePath: 'notes/会议记录.md' });
    expect(result.paths).toEqual(['notes/会议记录.md']);
  });

  it('uses the active PDF for a focused page request without prior conversation sources', async () => {
    const result = await resolveConversationSourceTargets({ query: 'Explain page 1 of this PDF.', knownPaths: [], activePath: 'papers/current.pdf' });
    expect(result.paths).toEqual(['papers/current.pdf']);
  });

  it.each(['请总结量子纠错.md的核心内容', '请解释“量子纠错”的方法'])('discovers an unopened document by a natural filename or stem: %s', async query => {
    const root = workspace();
    const result = await resolveConversationSourceTargets({ query, knownPaths: [], activePath: 'notes/会议记录.md', rootHandle: root.handle(), workspaceKey: 'A' });
    expect(result.paths).toEqual(['papers/量子纠错.md']);
    expect(result.selections).toEqual([{ kind: 'file', path: 'papers/量子纠错.md' }]);
  });

  it('supports quoted filenames containing spaces and resolves both sides of a comparison', async () => {
    const root = workspace();
    root.add(new SourceTestFile('Experiment Results.md', 'results'));
    const result = await resolveConversationSourceTargets({ query: '比较 "Experiment Results.md" 和量子纠错.md', knownPaths: [], rootHandle: root.handle(), workspaceKey: 'A' });
    expect(result.paths).toEqual(['Experiment Results.md', 'papers/量子纠错.md']);
  });

  it('reports every ambiguous basename instead of picking the first known or indexed path', async () => {
    const root = workspace();
    root.add(new SourceTestDirectory('draft')).add(new SourceTestFile('量子纠错.md', 'different paper'));
    await expect(resolveConversationSourceTargets({ query: '总结量子纠错.md', knownPaths: prior, rootHandle: root.handle(), workspaceKey: 'A' }))
      .rejects.toThrow(/papers\/量子纠错\.md.*draft\/量子纠错\.md|draft\/量子纠错\.md.*papers\/量子纠错\.md/s);
  });

  it('uses the complete path to disambiguate a matching basename and same-name path prefix', async () => {
    const root = workspace();
    root.add(new SourceTestDirectory('workspace')).add(new SourceTestDirectory('papers')).add(new SourceTestFile('量子纠错.md', 'nested'));
    const result = await resolveConversationSourceTargets({ query: '请总结 workspace/papers/量子纠错.md', knownPaths: prior, rootHandle: root.handle(), workspaceKey: 'A' });
    expect(result.paths).toEqual(['workspace/papers/量子纠错.md']);
  });

  it('keeps explicit folder authorization ahead of natural filenames and current-file references', async () => {
    const result = await resolveConversationSourceTargets({ query: '@folder:papers/Quantum%20Notes 查找量子纠错.md并与当前文件比较', knownPaths: prior, activePath: 'notes/会议记录.md' });
    expect(result.paths).toEqual([]);
    expect(result.selections).toEqual([{ kind: 'folder', path: 'papers/Quantum Notes' }]);
  });

  it('grants lazy workspace discovery for a request to search the already authorized workspace', async () => {
    const result = await resolveConversationSourceTargets({ query: '在工作区查找讨论纠错阈值的论文', knownPaths: prior, rootHandle: workspace().handle(), workspaceKey: 'A' });
    expect(result.paths).toEqual([]);
    expect(result.selections).toEqual([{ kind: 'folder', path: '.' }]);
  });

  it('does not invent document relevance for an unrelated question or a greeting', async () => {
    for (const query of ['你好', '法国的首都是哪里？', '量子纠错是什么？']) {
      const result = await resolveConversationSourceTargets({ query, knownPaths: prior, activePath: 'notes/会议记录.md', rootHandle: workspace().handle(), workspaceKey: 'A' });
      expect(result.paths).toEqual([]);
      expect(result.selections).toBeUndefined();
    }
  });

  it.each(['解释 React.useEffect', 'Explain list.append', '解释 https://example.com/guide.md', '解释 archive.zip'])('does not force technical names, URLs or unsupported binary names into file targeting: %s', async query => {
    const result = await resolveConversationSourceTargets({ query, knownPaths: ['guide.md'], activePath: 'active.md' });
    expect(result.paths).toEqual([]);
  });

  it('does not discover the entire workspace for a plain continuation', async () => {
    const root = workspace();
    const extra = root.add(new SourceTestFile('unrelated.md', 'unrelated'));
    const result = await resolveConversationSourceTargets({ query: '继续阅读', knownPaths: prior, activePath: 'notes/会议记录.md', rootHandle: root.handle(), workspaceKey: 'A' });
    expect(result.paths).toEqual(['papers/量子纠错.md']);
    expect(extra.reads).toBe(0);
  });

  it.each(['总结本文', '请分析本文主要贡献', '总结这篇论文', '梳理文档'])('reads the conversation source precisely without scanning a large unrelated workspace: %s', async query => {
    const root = workspace();
    for (let index = 0; index < 1024; index++) root.add(new SourceTestDirectory(`unrelated-${index}`));
    const result = await resolveConversationSourceTargets({ query, knownPaths: prior, referentPaths: prior, activePath: 'notes/会议记录.md', rootHandle: root.handle(), workspaceKey: 'A' });
    expect(result.paths).toEqual(['papers/量子纠错.md']);
    const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: result.selections! });
    const read = await index.read({ path: result.paths[0] });
    expect(read.chunks.map(chunk => chunk.text).join('')).toBe('private paper text');
    const other = await (await root.getDirectoryHandle('notes')).getFileHandle('会议记录.md');
    expect(other.reads).toBe(0);
  });

  it('targets the already open document for summarize-this-paper without walking unrelated directories', async () => {
    const root = workspace();
    root.values = async function* () { throw new Error('Unrelated directory discovery must not run'); };
    const result = await resolveConversationSourceTargets({ query: '总结本文', knownPaths: [], activePath: 'papers/量子纠错.md', rootHandle: root.handle(), workspaceKey: 'A' });
    expect(result.paths).toEqual(['papers/量子纠错.md']);
  });

  it('does not scan or invent a source for a document referent with no authorized document', async () => {
    const root = workspace();
    root.values = async function* () { throw new Error('No implicit workspace discovery authorization'); };
    const result = await resolveConversationSourceTargets({ query: '总结本文', knownPaths: [], rootHandle: root.handle(), workspaceKey: 'A' });
    expect(result.paths).toEqual([]);
    expect(result.selections).toBeUndefined();
  });

  it('resolves an exact previously authorized full path without scanning the whole workspace', async () => {
    const root = workspace();
    root.values = async function* () { throw new Error('Whole workspace listing must not run for the exact path'); };
    const result = await resolveConversationSourceTargets({ query: '总结 papers/量子纠错.md', knownPaths: prior, activePath: 'notes/会议记录.md', rootHandle: root.handle(), workspaceKey: 'A' });
    expect(result.paths).toEqual(['papers/量子纠错.md']);
  });

  it('targets the complete basename of the newly active PDF without scanning unrelated directories', async () => {
    const root = workspace();
    root.values = async function* () { throw new Error('An active filename identity must not scan the workspace'); };
    const activePath = 'essay/Logical qubits with erasure conversion using metastable neutral atoms.pdf';
    const result = await resolveConversationSourceTargets({ query: 'Logical qubits with erasure conversion using metastable neutral atoms.pdf本文单比特门编码在亚稳态吗，为什么，用在什么', knownPaths: prior, referentPaths: prior, activePath, rootHandle: root.handle() });
    expect(result.paths).toEqual([activePath]);
  });

  it('does not ignore another named filename when the active basename matches', async () => {
    const root = workspace();
    await expect(resolveConversationSourceTargets({ query: '比较 Current Paper.pdf 和 missing.pdf', knownPaths: prior, activePath: 'essay/Current Paper.pdf', rootHandle: root.handle() })).rejects.toThrow(/missing\.pdf/);
  });

  it('does not match a shorter active basename inside a different complete filename', async () => {
    const root = workspace();
    root.add(new SourceTestFile('Current Paper.pdf', 'actual'));
    const result = await resolveConversationSourceTargets({ query: '总结 Current Paper.pdf', knownPaths: prior, activePath: 'essay/Paper.pdf', rootHandle: root.handle() });
    expect(result.paths).toEqual(['Current Paper.pdf']);
  });

  it('keeps bounded discovery and does not substitute a known document for an unknown filename', async () => {
    const root = workspace();
    for (let index = 0; index < 1024; index++) root.add(new SourceTestDirectory(`unrelated-${index}`));
    await expect(resolveConversationSourceTargets({ query: '总结 unknown.md', knownPaths: prior, activePath: 'notes/会议记录.md', rootHandle: root.handle(), workspaceKey: 'A' }))
      .rejects.toThrow(/扫描范围/);
  });

  it.each(['为什么需要回波？', '如何降低退相干？', '是否可以推广到更多量子比特？', 'Why is an echo needed?'])('retains the prior source for a question continuing its explanation: %s', async query => {
    expect((await resolveConversationSourceTargets({ query, knownPaths: prior, activePath: 'notes/会议记录.md' })).paths).toEqual(['papers/量子纠错.md']);
  });

  it.each(['帮我写购物清单', '解释 Python 装饰器', '换个话题，为什么天是蓝的？'])('keeps a fresh topic independent from previous documents: %s', async query => {
    expect((await resolveConversationSourceTargets({ query, knownPaths: prior, activePath: 'notes/会议记录.md' })).paths).toEqual([]);
  });

  it('does not turn an ordinary named subject into a matching shorter filename stem', async () => {
    const result = await resolveConversationSourceTargets({ query: '分析量子纠错理论的发展', knownPaths: [], rootHandle: workspace().handle(), workspaceKey: 'A' });
    expect(result.paths).toEqual([]);
  });

  it('targets a bare complete filename stem in a reading request', async () => {
    const result = await resolveConversationSourceTargets({ query: '总结量子纠错的主要内容', knownPaths: [], rootHandle: workspace().handle(), workspaceKey: 'A' });
    expect(result.paths).toEqual(['papers/量子纠错.md']);
  });

  it('keeps an explicit file selection ahead of the current document', async () => {
    const result = await resolveConversationSourceTargets({ query: '@papers/量子纠错.md 和当前文件比较', knownPaths: [], activePath: 'notes/会议记录.md' });
    expect(result.paths).toEqual(['papers/量子纠错.md']);
    expect(result.selections).toEqual([{ kind: 'file', path: 'papers/量子纠错.md' }]);
  });

  it('finds a filename beyond the first metadata page without reading its content', async () => {
    const root = new SourceTestDirectory('workspace');
    for (let index = 0; index < 270; index++) root.add(new SourceTestFile(`note-${index}.md`, 'content'));
    const sought = root.add(new SourceTestFile('未打开 资料.md', 'must not be read'));
    sought.getFile = async () => {
      const file = new File(['must not be read'], sought.name);
      file.text = async () => { throw new Error('Content extraction is forbidden during filename discovery'); };
      file.arrayBuffer = async () => { throw new Error('Content extraction is forbidden during filename discovery'); };
      return file;
    };
    const result = await resolveConversationSourceTargets({ query: '请阅读“未打开 资料.md”', knownPaths: [], rootHandle: root.handle(), workspaceKey: 'A' });
    expect(result.paths).toEqual(['未打开 资料.md']);
  });
  it('locates a filename without materializing native file bytes through getFile', async () => {
    const root = new SourceTestDirectory('workspace');
    const file = root.add(new SourceTestFile('large-paper.pdf', 'not accessed'));
    file.getFile = async () => { throw new Error('Native getFile would load all document bytes'); };
    const result = await resolveConversationSourceTargets({ query: '解释 large-paper.pdf', knownPaths: [], rootHandle: root.handle(), workspaceKey: 'w' });
    expect(result.paths).toEqual(['large-paper.pdf']);
  });

  it('does not substitute the active document for a missing named file', async () => {
    await expect(resolveConversationSourceTargets({ query: '总结 missing.md', knownPaths: prior, activePath: 'notes/会议记录.md', rootHandle: workspace().handle(), workspaceKey: 'A' }))
      .rejects.toThrow(/missing\.md/);
  });

  it('honors cancellation and revoked workspace access during discovery', async () => {
    const root = workspace();
    const controller = new AbortController(); controller.abort();
    await expect(resolveConversationSourceTargets({ query: '总结量子纠错.md', knownPaths: [], rootHandle: root.handle(), workspaceKey: 'A', signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    root.permission = 'denied';
    await expect(resolveConversationSourceTargets({ query: '总结量子纠错.md', knownPaths: [], rootHandle: root.handle(), workspaceKey: 'A' }))
      .rejects.toThrow(/permission|权限/i);
  });
});
