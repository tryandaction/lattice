import { describe, expect, it } from 'vitest';
import { parseStructuredAiResponse } from '../ai/structured-response';

describe('parseStructuredAiResponse', () => {
  it('parses markdown heading sections', () => {
    const parsed = parseStructuredAiResponse([
      '## Conclusion',
      'The model converged.',
      '',
      '## Evidence',
      '- paper.md#Result',
      '',
      '## Next Actions',
      '1. Validate on a larger dataset.',
    ].join('\n'));

    expect(parsed?.sections).toEqual([
      {
        kind: 'conclusion',
        title: 'Conclusion',
        content: 'The model converged.',
      },
      {
        kind: 'evidence',
        title: 'Evidence',
        content: '- paper.md#Result',
      },
      {
        kind: 'next_actions',
        title: 'Next Actions',
        content: '1. Validate on a larger dataset.',
      },
    ]);
  });

  it('parses colon-style chinese sections', () => {
    const parsed = parseStructuredAiResponse([
      '结论：',
      '结果稳定。',
      '证据：',
      '来自 notes.md#Method',
      '下一步：',
      '扩展样本规模。',
    ].join('\n'));

    expect(parsed?.sections.map((section) => section.kind)).toEqual([
      'conclusion',
      'evidence',
      'next_actions',
    ]);
  });

  it('parses inline same-line sections', () => {
    const parsed = parseStructuredAiResponse([
      '结论：结果稳定。',
      '**Evidence:** 来自 notes.md#Method 和 paper.pdf#page=2',
      'Next Actions: 1. 扩大样本规模',
    ].join('\n'));

    expect(parsed?.sections).toEqual([
      {
        kind: 'conclusion',
        title: 'Conclusion',
        content: '结果稳定。',
      },
      {
        kind: 'evidence',
        title: 'Evidence',
        content: '来自 notes.md#Method 和 paper.pdf#page=2',
      },
      {
        kind: 'next_actions',
        title: 'Next Actions',
        content: '1. 扩大样本规模',
      },
    ]);
  });

  it('returns null for unstructured content', () => {
    expect(parseStructuredAiResponse('Just a normal paragraph without explicit sections.')).toBeNull();
  });
});
