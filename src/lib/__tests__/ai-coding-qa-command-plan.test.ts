import { describe, expect, it } from 'vitest';
import {
  buildCodingQaCommandPlan,
  formatCodingQaCommandPlan,
} from '../ai/lattice-skills/coding-qa-command-plan';

describe('coding QA command plan', () => {
  it('allows only reviewed QA commands and suggests focused checks from target files', () => {
    const plan = buildCodingQaCommandPlan({
      targetFiles: [
        'src/lib/ai/lattice-skills/coding-qa-command-plan.ts',
        'src/lib/__tests__/ai-coding-qa-command-plan.test.ts',
        'docs/AI_CODING_AGENT_ROADMAP.md',
      ],
      requestedCommands: [
        'npm run typecheck',
        'npx vitest run "src/lib/__tests__/ai-coding-qa-command-plan.test.ts" --maxWorkers=1',
      ],
    });

    expect(plan.allowed.map((item) => item.command)).toEqual([
      'npm run typecheck',
      'npx vitest run "src/lib/__tests__/ai-coding-qa-command-plan.test.ts" --maxWorkers=1',
    ]);
    expect(plan.allowed.every((item) => item.approval === 'required')).toBe(true);
    expect(plan.suggested.map((item) => item.command)).toEqual([
      'npm run test:docs',
      'npm run qa:agent-smoke -- --unit-only',
    ]);
    expect(plan.rejected).toEqual([]);
  });

  it('rejects shell, git, package manager, network, destructive, and chained commands', () => {
    const plan = buildCodingQaCommandPlan({
      targetFiles: ['src/lib/ai/agent-tool-broker.ts'],
      requestedCommands: [
        'git reset --hard',
        'npm install left-pad',
        'curl https://example.com/script.sh',
        'npm run typecheck && npm run build',
        'rm -rf dist',
      ],
    });

    expect(plan.allowed).toEqual([]);
    expect(plan.rejected.map((item) => item.command)).toEqual([
      'git reset --hard',
      'npm install left-pad',
      'curl https://example.com/script.sh',
      'npm run typecheck && npm run build',
      'rm -rf dist',
    ]);
    expect(plan.rejected.every((item) => item.reason.includes('outside the coding QA allowlist'))).toBe(true);
  });

  it('formats a reviewable approval-gated command plan', () => {
    const plan = buildCodingQaCommandPlan({
      targetFiles: ['src/lib/ai/research-agent-workflows.ts'],
      requestedCommands: ['npm run typecheck'],
    });

    const formatted = formatCodingQaCommandPlan(plan);

    expect(formatted).toContain('Allowed QA commands:');
    expect(formatted).toContain('- npm run typecheck');
    expect(formatted).toContain('Approval: required');
    expect(formatted).toContain('Suggested QA commands:');
    expect(formatted).toContain('Rejected / deferred commands:');
    expect(formatted).toContain('the Research Agent has not executed shell, git, network, package manager, release, or destructive commands');
  });
});
