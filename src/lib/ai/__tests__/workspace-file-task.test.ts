import { expect, it, vi } from 'vitest';
import { parseWorkspaceFileTask, prepareWorkspaceFileTask, preparePlannedFileDraft } from '../workspace-file-task';
import type { AiMessage, AiGenerateOptions, AiGenerateResult } from '../types';
import type { EvidenceRef } from '../types';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';

it('does not repeat an empty file-generation call at the effective model ceiling', async () => {
  const {root}=fixture('value=1');
  const generate=vi.fn(async(_messages:AiMessage[],_options:AiGenerateOptions)=>({text:'',finishReason:'length' as const}));
  await expect(prepareWorkspaceFileTask({root,task:'Edit test.py',request:{operation:'update',targetPath:'test.py',empty:false},
    outputTokenCeiling:8192,generate})).rejects.toMatchObject({reason:'no_progress'});
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0][1]).toMatchObject({maxTokens:8192,recoveryMaxTokens:8192});
});

it('routes explicit edits and blank PDF children while keeping paper analysis in research', () => {
  expect(parseWorkspaceFileTask('修改当前文件，把变量名改为 result', 'notes/test.py')).toMatchObject({ operation: 'update', targetPath: 'notes/test.py' });
  expect(parseWorkspaceFileTask('在本文PDF下新建md子文件', 'papers/test.pdf')).toMatchObject({ operation: 'create', pdfParent: 'papers/test.pdf', empty: true });
  expect(parseWorkspaceFileTask('创建本文md子文档，详细解释鲁棒性', 'papers/test.pdf')).toBeNull();
  expect(parseWorkspaceFileTask('不要修改当前文件，只解释', 'test.py')).toBeNull();
  expect(parseWorkspaceFileTask('这个公式为什么需要回波', 'paper.pdf')).toBeNull();
});
it.each(['lab.ipynb', 'data.csv', 'data.tsv'])('routes a non-empty PDF child through real source generation: %s', name => {
  expect(parseWorkspaceFileTask(`在当前 PDF 下创建 ${name} 子文件，内容包含原文数据分析`, 'paper.pdf')).toMatchObject({ operation: 'create', pdfParent: 'paper.pdf', empty: false });
});
it.each([
  ['新建notes.md，写一个摘要', 'notes.md', 'create'],
  ['修改scripts/run.py，把结果输出到控制台', 'scripts/run.py', 'update'],
  ['新建实验记录.md', '实验记录.md', 'create'],
])('separates the command from an adjacent filename: %s', (task, targetPath, operation) => {
  expect(parseWorkspaceFileTask(task)).toMatchObject({ targetPath, operation });
});
it('keeps a quoted filename literal when it appears before the edit verb', () => {
  expect(parseWorkspaceFileTask('“更新记录.md”修改结论')).toMatchObject({ targetPath: '更新记录.md', operation: 'update' });
});
it('uses the requested create operation even when the new content discusses editing', () => {
  expect(parseWorkspaceFileTask('新建guide.md，内容讲解如何修改变量')).toMatchObject({ operation: 'create', targetPath: 'guide.md' });
  expect(parseWorkspaceFileTask('解释“更新记录.md”的内容')).toBeNull();
});
function fixture(content: string) {
  const file = { getFile: vi.fn(async () => new File([content], 'test.py')) };
  const root = { name: 'root', getFileHandle: vi.fn(async () => file), getDirectoryHandle: async () => { throw new DOMException('Missing', 'NotFoundError'); }, async *values() {} } as unknown as FileSystemDirectoryHandle;
  return { root, file };
}
it('prepares a PDF child under the actual stable manifest rather than a regenerated path', async () => {
  const root = new SourceTestDirectory('root'); root.add(new SourceTestFile('renamed.pdf', '%PDF'));
  const item = root.add(new SourceTestDirectory('.lattice')).add(new SourceTestDirectory('items')).add(new SourceTestDirectory('stable'));
  item.add(new SourceTestFile('manifest.json', JSON.stringify({ version: 4, itemId: 'stable-id', pdfPath: 'renamed.pdf', itemFolderPath: '.lattice/items/stable',
    knownPdfPaths: ['renamed.pdf'], fileFingerprint: null, versionFingerprint: null, annotationIndexPath: null, createdAt: 1, updatedAt: 1 })));
  const draft = await prepareWorkspaceFileTask({ root: root.handle(), task: '创建空白子文件', request: { operation: 'create', targetPath: 'note.md', pdfParent: 'renamed.pdf', empty: true }, generate: async () => ({ text: '' }) });
  expect(draft.targetPath).toBe('.lattice/items/stable/note.md');
  expect(draft.pdfChildTarget?.parentItemId).toBe('stable-id');
  expect(draft.pdfChildTarget?.parentVersion).toBeTruthy();
});
it('uses the original full file and prepares a version-bound raw change without writing', async () => {
  const { root, file } = fixture('value=1\n');
  const generate = vi.fn<(messages: AiMessage[], options: AiGenerateOptions) => Promise<Pick<AiGenerateResult, 'text' | 'finishReason'>>>(async () => ({ text: 'value=2\n', finishReason: 'stop' }));
  const draft = await prepareWorkspaceFileTask({ root, task: '修改 test.py', request: { operation: 'update', targetPath: 'test.py', empty: false }, workspaceKey: 'root', generate });
  expect(draft).toMatchObject({ content: 'value=2\n', contentFormat: 'raw', writeMode: 'update', fileChange: { expectedContent: 'value=1\n', targetPath: 'test.py', workspaceKey: 'root' } });
  expect(generate.mock.calls[0][0][1].content).toContain('value=1');
  expect(file.getFile).toHaveBeenCalledOnce();
});
it('continues a token-limited file before making a complete version-bound draft', async () => {
  const { root } = fixture('value=1\n');
  const generate = vi.fn().mockResolvedValueOnce({ text: 'value=', finishReason: 'length' })
    .mockResolvedValueOnce({ text: '2\n', finishReason: 'stop' });
  const draft = await prepareWorkspaceFileTask({ root, task: '修改 test.py', request: { operation: 'update', targetPath: 'test.py', empty: false }, generate });
  expect(draft.content).toBe('value=2\n');
  expect(draft.fileChange?.expectedContent).toBe('value=1\n');
  expect(generate).toHaveBeenCalledTimes(2);
});
it('creates an empty PDF child without reading paper text or using a model', async () => {
  const { root } = fixture('synthetic PDF');
  const generate = vi.fn();
  const draft = await prepareWorkspaceFileTask({ root, task: '创建空白子文件', request: { operation: 'create', targetPath: 'Reading Note.md', pdfParent: 'test.pdf', empty: true }, workspaceKey: 'root', generate });
  expect(generate).not.toHaveBeenCalled();
  expect(draft.content).toBe('');
  expect(draft.pdfChildTarget?.sourcePath).toBe('test.pdf');
  expect(draft.targetPath).toBe('.lattice/items/test.pdf/Reading Note.md');
});
it('requires verified PDF source context for non-empty child generation and passes it without truncation', async () => {
  const root = new SourceTestDirectory('root'); root.add(new SourceTestFile('paper.pdf', '%PDF source'));
  const item = root.add(new SourceTestDirectory('.lattice')).add(new SourceTestDirectory('items')).add(new SourceTestDirectory('stable'));
  item.add(new SourceTestFile('manifest.json', JSON.stringify({ version: 4, itemId: 'stable-id', pdfPath: 'paper.pdf', itemFolderPath: '.lattice/items/stable',
    knownPdfPaths: ['paper.pdf'], fileFingerprint: null, versionFingerprint: null, annotationIndexPath: null, createdAt: 1, updatedAt: 1 })));
  const generate = vi.fn(async (messages: AiMessage[]) => ({ text: '# Note', finishReason: 'stop' as const }));
  await expect(prepareWorkspaceFileTask({ root: root.handle(), task: '总结并创建笔记', request: { operation: 'create', targetPath: 'note.md', pdfParent: 'paper.pdf', empty: false }, generate })).rejects.toThrow(/读取并核验/);
  const ref: EvidenceRef = { kind: 'pdf_page', label: 'paper.pdf', locator: 'paper.pdf#page=1', anchor: { page: 1, snippet: 'Verified PDF passage' } };
  const draft = await prepareWorkspaceFileTask({ root: root.handle(), task: '总结并创建笔记', request: { operation: 'create', targetPath: 'note.md', pdfParent: 'paper.pdf', empty: false },
    sourceContext: { text: 'Verified summary with the complete source-grounded detail.', sourceRefs: [ref] }, generate });
  expect(generate.mock.calls[0][0][1].content).toContain('Verified summary with the complete source-grounded detail.');
  expect(draft.sourceRefs).toEqual([ref]);
});
it.each(['length', 'refusal'] as const)('does not publish an incomplete %s response as a file', async finishReason => {
  const { root } = fixture('value=1');
  await expect(prepareWorkspaceFileTask({ root, task: '修改 test.py', request: { operation: 'update', targetPath: 'test.py', empty: false }, generate: async () => ({ text: 'partial', finishReason }) })).rejects.toThrow();
});
it('generates an approved planned update from the complete original instead of appending its preview', async () => {
  const { root } = fixture('value=1\n');
  const generate = vi.fn(async () => ({ text: 'value=2\n', finishReason: 'stop' as const }));
  const draft = await preparePlannedFileDraft({ root, proposalSummary: 'Change value', workspaceKey: 'root', generate,
    draft: { title: 'Edit', content: 'Set value to 2', sourceRefs: [], targetPath: 'test.py', writeMode: 'update', originProposalId: 'proposal-1' } });
  expect(draft).toMatchObject({ content: 'value=2\n', contentFormat: 'raw', writeMode: 'update', originProposalId: 'proposal-1', fileChange: { expectedContent: 'value=1\n' } });
  expect(generate.mock.calls).toHaveLength(1);
});
it('rejects invalid JSON before producing a draft', async () => {
  const { root } = fixture('');
  await expect(prepareWorkspaceFileTask({ root, task: '创建 test.json', request: { operation: 'create', targetPath: 'test.json', empty: false }, generate: async () => ({ text: '{broken' }) })).rejects.toThrow('有效 JSON');
});
