import { describe, expect, it } from 'vitest';
import { describeHarnessFailure } from '../runtime-error';
describe('actionable native failure', () => {
  it('preserves the rejected effective model rather than replacing it with a generic failure', () => {
    const message = "There's an issue with the selected model (deepseek-v4-pro). It may not exist or you may not have access to it.";
    expect(describeHarnessFailure(new Error(message))).toContain('模型别名或转发服务');
    expect(describeHarnessFailure(new Error(message))).toContain('deepseek-v4-pro');
    expect(describeHarnessFailure(new Error('source file missing'))).toBe('source file missing');
  });
});
