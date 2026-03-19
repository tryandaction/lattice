import { describe, expect, it } from 'vitest';
import {
  createMentionBacktrackResult,
  createMentionSelectionResult,
  getMentionSelectionStage,
} from '../ai/mention-browser';

describe('createMentionSelectionResult', () => {
  it('detects file vs fragment browsing stage', () => {
    expect(getMentionSelectionStage('notes/paper.md')).toBe('files');
    expect(getMentionSelectionStage('notes/paper.md#Method')).toBe('fragments');
  });

  it('turns a file selection into fragment selection mode', () => {
    expect(createMentionSelectionResult(
      { type: 'file', value: '@notes/paper.md' },
      'notes/paper.md',
    )).toEqual({
      value: '@notes/paper.md#',
      continueSelection: true,
      nextQuery: 'notes/paper.md#',
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
