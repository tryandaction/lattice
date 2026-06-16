import {
  runResearchAgent,
  type ResearchAgentRunInput,
  type ResearchAgentRunResult,
} from './research-agent';

export type MockedResearchRunInput = ResearchAgentRunInput;
export type MockedResearchRunResult = ResearchAgentRunResult;

export async function runMockedResearchAgent(
  input: MockedResearchRunInput = {},
): Promise<MockedResearchRunResult> {
  return runResearchAgent({
    task: 'Mocked research run',
    title: 'Mocked research run',
    filePath: 'mock/research-note.md',
    content: '# Mock research note\nEvidence-first research workflow.',
    selection: 'Evidence-first research workflow.',
    query: 'Summarize the mocked research evidence.',
    workspaceKey: 'mocked-research-workspace',
    ...input,
  });
}
