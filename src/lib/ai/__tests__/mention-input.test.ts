import { describe, expect, it } from 'vitest';
import { getActiveMentionQuery } from '../mention-browser';

describe('composer mention editing boundary', () => {
  it.each(['@folder:Research%20Notes/ ', '@folder:Research%20Notes 解释所有论文', '@paper.md#page=3 解释', '@selection 继续', '邮件 a@b.com'])('leaves ordinary text outside the picker: %s', value => {
    expect(getActiveMentionQuery(value, value.length)).toBeNull();
  });
  it('reopens only at the actual edited reference and keeps encoded spaces intact', () => {
    expect(getActiveMentionQuery('@folder:Research%20Notes/', 25)).toBe('folder:Research%20Notes/');
    expect(getActiveMentionQuery('解释 @paper.md#page=3 后续', '解释 @paper.md#page=3'.length)).toBe('paper.md#page=3');
    expect(getActiveMentionQuery('说明 @', 4)).toBe('');
  });
});
