import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateMock, routeModelMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  routeModelMock: vi.fn(),
}));

vi.mock('../ai/model-router', () => ({
  routeModel: routeModelMock,
}));

import { aiOrchestrator } from '../ai/orchestrator';
import { buildCitationContracts } from '../ai/citation-contract';
import type { AiGenerateOptions, AiMessage, AiRuntimeSettings } from '../ai/types';

const baseSettings: AiRuntimeSettings = {
  aiEnabled: true,
  providerId: 'openai',
  model: 'gpt-test',
  temperature: 0.1,
  maxTokens: 800,
  systemPrompt: 'system prompt',
};

// Substantive deterministic fixture for delivery checks, not a model quality score.
const detailedFixture = [
  '## Core idea',
  'A calculation needs an explicit input set, an operation, and a verification rule. For a sample mean, add all observed values and divide the sum by the number of observations. This operation gives each supplied value the same weight. The implementation should reject an empty sample because division by zero does not produce a meaningful estimate.',
  '## Steps',
  'First inspect the data types and missing values. Then compute the count and sum from the same rows. Finally compare the reported result with an independent calculation. For the values 2, 4, and 6, the sum is 12, the count is 3, and the mean is 4. This checks arithmetic consistency; it does not establish whether the data represent a broader population.',
  '## Example',
  'If one observation is missing, explicitly decide whether to exclude that row or use a documented imputation rule. Never silently replace it with zero. Report this choice alongside the result, since it changes what the estimate means.',
].join('\n\n');

