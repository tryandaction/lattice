import { describe, expect, it } from 'vitest';
import { isFocusedDocumentRequest, isTargetedDocumentRequest, isWholeDirectoryRequest, isWholeDocumentRequest } from '../request-intent';
import { wantsDocumentReading } from '../document-source-capture';

describe('complete directory reading intent', () => {
  it.each([
    '阅读目录中全部文章并讲述文章内容，对话内回复',
    '请把这个文件夹里的所有论文读完，然后比较它们',
    'Theoretical Research/taiyi/essay/06_fast_long_range_and_native_gates中文章都阅读并讲述文章内容，对话内回复',
    '@folder:papers 中每篇论文都阅读全文并批注',
    '把这批文档全部读一遍',
    '分析所有文件的完整内容',
    'Read every paper in this folder and compare their methods',
    'Please read all articles, then explain them in chat',
    'Read each document in the selected directory',
    'Review all papers in this folder',
    'Can you read every paper in this folder and compare them?',
    '不要只读前两页，要读完所有论文',
    'Do not only read the first two pages; read every paper completely',
    'Read every paper, then explain how do I implement the proposed methods',
    '阅读所有论文，然后解释如何读取实验测量结果',
    'Read all of these papers and annotate them',
    '读取并综合 @folder:notes 中所有文件的测量系数和公式，引用实际来源',
    '读所有论文',
    '批注全部文章',
    '综合全部文档的结论并比较方法',
  ])('recognizes the complete collection request: %s', query => {
    expect(isWholeDirectoryRequest(query)).toBe(true);
    expect(isWholeDocumentRequest(query)).toBe(true);
  });

  it.each([
    '不要读所有论文，只看第2页',
    '不要通读全部文章，只找相关段落',
    '不需要完整阅读文件夹，只查找BB1的定义',
    'Read all papers, but only the first two pages of each',
    'Do not read every paper; only find the relevant excerpts',
    'Only search relevant paragraphs in all documents',
    '不要完整阅读，只回答选中的这段',
    '只读第2页，不要读全文',
    '所有论文都阅读，但只读前两段',
    'Read all papers, but only read selected sections',
    'Read every paper, but only read the abstracts',
    '阅读全文，但只看摘要',
    '不要读完所有论文，先检索相关片段',
    '没有必要阅读所有论文，先检索相关片段',
    '不要批注全部文章，只分析选中这段',
    '只看第2页，不要读取全部文档',
    '不要批注全部文章',
    '不用综合所有文档',
  ])('honors an explicitly narrower or negative reading scope: %s', query => {
    expect(isWholeDirectoryRequest(query)).toBe(false);
    expect(isWholeDocumentRequest(query)).toBe(false);
  });

  it.each([
    '哪些论文讨论了BB1？',
    '在所有论文中搜索BB1',
    'Read the relevant papers in this directory',
    'Read all relevant papers in this directory',
    'How do I read all papers in a folder?',
    '在所有论文中搜索BB1并分析搜索结果',
    'How can I read every paper in a folder?',
    '怎么读所有论文',
    '如何读取全部文档',
    '怎么批注全部文章',
    '如何综合所有材料',
    '文件名是 all papers.md，帮我改名',
    '论文都在哪里？',
    '全文查找BB1',
  ])('does not confuse discovery, advice or one-document scope with whole-directory reading: %s', query => {
    expect(isWholeDirectoryRequest(query)).toBe(false);
    // Whole-document lookup still supports its established single-file phrase.
    if (query === '全文查找BB1') expect(isWholeDocumentRequest(query)).toBe(true);
    else expect(isWholeDocumentRequest(query)).toBe(false);
  });

  it('preserves bounded page and concept queries', () => {
    expect(isFocusedDocumentRequest('详细解释第3到5页')).toBe(true);
    expect(isWholeDocumentRequest('详细解释第3到5页')).toBe(false);
    expect(isTargetedDocumentRequest('本文中的BB1是什么？')).toBe(true);
    expect(isTargetedDocumentRequest('全文分析BB1')).toBe(false);
    expect(isWholeDocumentRequest('总结整篇论文，包括BB1')).toBe(true);
  });

  it('routes a detailed report explanation through full document reading when a report is open', () => {
    const query = '请详细讲解报告的原理、实验方法和结果。';
    expect(wantsDocumentReading(query, undefined, { hasDocumentContext: true })).toBe(true);
    expect(wantsDocumentReading(query, undefined, { hasDocumentContext: false })).toBe(false);
    expect(wantsDocumentReading('请详细讲解这份报告。只回答选中的这段。', undefined, { hasDocumentContext: true })).toBe(false);
    expect(wantsDocumentReading('请详细讲解选中的这段报告。', undefined, { hasDocumentContext: true })).toBe(false);
  });
});
