import { describe, expect, it } from 'vitest';

import { classifyAgentError } from '../ai/agent-error';

describe('agent-error', () => {
  it('classifies policy, provider, context, and tool failures', () => {
    expect(classifyAgentError({
      stage: 'tool.policy',
      toolName: 'runner.runCode',
      error: 'Run code denied by chat policy.',
    })).toMatchObject({
      category: 'policy',
      recoveryHint: expect.stringContaining('agent profile'),
      toolName: 'runner.runCode',
    });

    expect(classifyAgentError({
      stage: 'planner.generate',
      error: new Error('provider offline'),
    })).toMatchObject({
      category: 'provider',
      recoveryHint: expect.stringContaining('AI provider'),
    });

    expect(classifyAgentError({
      stage: 'context.evidence',
      toolName: 'evidence.resolve',
      error: 'Evidence context failed.',
    })).toMatchObject({
      category: 'context',
      recoveryHint: expect.stringContaining('context pack'),
    });

    expect(classifyAgentError({
      stage: 'tool.execute',
      toolName: 'memory.write',
      error: 'Memory write failed.',
    })).toMatchObject({
      category: 'storage',
      recoveryHint: expect.stringContaining('persistence'),
    });
  });
});
