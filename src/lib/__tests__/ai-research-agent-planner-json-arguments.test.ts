import { describe, expect, it } from 'vitest';
import { normalizeResearchAgentPlan } from '../ai/research-agent-planner';
import { parseResearchAgentPlannerOutput } from '../ai/research-agent-llm-planner';

const core = [
  { id: 'context-pack', title: 'Context', description: 'Bind authorized sources.' },
  { id: 'evidence-resolve', title: 'Evidence', description: 'Resolve source evidence.' },
  { id: 'synthesize-answer', title: 'Answer', description: 'Deliver the result.' },
];
function planWith(toolName: string, toolArgs: unknown) {
  return [...core, { id: 'actual-operation', title: 'Operation', description: 'Run the declared operation.', toolName, toolArgs }];
}

describe('strict serialized planner tool arguments', () => {
  it('accepts a once-serialized JSON object for source reads and a concrete pending PDF child proposal', () => {
    const content = '# QA note\n\nQuote: "carrier frequency is 61.7 MHz"\nLiteral JSON escape: \\n and \\u0041 stay literal.';
    const calls = [
      { id: 'search-source', toolName: 'lattice.sources.search', args: { query: 'BB1', maxFiles: 1, maxUnits: 10, maxChars: 8000 } },
      { id: 'read-source', toolName: 'lattice.sources.read', args: { path: 'essay/Synthetic BB1 2026.pdf', units: [12, 13], maxUnits: 2, maxChars: 8000 } },
      { id: 'propose-child', toolName: 'lattice.pdf.proposeChild', args: { parentPath: 'essay/Synthetic BB1 2026.pdf', fileName: 'qa-bb1.md', mode: 'create', content } },
    ];
    const plan = parseResearchAgentPlannerOutput({ output: JSON.stringify({ steps: [...core, ...calls.map(call => ({ id: call.id, title: call.id,
      description: 'Use the request-local tool.', status: 'completed', toolName: call.toolName, toolArgs: JSON.stringify(call.args) }))] }) });

    expect(plan.source).toBe('custom');
    expect(plan.warnings).toEqual([]);
    for (const call of calls) expect(plan.steps.find(step => step.id === call.id)).toMatchObject({ toolName: call.toolName, toolArgs: call.args, status: 'pending' });
    expect((plan.steps.find(step => step.id === 'propose-child')?.toolArgs as { content: string }).content).toBe(content);
  });

  it.each([
    '{"path":"paper.md",}',
    '({"path":"paper.md"})',
    '```json\n{"path":"paper.md"}\n```',
    '{/* comment */"path":"paper.md"}',
    '[]', 'null', '42', 'true', '"a string"',
    JSON.stringify(JSON.stringify({ path: 'paper.md' })),
  ])('rejects malformed, non-object or multiply serialized arguments: %s', toolArgs => {
    const plan = normalizeResearchAgentPlan({ planSteps: planWith('lattice.sources.read', toolArgs) });
    expect(plan.source).toBe('fallback');
    expect(plan.warnings.join('\n')).toContain('invalid toolArgs');
    expect(plan.steps.some(step => step.id === 'actual-operation')).toBe(false);
  });

  it.each([
    { path: 'paper.md', approvedByUser: true },
    { path: 'paper.md', maxChars: -1 },
    { path: 'paper.md', units: [0] },
    { path: 'paper.md', offsets: { '1': -1 } },
    { path: 'paper.md', cwd: 'outside' },
  ])('still applies the original source schema and permission restrictions after parsing: %j', args => {
    const plan = normalizeResearchAgentPlan({ planSteps: planWith('lattice.sources.read', JSON.stringify(args)) });
    expect(plan.source).toBe('fallback');
    expect(plan.warnings.join('\n')).toContain('invalid toolArgs');
  });

  it('does not turn serialized draft instructions into product approval or runner execution intent', () => {
    expect(normalizeResearchAgentPlan({ planSteps: planWith('workbench.createDraft', JSON.stringify({ draft: { content: '# Draft' } })) }).source).toBe('fallback');
    expect(normalizeResearchAgentPlan({ planSteps: planWith('runner.runCode', JSON.stringify({ language: 'python', code: 'print(1)' })) }).source).toBe('fallback');
    expect(normalizeResearchAgentPlan({ context: { allowCodeExecution: true }, planSteps: planWith('runner.runCode', JSON.stringify({ language: 'python', code: 'print(1)', approvedByUser: true })) }).source).toBe('fallback');
  });
});
