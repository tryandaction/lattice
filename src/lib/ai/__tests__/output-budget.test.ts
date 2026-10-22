import { describe, expect, it } from 'vitest';
import { effectiveOutputTokenCeiling, outputTokenBudget } from '../output-budget';

describe('effective output ceiling', () => {
  it.each([
    [128000,8192,8192], [1024,8192,1024], [128000,undefined,128000],
    [128000,Number.NaN,128000], [128000,0,128000], [128000,-1,128000],
    [Number.NaN,8192,4096], [0,2048,2048], [1.9,4096,1], [128000,8192.9,8192],
  ])('respects user %s and model %s without inferring new capability', (user,model,expected) => {
    expect(effectiveOutputTokenCeiling(user,model)).toBe(expected);
  });
  it('still uses task-sized output rather than allocating the entire ceiling to a greeting', () => {
    expect(outputTokenBudget(effectiveOutputTokenCeiling(128000,8192),'greeting')).toBe(512);
  });
});