describe('AiOrchestrator', () => {
  it('does not resend an empty answer when the selected model already reached its output ceiling', async () => {
    const selection=routeModelMock.getMockImplementation()!();
    selection.provider.getMaxOutputTokens=vi.fn(()=>8192);
    routeModelMock.mockReturnValue(selection);
    generateMock.mockResolvedValue({text:'',model:'gpt-test',finishReason:'length'});
    await expect(aiOrchestrator.runChat({prompt:'Why does the supplied pulse cancel amplitude errors?',settings:{...baseSettings,maxTokens:128000}}))
      .rejects.toMatchObject({reason:'no_progress'});
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock.mock.calls[0][1]).toMatchObject({maxTokens:8192,recoveryMaxTokens:8192});
  });

  it('applies the same ceiling to streaming without a duplicate empty recovery request', async () => {
    const selection=routeModelMock.getMockImplementation()!();
    selection.provider.getMaxOutputTokens=vi.fn(()=>8192);
    const stream=vi.fn(async function*(){yield {type:'error',code:'output_limit',error:'Output limit'};});
    selection.provider.stream=stream;routeModelMock.mockReturnValue(selection);
    await expect(aiOrchestrator.runChatStreaming({prompt:'Explain the mechanism',settings:{...baseSettings,maxTokens:128000}},vi.fn()))
      .rejects.toMatchObject({reason:'no_progress'});
    expect(stream).toHaveBeenCalledTimes(1);expect(generateMock).not.toHaveBeenCalled();
  });
  it('continues an output-limited text answer instead of accepting a truncated result', async () => {
    generateMock.mockResolvedValueOnce({ text: 'The mechanism starts with ', model: 'gpt-test', finishReason: 'length' })
      .mockResolvedValueOnce({ text: 'the input signal and ends with a checked result.', model: 'gpt-test', finishReason: 'stop' });
    const result = await aiOrchestrator.runChat({ prompt: 'Explain this mechanism', settings: baseSettings });
    expect(result.text).toBe('The mechanism starts with the input signal and ends with a checked result.');
    expect(generateMock).toHaveBeenCalledTimes(2);
    expect(String(generateMock.mock.calls[1][0].at(-1).content)).toMatch(/continue/i);
  });

  it('continues a length-limited stream and preserves the visible prefix exactly once', async () => {
    let calls = 0;
    const selection = routeModelMock.getMockImplementation()!();
    selection.provider.stream = async function* () {
      calls++;
      if (calls === 1) { yield { type: 'text', text: 'The calculation gives ' }; yield { type: 'error', code: 'output_limit', error: 'Output truncated at token limit' }; }
      else { yield { type: 'text', text: 'a reproducible result.' }; yield { type: 'done' }; }
    };
    routeModelMock.mockReturnValue(selection);
    const deltas: string[] = [];
    const result = await aiOrchestrator.runChatStreaming({ prompt: 'Explain this calculation', settings: baseSettings }, delta => deltas.push(delta));
    expect(result.text).toBe('The calculation gives a reproducible result.');
    expect(deltas.join('')).toBe(result.text);
    expect(calls).toBe(2);
  });

  it('does not allocate a 128000-token response budget to a greeting', async () => {
    generateMock.mockResolvedValue({ text: 'Hello', model: 'gpt-test' });
    await aiOrchestrator.runChat({ prompt: 'hi', settings: { ...baseSettings, maxTokens: 128000 } });
    expect(generateMock.mock.calls[0][1].maxTokens).toBeLessThanOrEqual(512);
  });
  it('bounds historical text before parsing and marks missing history explicitly', async () => {
    generateMock.mockResolvedValue({ text: 'Answer', model: 'gpt-test' });
    const history: AiMessage[] = [{ role: 'assistant', content: 'old '.repeat(100000) }, { role: 'user', content: 'Recent follow-up' }];
    await aiOrchestrator.runChat({ prompt: 'Continue', history, settings: baseSettings });
    const messages = generateMock.mock.calls[0][0] as AiMessage[];
    expect(String(messages[1].content)).toContain('Historical message truncated');
    expect(String(messages[1].content).length).toBeLessThan(4001);
    expect(messages[2].content).toBe('Recent follow-up');
    expect(String(history[0].content)).toHaveLength(400000);
  });

  it('rejects cancellation even if a provider ignores the signal and returns valid prose', async () => {
    const controller = new AbortController();
    generateMock.mockImplementation(async () => { controller.abort(); return { text: 'Late valid prose', model: 'gpt-test' }; });
    await expect(aiOrchestrator.runChat({ prompt: 'Question', settings: baseSettings, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a repair that only strips broken citations while repeating the same unsupported claim', async () => {
    generateMock.mockResolvedValueOnce({ text: 'The field is 58 G [p.3](citation:missing?quote=fake).', model: 'gpt-test' })
      .mockResolvedValueOnce({ text: 'The field is 58 G.', model: 'gpt-test' });
    await expect(aiOrchestrator.runChat({ prompt: 'field?', settings: baseSettings, filePath: 'paper.pdf', content: '--- Page 3 ---\nActual evidence.' })).rejects.toThrow();
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it('repairs an invalid quote against the same supplied evidence before returning chat', async () => {
    const quote = 'The measured field is 58 G.';
    generateMock.mockImplementation(async (messages: AiMessage[]) => {
      const id = String(messages[0].content).match(/citation:(citation-v2-[a-z0-9]+)/)![1];
      return { text: generateMock.mock.calls.length === 1
        ? `A field [p.3](citation:${id}?quote=Invented%20quote).`
        : `The field is 58 G [p.3](citation:${id}?quote=${encodeURIComponent(quote)}).`, model: 'gpt-test' };
    });
    const result = await aiOrchestrator.runChat({ prompt: 'field?', settings: baseSettings, filePath: 'paper.pdf', content: `--- Page 3 ---\n${quote}` });
    expect(generateMock).toHaveBeenCalledTimes(2);
    expect(result.text).toContain('The field is 58 G');
    const repairMessages = generateMock.mock.calls[1][0] as AiMessage[];
    expect(repairMessages.at(-2)?.role).toBe('assistant');
    expect(repairMessages.at(-2)?.content).toContain('Invented%20quote');
    expect(repairMessages.at(-1)?.content).toContain('引文');
  });

  it('does not report invalid citations as a successful final answer after one repair', async () => {
    generateMock.mockResolvedValue({ text: '[p.3](citation:missing?quote=fake)', model: 'gpt-test' });
    await expect(aiOrchestrator.runChat({ prompt: 'field?', settings: baseSettings, filePath: 'paper.pdf', content: '--- Page 3 ---\nActual evidence.' })).rejects.toThrow('引文');
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it('repairs the final streamed answer without appending a duplicate replacement to deltas', async () => {
    const deltas: string[] = [];
    const selection = routeModelMock.getMockImplementation()!();
    selection.provider.stream = async function* () {
      yield { type: 'text', text: '[p.3](citation:missing?quote=fake)' };
      yield { type: 'done' };
    };
    generateMock.mockImplementation(async (messages: AiMessage[]) => {
      const id = String(messages[0].content).match(/citation:(citation-v2-[a-z0-9]+)/)![1];
      return { text: `Verified [p.3](citation:${id}?quote=Actual%20evidence.)`, model: 'gpt-test' };
    });
    routeModelMock.mockReturnValue(selection);
    const result = await aiOrchestrator.runChatStreaming({ prompt: 'field?', settings: baseSettings, filePath: 'paper.pdf', content: '--- Page 3 ---\nActual evidence.' }, text => deltas.push(text));
    expect(result.text).toMatch(/^Verified/);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(['[p.3](citation:missing?quote=fake)']);
  });

  beforeEach(() => {
    generateMock.mockReset();
    routeModelMock.mockReset();
    routeModelMock.mockReturnValue({
      provider: {
        generate: generateMock,
      },
      modelInfo: {
        providerId: 'openai',
        providerName: 'OpenAI',
        model: 'gpt-test',
        source: 'cloud',
      },
      policy: {
        taskType: 'chat',
        preferredProvider: 'openai',
        fallbackProvider: null,
        maxContextTokens: 4000,
        evidenceRequired: true,
      },
    });
  });

  it('requires claim-specific quotes for page context while ranking evidence by the actual question', async () => {
    generateMock.mockResolvedValue({ text: 'Answer', model: 'gpt-test' });
    const result = await aiOrchestrator.runChat({
      prompt: 'magnetic field', settings: baseSettings, filePath: 'paper.pdf',
      content: '--- Page 3 ---\nPolarizability measurement.\n--- Page 12 ---\nThe magnetic field is 58 G.',
    });
    const contracts = buildCitationContracts(result.evidenceRefs);
    expect(result.evidenceRefs[0].anchor?.page).toBe(12);
    const messages = generateMock.mock.calls[0][0] as AiMessage[];
    for (const contract of contracts) {
      expect(messages[0].content).toContain(`citation:${contract.stableId}?quote=URL_ENCODED_EXACT_QUOTE`);
      expect(messages[0].content).not.toContain(`(citation:${contract.stableId})`);
    }
    expect(messages[0].content).toContain('immediately after');
    expect(messages[0].content).toContain('Do not cite pages or passages that were not supplied');
    expect(messages[0].content).toContain('Do not list all available sources or context pages');
    expect(messages[0].content).toContain('A PDF page without a passage anchor is context, not a precise citation');
  });

  it('returns model info, evidence refs, context, and follow-up actions for chat requests', async () => {
    generateMock.mockResolvedValue({
      text: 'Conclusion\n\nEvidence\n\nNext actions',
      model: 'gpt-test',
    });

    const result = await aiOrchestrator.runChat({
      prompt: 'Explain the experiment',
      history: [{ role: 'user', content: 'Previous question' }],
      settings: baseSettings,
      filePath: 'lab/notes.md',
      content: '# Experiment\nObserved a clear trend.',
      explicitEvidenceRefs: [
        {
          kind: 'heading',
          label: 'lab/notes.md#Experiment',
          locator: 'lab/notes.md#Experiment',
        },
      ],
    });

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(result.text).toContain('Conclusion');
    expect(result.model.providerName).toBe('OpenAI');
    expect(result.context.nodes.length).toBeGreaterThan(0);
    expect(result.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'heading',
          locator: 'lab/notes.md#Experiment',
        }),
      ]),
    );
    expect(result.followUpActions.map((action) => action.kind)).toEqual([
      'create_draft',
      'propose_task',
    ]);
    expect(result.draftSuggestion?.type).toBe('paper_note');
  });

  it('uses the model selected by the router instead of a stale settings model', async () => {
    generateMock.mockResolvedValue({ text: 'Current model answer', model: 'current-model' });
    routeModelMock.mockReturnValue({
      provider: { generate: generateMock },
      modelInfo: {
        providerId: 'openai',
        providerName: 'Selected connection',
        model: 'current-model',
        source: 'cloud',
      },
      policy: {
        taskType: 'chat',
        preferredProvider: 'openai',
        fallbackProvider: null,
        maxContextTokens: 4000,
        evidenceRequired: true,
      },
    });

    await aiOrchestrator.runChat({
      prompt: 'Use the current model',
      settings: { ...baseSettings, model: 'stale-model' },
    });

    expect(generateMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ model: 'current-model' }),
    );
  });

  it('preserves the previous user and assistant turns for a consecutive follow-up', async () => {
    generateMock
      .mockResolvedValueOnce({ text: 'First answer', model: 'gpt-test' })
      .mockResolvedValueOnce({ text: 'Second answer', model: 'gpt-test' });
    await aiOrchestrator.runChat({ prompt: 'First question', settings: baseSettings });
    const history = [{ role: 'user' as const, content: 'First question' }, { role: 'assistant' as const, content: 'First answer' }];
    await aiOrchestrator.runChat({ prompt: 'Follow up', history, settings: baseSettings });
    const secondMessages = generateMock.mock.calls[1]?.[0] as Array<{ role: string; content: string }>;
    expect(secondMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'First question' }),
      expect.objectContaining({ role: 'assistant', content: 'First answer' }),
    ]));
  });

  it('does not inject workspace search context into chat unless query is explicitly provided', async () => {
    generateMock.mockResolvedValue({
      text: 'No workspace search',
      model: 'gpt-test',
    });

    const result = await aiOrchestrator.runChat({
      prompt: 'Find related notes',
      settings: baseSettings,
    });

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(result.context.nodes).toEqual([]);
    expect(result.evidenceRefs).toEqual([]);
  });

  it('asks for teaching depth on explanatory questions without forcing verbose greetings', async () => {
    generateMock.mockResolvedValue({ text: detailedFixture, model: 'gpt-test' });

    await aiOrchestrator.runChat({
      prompt: '详细讲解均值计算 code 为什么这样处理缺失值',
      settings: baseSettings,
      filePath: 'paper.pdf',
      content: 'Relevant paper text.',
    });
    const explanatoryMessages = generateMock.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    const explanatorySystem = explanatoryMessages.find((message) => message.role === 'system')?.content ?? '';
    expect(explanatorySystem).toContain('direct answer');
    expect(explanatorySystem).toContain('core idea');
    expect(explanatorySystem).toContain('minimal verifiable example');
    expect(explanatorySystem).not.toContain('Be concise');
    expect(explanatorySystem).toContain('## Core idea');
    expect(explanatorySystem).toContain('## Steps');
    expect(explanatorySystem).toContain('## Example');
    expect(generateMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      maxTokens: 800,
      recoveryMaxTokens: 800,
    }));

    generateMock.mockClear();
    await aiOrchestrator.runChat({ prompt: 'hi', settings: baseSettings });
    const greetingMessages = generateMock.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    const greetingSystem = greetingMessages.find((message) => message.role === 'system')?.content ?? '';
    expect(greetingSystem).toContain('Keep greetings and simple questions brief');
  });

  it('expands an obviously short answer once when the user explicitly asks for detail', async () => {
    generateMock
      .mockResolvedValueOnce({ text: '4,2,2 码可以检测擦除。', model: 'gpt-test' })
      .mockResolvedValueOnce({
        text: detailedFixture,
        model: 'gpt-test',
      });

    const result = await aiOrchestrator.runChat({
      prompt: '详细讲解 4,2,2 码为什么能检测擦除错误',
      settings: baseSettings,
      filePath: 'paper.pdf',
      content: 'Relevant paper text.',
    });

    expect(generateMock).toHaveBeenCalledTimes(2);
    const refinementMessages = generateMock.mock.calls[1]?.[0] as Array<{ role: string; content: string }>;
    expect(refinementMessages.at(-1)?.content).toContain('requested depth');
    expect(result.text).toContain('## Core idea');
    expect(result.text).toContain('## Example');
  });

  it('repairs shallow streaming delivery once without appending a duplicate replacement', async () => {
    const selection = routeModelMock.getMockImplementation()!();
    selection.provider.stream = async function* () { yield { type: 'text', text: 'Only a summary.' }; yield { type: 'done' }; };
    routeModelMock.mockReturnValue(selection);
    generateMock.mockResolvedValue({ text: detailedFixture, model: 'gpt-test' });
    const deltas: string[] = [];
    const result = await aiOrchestrator.runChatStreaming({ prompt: 'Explain the calculation in detail', settings: baseSettings }, delta => deltas.push(delta));
    expect(result.text).toBe(detailedFixture);
    expect(deltas).toEqual(['Only a summary.']);
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('does not reject a complete short derivation based only on character count', async () => {
    const answer = '对方程 x + 1 = 2 两边同时减去 1，得到 x = 1。代回原式，1 + 1 = 2，等式成立。';
    generateMock.mockResolvedValue({ text: answer, model: 'gpt-test' });
    await expect(aiOrchestrator.runChat({ prompt: '详细推导 x+1=2', settings: baseSettings })).resolves.toMatchObject({ text: answer });
    expect(generateMock).toHaveBeenCalledTimes(2);
  });
  it('preserves an existing answer when the depth expansion request fails', async () => {
    generateMock.mockResolvedValueOnce({ text: 'Useful existing short answer.', model: 'gpt-test' }).mockRejectedValueOnce(new Error('Network offline during expansion'));
    await expect(aiOrchestrator.runChat({ prompt: 'Explain in detail', settings: baseSettings })).rejects.toMatchObject({ partialText: 'Useful existing short answer.', reason: 'provider' });
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it('retries an empty provider response before completing a chat answer', async () => {
    generateMock
      .mockResolvedValueOnce({ text: '', model: 'gpt-test' })
      .mockResolvedValueOnce({ text: 'Recovered answer', model: 'gpt-test' });

    const result = await aiOrchestrator.runChat({
      prompt: 'Explain the result',
      settings: baseSettings,
    });

    expect(result.text).toBe('Recovered answer');
    expect(generateMock).toHaveBeenCalledTimes(2);
    expect(generateMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      maxTokens: 800,
      recoveryMaxTokens: 800,
      temperature: 0.2,
    }));
  });

  it('streams deltas through one assistant boundary and retries an empty stream once', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const stream = async function* () {
      yield { type: 'text' as const, text: '第一段' };
      yield { type: 'text' as const, text: '第二段' };
      yield { type: 'done' as const };
    };
    routeModelMock.mockReturnValue({
      provider: {
        generate: generateMock,
        stream: async function* (_messages: AiMessage[], options?: AiGenerateOptions) {
          receivedSignal = options?.signal;
          yield* stream();
        },
      },
      modelInfo: {
        providerId: 'openai',
        providerName: 'OpenAI',
        model: 'gpt-test',
        source: 'cloud',
      },
      policy: {
        taskType: 'chat',
        preferredProvider: 'openai',
        fallbackProvider: null,
        maxContextTokens: 4000,
        evidenceRequired: true,
      },
    });

    const deltas: string[] = [];
    const result = await aiOrchestrator.runChatStreaming({
      prompt: 'Stream this answer',
      settings: baseSettings,
      signal: controller.signal,
    }, (delta) => deltas.push(delta));

    expect(deltas).toEqual(['第一段', '第二段']);
    expect(result.text).toBe('第一段第二段');
    expect(generateMock).not.toHaveBeenCalled();
    expect(receivedSignal).toBe(controller.signal);
  });

  it('uses one controlled generate retry when a stream has no final text', async () => {
    const stream = async function* () {
      yield { type: 'done' as const };
    };
    generateMock.mockResolvedValue({ text: 'Recovered from empty stream', model: 'gpt-test' });
    routeModelMock.mockReturnValue({
      provider: { generate: generateMock, stream },
      modelInfo: {
        providerId: 'openai',
        providerName: 'OpenAI',
        model: 'gpt-test',
        source: 'cloud',
      },
      policy: {
        taskType: 'chat',
        preferredProvider: 'openai',
        fallbackProvider: null,
        maxContextTokens: 4000,
        evidenceRequired: true,
      },
    });

    const result = await aiOrchestrator.runChatStreaming({ prompt: 'Empty stream', settings: baseSettings }, () => undefined);
    expect(result.text).toBe('Recovered from empty stream');
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('preserves AbortError semantics when a streaming request is cancelled', async () => {
    const controller = new AbortController();
    const stream = async function* (_messages: AiMessage[], _options?: AiGenerateOptions) {
      controller.abort();
      yield { type: 'error' as const, error: 'network request aborted' };
    };
    routeModelMock.mockReturnValue({
      provider: { generate: generateMock, stream },
      modelInfo: { providerId: 'openai', providerName: 'OpenAI', model: 'gpt-test', source: 'cloud' },
      policy: { taskType: 'chat', preferredProvider: 'openai', fallbackProvider: null, maxContextTokens: 4000, evidenceRequired: true },
    });

    await expect(aiOrchestrator.runChatStreaming({ prompt: 'Cancel this', settings: baseSettings, signal: controller.signal }, () => undefined))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes the caller abort signal to non-streaming chat generation', async () => {
    let receivedSignal: AbortSignal | undefined;
    const generateMock = vi.fn(async (_messages: AiMessage[], options?: AiGenerateOptions) => {
      receivedSignal = options?.signal;
      return { text: 'Answer', model: 'gpt-test' };
    });
    const controller = new AbortController();
    routeModelMock.mockReturnValue({
      provider: {
        generate: generateMock,
      },
      modelInfo: { providerId: 'openai', providerName: 'Test', model: 'gpt-test', source: 'cloud' },
      policy: { taskType: 'chat', preferredProvider: 'openai', fallbackProvider: null, maxContextTokens: 4000, evidenceRequired: true },
    });
    await aiOrchestrator.runChat({ prompt: 'Signal', settings: baseSettings, signal: controller.signal });
    expect(receivedSignal).toBe(controller.signal);
  });

  it('reports an explicit failure after two empty responses rather than claiming completion', async () => {
    generateMock.mockResolvedValue({ text: '', model: 'gpt-test' });
    await expect(aiOrchestrator.runChat({ prompt: 'Answer this question', settings: baseSettings }))
      .rejects.toMatchObject({ reason: 'no_progress', partialText: '' });
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to a safe default proposal when provider output is not valid json', async () => {
    generateMock.mockResolvedValue({
      text: 'not-json',
      model: 'gpt-test',
    });

    const proposal = await aiOrchestrator.proposeTask({
      prompt: '整理本周实验记录',
      settings: baseSettings,
      filePath: 'lab/log.md',
      content: '# Week log',
    });

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(proposal.summary).toBe('整理本周实验记录');
    expect(proposal.steps).toHaveLength(1);
    expect(proposal.requiredApprovals).toEqual([
      'Confirm any file creation or updates before execution',
    ]);
    expect(proposal.plannedWrites).toEqual([
      expect.objectContaining({
        targetPath: 'AI Drafts/整理本周实验记录 Plan.md',
        mode: 'create',
        contentPreview: expect.stringContaining('Proposal: 整理本周实验记录'),
      }),
    ]);
    expect(proposal.plannedWrites[0]?.contentPreview).toContain('lab/log.md#Week log');
    expect(proposal.approvedWrites).toEqual(['AI Drafts/整理本周实验记录 Plan.md']);
  });

  it('normalizes proposal planned writes and filters unsafe model targets', async () => {
    generateMock.mockResolvedValue({
      text: JSON.stringify({
        summary: 'Organize Alpha notes',
        steps: [
          {
            title: 'Review Alpha',
            description: 'Review Alpha sources.',
          },
        ],
        plannedWrites: [
          {
            targetPath: 'Research//alpha-plan.md',
            mode: 'append',
            contentPreview: 'Append Alpha plan.',
          },
          {
            targetPath: '../escape.md',
            mode: 'create',
            contentPreview: 'Unsafe traversal.',
          },
          {
            targetPath: 'C:/Users/me/unsafe.md',
            mode: 'update',
            contentPreview: 'Unsafe absolute path.',
          },
        ],
      }),
      model: 'gpt-test',
    });

    const proposal = await aiOrchestrator.proposeTask({
      prompt: 'Organize Alpha notes',
      settings: baseSettings,
      filePath: 'notes/alpha.md',
      content: '# Alpha\nResult summary.',
    });

    expect(proposal.summary).toBe('Organize Alpha notes');
    expect(proposal.steps).toEqual([
      {
        id: 'step-1',
        title: 'Review Alpha',
        description: 'Review Alpha sources.',
      },
    ]);
    expect(proposal.plannedWrites).toEqual([
      {
        targetPath: 'Research/alpha-plan.md',
        mode: 'append',
        contentPreview: 'Append Alpha plan.',
      },
    ]);
    expect(proposal.approvedWrites).toEqual(['Research/alpha-plan.md']);
  });
});
