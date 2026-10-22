import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileTabState } from '@/types/layout';
const mocks = vi.hoisted(() => ({ open: vi.fn(), mentions: vi.fn() }));
vi.mock('../document-source', async original => ({ ...await original<typeof import('../document-source')>(), openAgentDocumentSource: mocks.open }));
vi.mock('../mention-resolver', async (original) => ({ ...await original<typeof import('../mention-resolver')>(), resolveMentions: mocks.mentions }));
import { captureAgentDocumentSources, resolveAuthorizedDocumentHandle, wantsDocumentReading, shouldReadConversationDocuments } from '../document-source-capture';

const handle = (name: string) => ({ name, kind: 'file', getFile: vi.fn(async () => new File(['test'], name)) }) as unknown as FileSystemFileHandle;
const root = (fullPath?: string) => ({ fullPath, name: 'workspace', getFileHandle: vi.fn(async (name: string) => handle(name)), getDirectoryHandle: vi.fn() }) as unknown as FileSystemDirectoryHandle;
const tab = (path: string): FileTabState => ({ id: path, fileName: path, filePath: path, isDirty: false, scrollPosition: 0, fileHandle: handle(path) });

describe('authorized document capture', () => {
  it.each([
    'BB1是什么？请依据这篇论文解释，区分原文内容和一般背景。回答最后给一个明确下一步建议：可以根据已经找到的原文继续解释复合脉冲为什么能补偿幅度误差。',
    '依据这篇论文解释BB1',
    '请详细解释本文中的BB1幅度误差补偿机制',
    'Explain BB1 in this paper',
    '这篇论文的载波频率和脉冲时长分别是多少？',
    '本文中的“单比特门”是什么意思？',
  ])('keeps a specific question bounded without requiring whole-document reading: %s', query => {
    expect(wantsDocumentReading(query)).toBe(false);
    expect(shouldReadConversationDocuments(query, ['paper.pdf'])).toBe(false);
  });

  it('preserves explicit whole-document and dedicated workflow requests', () => {
    expect(wantsDocumentReading('全文查找并分析BB1')).toBe(true);
    expect(wantsDocumentReading('总结整篇论文，包括BB1')).toBe(true);
    expect(wantsDocumentReading('解释BB1', 'paper-reading')).toBe(true);
    expect(wantsDocumentReading('解释BB1', 'pdf-annotation')).toBe(true);
    expect(wantsDocumentReading('解释BB1', 'literature-matrix')).toBe(true);
    expect(wantsDocumentReading('解释BB1', 'paper-reading', { workflowExplicit: false })).toBe(false);
  });
  it('routes explicit document mentions without requiring an open tab', () => {
    expect(shouldReadConversationDocuments('详细解释 @paper.pdf', [])).toBe(true);
    expect(shouldReadConversationDocuments('深入分析 @notes.md', [])).toBe(true);
    expect(shouldReadConversationDocuments('详细解释 @paper.pdf#page=3', [])).toBe(false);
    expect(shouldReadConversationDocuments('hi', ['paper.pdf'])).toBe(false);
  });
  it('recognizes natural follow-ups only with existing document context', () => {
    expect(shouldReadConversationDocuments('详细讲解，不是一句话', ['paper.pdf'])).toBe(true);
    expect(shouldReadConversationDocuments('详细讲解，不是一句话', [])).toBe(false);
    expect(shouldReadConversationDocuments('Please explain in more detail, not just one sentence', ['paper.pdf'])).toBe(true);
    expect(shouldReadConversationDocuments('详细讲解量子计算', ['paper.pdf'])).toBe(false);
    expect(shouldReadConversationDocuments('继续解释 Python 装饰器', ['paper.pdf'])).toBe(false);
    expect(shouldReadConversationDocuments('换个话题，给我讲解电磁学', ['paper.pdf'])).toBe(false);
    expect(shouldReadConversationDocuments('详细讲解第3页', ['paper.pdf'])).toBe(false);
    expect(shouldReadConversationDocuments('详细讲解第3到5页', ['paper.pdf'])).toBe(false);
    expect(wantsDocumentReading('只高亮第3-5页', 'pdf-annotation')).toBe(false);
  });
  it('combines authorized conversation paths with newly mentioned documents', async () => {
    mocks.mentions.mockResolvedValue([{ type: 'file', path: 'new.md', target: 'new.md' }]);
    const documents = await captureAgentDocumentSources({ activeTab: null, rootHandle: root(), query: '继续分析 @new.md', contextPaths: ['old.md'] });
    expect(documents.map(source => source.path)).toEqual(['old.md', 'new.md']);
  });
  it('recognizes detailed paper questions even when the user has selected Chat', () => {
    expect(wantsDocumentReading('详细解释 @notes.md')).toBe(true);
    expect(wantsDocumentReading('详细解释 @paper.pdf#page=3')).toBe(false);
    expect(wantsDocumentReading('本文原理尤其鲁棒性如何实现，专业详细讲解')).toBe(true);
    expect(wantsDocumentReading('Explain the mechanisms in this paper in detail')).toBe(true);
    expect(wantsDocumentReading('继续详细解释')).toBe(true);
    expect(wantsDocumentReading('详细解释本文第3页')).toBe(false);
    expect(wantsDocumentReading('hi', 'paper-reading')).toBe(false);
  });
  beforeEach(() => { vi.resetAllMocks(); mocks.mentions.mockResolvedValue([]); mocks.open.mockImplementation(async (_file, path) => ({ path, close: vi.fn(async () => {}) })); });
  it('reads only authorized source handles and preserves explicit restart sources after switching tabs', async () => {
    const workspace = root();
    const documents = await captureAgentDocumentSources({ activeTab: tab('new.md'), rootHandle: workspace, query: 'read', resumePaths: ['original.md'] });
    expect(documents.map(source => source.path)).toEqual(['original.md']);
    expect(workspace.getFileHandle).toHaveBeenCalledWith('original.md');
  });
  it('restores explorer paths with the workspace root prefix after switching tabs', async () => {
    const original = handle('original.md');
    const workspace = root();
    vi.mocked(workspace.getFileHandle).mockImplementation(async name => {
      if (name === 'original.md') return original;
      throw new DOMException('File not found', 'NotFoundError');
    });
    vi.mocked(workspace.getDirectoryHandle).mockRejectedValue(new DOMException('Directory not found', 'NotFoundError'));
    const documents = await captureAgentDocumentSources({
      activeTab: tab('workspace/new.md'), rootHandle: workspace, query: 'continue', resumePaths: ['workspace/original.md'],
    });
    expect(documents.map(source => source.path)).toEqual(['workspace/original.md']);
    expect(original.getFile).toHaveBeenCalledTimes(1);
    expect(workspace.getDirectoryHandle).toHaveBeenCalledWith('workspace');
  });
  it('removes only one explorer root prefix when a child directory has the same name', async () => {
    const original = handle('original.md');
    const child = root();
    vi.mocked(child.getFileHandle).mockResolvedValue(original);
    vi.mocked(child.getDirectoryHandle).mockRejectedValue(new DOMException('Directory not found', 'NotFoundError'));
    const workspace = root();
    vi.mocked(workspace.getDirectoryHandle).mockImplementation(async name => {
      if (name === 'workspace') return child;
      throw new DOMException('Directory not found', 'NotFoundError');
    });
    await expect(resolveAuthorizedDocumentHandle(workspace, 'workspace/workspace/original.md')).resolves.toBe(original);
    expect(workspace.getFileHandle).not.toHaveBeenCalled();
  });
  it('preserves a same-name child directory when resolving an absolute desktop path', async () => {
    const original = handle('original.md');
    const child = root();
    vi.mocked(child.getFileHandle).mockResolvedValue(original);
    const workspace = root('C:/Research/workspace');
    vi.mocked(workspace.getDirectoryHandle).mockImplementation(async name => {
      if (name === 'workspace') return child;
      throw new DOMException('Directory not found', 'NotFoundError');
    });
    await expect(resolveAuthorizedDocumentHandle(workspace, 'C:/Research/workspace/workspace/original.md')).resolves.toBe(original);
    expect(workspace.getFileHandle).not.toHaveBeenCalled();
  });
  it('reads a root-relative same-name child when the prefixed interpretation is missing', async () => {
    const original = handle('original.md');
    const child = root();
    vi.mocked(child.getFileHandle).mockResolvedValue(original);
    const workspace = root();
    vi.mocked(workspace.getFileHandle).mockRejectedValue(new DOMException('File not found', 'NotFoundError'));
    vi.mocked(workspace.getDirectoryHandle).mockResolvedValue(child);
    await expect(resolveAuthorizedDocumentHandle(workspace, 'workspace/original.md')).resolves.toBe(original);
  });
  it('rejects ambiguous root-prefixed and root-relative files without reading either', async () => {
    const nested = handle('original.md');
    const topLevel = handle('original.md');
    const child = root();
    vi.mocked(child.getFileHandle).mockResolvedValue(nested);
    const workspace = root();
    vi.mocked(workspace.getFileHandle).mockResolvedValue(topLevel);
    vi.mocked(workspace.getDirectoryHandle).mockResolvedValue(child);
    await expect(resolveAuthorizedDocumentHandle(workspace, 'workspace/original.md')).rejects.toThrow(/ambiguous/i);
    expect(nested.getFile).not.toHaveBeenCalled();
    expect(topLevel.getFile).not.toHaveBeenCalled();
  });
  it('does not reinterpret a permission failure as a missing path', async () => {
    const workspace = root();
    vi.mocked(workspace.getDirectoryHandle).mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    await expect(resolveAuthorizedDocumentHandle(workspace, 'workspace/original.md')).rejects.toThrow('Permission denied');
  });
  it('matches a desktop Windows root prefix case-insensitively', async () => {
    const original = handle('original.md');
    const workspace = root('C:/Research/workspace');
    vi.mocked(workspace.getFileHandle).mockResolvedValue(original);
    vi.mocked(workspace.getDirectoryHandle).mockRejectedValue(new DOMException('Directory not found', 'NotFoundError'));
    await expect(resolveAuthorizedDocumentHandle(workspace, 'WORKSPACE/original.md')).resolves.toBe(original);
  });
  it('does not mistake a similarly named relative directory for the workspace prefix', async () => {
    const original = handle('original.md');
    const child = root();
    vi.mocked(child.getFileHandle).mockResolvedValue(original);
    const workspace = root();
    vi.mocked(workspace.getDirectoryHandle).mockImplementation(async name => {
      if (name === 'workspace-notes') return child;
      throw new DOMException('Directory not found', 'NotFoundError');
    });
    await expect(resolveAuthorizedDocumentHandle(workspace, 'workspace-notes/original.md')).resolves.toBe(original);
    expect(workspace.getFileHandle).not.toHaveBeenCalled();
  });
  it('captures the active PDF and explicitly referenced Markdown as separate sources', async () => {
    mocks.mentions.mockResolvedValue([{ type: 'file', path: 'notes.md', target: 'notes.md' }]);
    const documents = await captureAgentDocumentSources({ activeTab: tab('paper.pdf'), rootHandle: root(), query: 'read @notes.md' });
    expect(documents.map(source => source.path)).toEqual(['paper.pdf', 'notes.md']);
  });
  it('keeps an independently authorized active file readable without a workspace', async () => {
    const active = tab('external/paper.pdf');
    const documents = await captureAgentDocumentSources({ activeTab: active, rootHandle: null, query: 'read' });
    expect(documents.map(source => source.path)).toEqual(['external/paper.pdf']);
    expect(active.fileHandle.getFile).toHaveBeenCalledTimes(1);
    await expect(captureAgentDocumentSources({ activeTab: tab('another.pdf'), rootHandle: null, query: 'read', resumePaths: ['external/paper.pdf'] })).rejects.toThrow(/无法重新访问/);
  });
  it('rejects traversal and sibling absolute paths before touching handles', async () => {
    const workspace = root('C:/Research');
    for (const path of ['../private.md', 'workspace/../private.md', 'workspace\\..\\private.md', 'a/../../private.md', 'C:/Research-other/private.md', 'C:/elsewhere/private.md']) {
      await expect(resolveAuthorizedDocumentHandle(workspace, path)).rejects.toThrow();
    }
    expect(workspace.getFileHandle).not.toHaveBeenCalled();
    expect(workspace.getDirectoryHandle).not.toHaveBeenCalled();
    await expect(resolveAuthorizedDocumentHandle(workspace, 'c:/RESEARCH/note.md')).resolves.toMatchObject({ name: 'note.md' });
    await expect(resolveAuthorizedDocumentHandle(root('/Research'), '/research/note.md')).rejects.toThrow(/outside/);
  });
  it('closes already captured sources if a later handle cannot be read', async () => {
    const workspace = root();
    vi.mocked(workspace.getFileHandle).mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    const close = vi.fn(async () => {});
    mocks.open.mockResolvedValueOnce({ path: 'paper.pdf', close });
    await expect(captureAgentDocumentSources({ activeTab: tab('paper.pdf'), rootHandle: workspace, query: 'read', resumePaths: ['paper.pdf', 'missing.md'] })).rejects.toThrow('Permission denied');
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('prioritizes explicit whole-document reading while leaving selected-passage requests focused', () => {
    expect(wantsDocumentReading('全文批注', 'pdf-annotation')).toBe(true);
    expect(wantsDocumentReading('高亮这段选区', 'pdf-annotation')).toBe(false);
    expect(wantsDocumentReading('read entire document', 'paper-reading')).toBe(true);
    expect(wantsDocumentReading('tell me about page 20', 'paper-reading')).toBe(false);
  });
});
