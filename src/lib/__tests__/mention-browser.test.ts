import { describe, expect, it } from 'vitest';
import {
  createMentionBacktrackResult,
  createMentionSelectionResult,
  getMentionSelectionStage,
  getActiveMentionQuery,
} from '../ai/mention-browser';

describe('getActiveMentionQuery', () => {
  it.each(['中文章都阅读并讲述文章内容，对话内回复', '中的文章都阅读', '里的论文都总结', '下的文档逐篇分析', '内的文件全部读取'])(
    'ends a complete folder mention before an adjoining task: %s', suffix => {
      const text = '@folder:Theoretical%20Research/taiyi/essay/06_fast_long_range_and_native_gates' + suffix;
      expect(getActiveMentionQuery(text, text.length)).toBeNull();
    });
  it.each(['@folder:Theoretical%20Research/', '@folder:papers/中文资料', '@folder:papers/%E4%B8%AD%E6%96%87%E7%AB%A0'])(
    'retains folder path editing before ordinary task text begins: %s', text => {
      expect(getActiveMentionQuery(text, text.length)).toBe(text.slice(1));
    });
  it.each(['@folder:a/b中的文章都阅读', '@folder:a中的文章都阅读'])(
    'uses path-relative offsets when the final folder name is short: %s', text => {
      expect(getActiveMentionQuery(text, text.length)).toBeNull();
    });
});

describe('createMentionSelectionResult', () => {
  it('detects file vs fragment browsing stage', () => {
    expect(getMentionSelectionStage('notes/paper.md')).toBe('files');
    expect(getMentionSelectionStage('notes/paper.md#Method')).toBe('fragments');
  });

  it('finishes a whole-file selection without requiring fragments', () => {
    expect(createMentionSelectionResult(
      { type: 'file', value: '@notes/paper.md' },
      'notes/paper.md',
    )).toEqual({
      value: '@notes/paper.md',
      continueSelection: false,
      nextQuery: null,
    });
  });

  it('keeps file placeholder selections in fragment mode', () => {
    expect(createMentionSelectionResult(
      { type: 'file', value: '@notes/paper.md#' },
      'paper#',
    )).toEqual({
      value: '@notes/paper.md#',
      continueSelection: true,
      nextQuery: 'notes/paper.md#',
    });
  });

  it('finishes selection for fragment items', () => {
    expect(createMentionSelectionResult(
      { type: 'heading', value: '@notes/paper.md#Method' },
      'notes/paper.md#Met',
    )).toEqual({
      value: '@notes/paper.md#Method',
      continueSelection: false,
      nextQuery: null,
    });
  });

  it('creates a backtrack result from fragment browsing to file browsing', () => {
    expect(createMentionBacktrackResult('notes/paper.md#Method')).toEqual({
      value: '@notes/paper.md',
      continueSelection: true,
      nextQuery: 'notes/paper.md',
    });
  });
});
