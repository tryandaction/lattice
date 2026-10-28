import { expect, it, vi } from 'vitest';
import { createLatticeHarnessToolRuntime, LATTICE_HARNESS_TOOLS } from '../lattice-source-tools';
import { createAuthorizedSourceIndex } from '../../source-index';
import { SourceTestDirectory } from '../../__tests__/fixtures/source-workspace';
import { buildResearchAgentPlannerPrompt } from '../../research-agent-llm-planner';
import { prepareHarnessConversationContext } from '../conversation-context';
import { buildLatticeProductOperationGuide } from '../../lattice-skills/product-operation-guide';

function runtime() {
  const root = new SourceTestDirectory('workspace');
  return createLatticeHarnessToolRuntime({ kind: 'local', root: root.handle(), workspaceKey: 'guide',
    index: createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'guide', selections: [{ kind: 'folder', path: '.' }] }) });
}
it('describes executable product operations instead of legacy tool names in every discovered skill', async () => {
  const tools = runtime(), declared = new Set<string>(LATTICE_HARNESS_TOOLS.map(tool => tool.name));
  const listing = await tools.execute('lattice.skills.list', {}) as { skills: Array<{ id: string }> };
  for (const { id } of listing.skills) {
    const skill = await tools.execute('lattice.skills.get', { id }) as { descriptor: { notes: string[] }; executableTools: string[]; contracts: Array<{ sourceApiTools: string[]; rules: string[] }> };
    for (const contract of skill.contracts) {
      expect(contract.sourceApiTools.every(tool => declared.has(tool))).toBe(true);
      expect(contract.rules.join(' ')).not.toMatch(/workbench\.create|workspace\.readIndexedContext|lattice\.resolvePathIdentity/);
    }
    expect(skill.descriptor.notes.join(' ')).not.toMatch(/workbench\.create|workspace\.readIndexedContext|lattice\.resolvePathIdentity/);
  }
});
it('gives both API planning and local Harness the same concrete Lattice operating instructions', async () => {
  const planner = buildResearchAgentPlannerPrompt({ task: '批注核心并新建子文件', query: '批注核心并新建子文件', apiTools: LATTICE_HARNESS_TOOLS });
  const harness = await prepareHarnessConversationContext({ text: '批注核心并新建子文件', paths: [], history: [], execute: vi.fn() });
  for (const prompt of [planner, harness.prompt]) {
    expect(prompt).toContain('Lattice product operations');
    expect(prompt).toContain('lattice.pdf.proposeAnnotations');
    expect(prompt).toContain('lattice.pdf.proposeChild');
    expect(prompt).toContain('lattice.workspace.proposeWrite');
    expect(prompt).toContain('pending-review');
    expect(prompt).toContain('cloud deployment is not an executable tool');
  }
});
it('does not instruct a restricted runtime to call product operations whose required tools are unavailable', () => {
  const guide = buildLatticeProductOperationGuide(['lattice.sources.read']);
  expect(guide).not.toContain('lattice.workspace.proposeWrite');
  expect(guide).not.toContain('lattice.pdf.proposeAnnotations');
  expect(guide).not.toContain('lattice.pdf.proposeChild');
});
