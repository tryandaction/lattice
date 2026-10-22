import { aiContextGraph } from './context-graph';
import { buildCitationPromptReferences, TARGETED_CITATION_INSTRUCTIONS } from './citation-prompt';
import { routeModel } from './model-router';
import { executeAnswer, retainAnswerOnFailure } from './answer-execution';
import { needsAnswerExpansion, taskDeliveryInstructions } from './task-outcome';
import { assertRepairedAnswerCitations, buildCitationRepairInstructions, validateAnswerCitations } from './citation-validation';
import { CITATION_HISTORY_INSTRUCTIONS, boundedCitationHistory as trimHistory } from './citation-history';
import { availableDocumentNotice } from './conversation-documents';
import { requestProgressReporter } from './request-lifecycle';
import { chatOutputBudget, effectiveOutputTokenCeiling } from './output-budget';
import { withRequestImages } from './request-images';
import type {
  AiChatRequest,
  AiDraftArtifactType,
  AiDraftTemplateId,
  AiFollowUpAction,
  AiInlineActionRequest,
  AiMessage,
  AiResearchActionRequest,
  AiRunResult,
  AiTaskProposal,
  AiTaskProposalRequest,
  AiTaskProposalStep,
  AiTaskType,
  EvidenceRef,
  AiGenerateResult,
  AiGenerateOptions,
  AiProvider,
} from './types';
import {
  buildLatticeProposalPlannedWrites,
  getApprovedPlannedWriteTargets,
} from './lattice-skills/proposal-planned-writes';

function draftTypeForTask(taskType: AiTaskType): AiDraftArtifactType {
  switch (taskType) {
    case 'pdf_summary':
    case 'research':
      return 'research_summary';
    case 'knowledge_organize':
      return 'comparison_summary';
    case 'notebook_assist':
      return 'experiment_note';
    case 'code_explain':
      return 'code_explainer';
    case 'inline':
      return 'paper_note';
    default:
      return 'paper_note';
  }
}

function draftTemplateForTask(taskType: AiTaskType): AiDraftTemplateId {
  switch (taskType) {
    case 'code_explain':
      return 'code-note';
    case 'knowledge_organize':
      return 'comparison-summary';
    case 'task_proposal':
      return 'task-plan';
    case 'pdf_summary':
    case 'research':
      return 'research-summary';
    default:
      return 'reading-note';
  }
}

function createFollowUpActions(): AiFollowUpAction[] {
  return [
    { id: 'create-draft', label: '保存为草稿', kind: 'create_draft' },
    { id: 'propose-task', label: '生成整理计划', kind: 'propose_task' },
  ];
}

function buildSystemPrompt(
  basePrompt: string,
  evidenceRefs: EvidenceRef[],
  evidenceRequired: boolean,
  userPrompt: string,
): string {
  const explanatory = /(?:详细|深入|解释|讲解|展开|为什么|how|why|explain|derive|proof|公式|代码|论文|paper|formula|code)/iu.test(userPrompt);
  const effectiveBasePrompt = explanatory
    ? basePrompt.replace(/\bBe concise(?: and precise)?\.?/giu, '').trim()
    : basePrompt;
  return [
    effectiveBasePrompt,
    'You are Lattice AI, an evidence-first research copilot for a scientific workbench.',
    CITATION_HISTORY_INSTRUCTIONS,
    taskDeliveryInstructions(userPrompt),
    'Answer for a personal researcher. Be precise, practical, and proportionate to the request.',
    'Keep greetings and simple questions brief. Do not add empty sections or generic filler.',
    explanatory
      ? [
          'This is an explanatory request. Start with a direct answer, but do not stop after a summary or repeat the previous short answer.',
          'Explain the core idea, the mechanism, and why it works, not only what it is. Use the following headings when the corresponding content is supported:',
          '## Conclusion',
          '## Core idea',
          '## Steps',
          '## Example',
          'Include a minimal verifiable example and connect citations to the claims they support.',
        ].join('\n')
      : 'Start with the direct answer and expand only as much as the question requires.',
    evidenceRequired
      ? 'Default to evidence-first reasoning. Ground your answer in the provided context and reference the most relevant evidence explicitly.'
      : 'Use the provided context carefully.',
    explanatory
      ? 'For this request, completeness and teaching clarity take priority over brevity.'
      : 'Use sections only when they help the answer. Keep supporting facts and inline citations in the answer body beside the claims they support.',
    evidenceRefs.length > 0
      ? [
          TARGETED_CITATION_INSTRUCTIONS,
          `Available evidence references:\n${buildCitationPromptReferences(evidenceRefs)}`,
        ].join('\n\n')
      : 'No explicit evidence references were provided.',
  ].join('\n\n');
}

/** One bounded repair using the exact context that will accompany this answer. */
async function repairAnswerCitations(
  result: AiGenerateResult,
  refs: EvidenceRef[],
  messages: AiMessage[],
  provider: AiProvider,
  options: AiGenerateOptions,
): Promise<AiGenerateResult> {
  options.signal?.throwIfAborted();
  const validation = validateAnswerCitations(result.text, refs);
  if (!validation.issues.length) return result;
  options.signal?.throwIfAborted();
  const repaired = await executeAnswer({ generate: provider.generate.bind(provider), messages: [
    ...messages,
    { role: 'assistant', content: result.text },
    { role: 'user', content: `引文校验失败，请核对原文后修复回答。\n${buildCitationRepairInstructions(validation)}` },
  ], options: { ...options, temperature: Math.min(options.temperature ?? 0.2, 0.2) } }).catch(error => { throw retainAnswerOnFailure(error, result.text); });
  options.signal?.throwIfAborted();
  if (!repaired.text.trim()) throw new Error('引文修复未返回有效回答，请重试。');
  assertRepairedAnswerCitations(result.text, repaired.text, refs);
  return repaired;
}



async function expandUnderAnsweredRequest(result: AiGenerateResult, prompt: string, messages: AiMessage[], provider: AiProvider, options: AiGenerateOptions): Promise<AiGenerateResult> {
  if (!needsAnswerExpansion(prompt, result.text)) return result;
  const expanded = await executeAnswer({ generate: provider.generate.bind(provider), messages: [
    ...messages,
    { role: 'assistant', content: result.text },
    { role: 'user', content: 'The previous answer did not meet the requested depth. Deliver the complete explanation with supported causal reasoning, necessary definitions, relevant examples and limitations. Preserve evidence ids. State missing evidence honestly; do not pad or invent details.' },
  ], options }).catch(error => { throw retainAnswerOnFailure(error, result.text); });
  const answer = expanded.text.trim().length > result.text.trim().length ? expanded : result;
  // Length can suggest a refinement, but cannot prove that a concise derivation
  // or evidence-gap explanation is incomplete.
  return answer;
}

function promptForInlineAction(request: AiInlineActionRequest): { prompt: string; taskType: AiTaskType } {
  switch (request.action) {
    case 'summarize':
      return { prompt: `Summarize the selected text:\n\n${request.input}`, taskType: 'inline' };
    case 'translate':
      return { prompt: `Translate the selected text into clear academic English:\n\n${request.input}`, taskType: 'inline' };
    case 'explain_formula':
      return { prompt: `Explain this formula step by step and clarify variable meanings:\n\n${request.input}`, taskType: 'research' };
    case 'improve_writing':
      return { prompt: `Rewrite this text for clarity and academic quality while preserving meaning:\n\n${request.input}`, taskType: 'knowledge_organize' };
    case 'continue_writing':
      return { prompt: `Continue this text in a coherent academic style:\n\n${request.input}`, taskType: 'knowledge_organize' };
  }
}

function promptForResearchAction(request: AiResearchActionRequest): { prompt: string; taskType: AiTaskType } {
  switch (request.action) {
    case 'summarize_paper':
      return { prompt: `Summarize this research material with objective, methods, results, and conclusions.\n\n${request.prompt}`, taskType: 'pdf_summary' };
    case 'extract_findings':
      return { prompt: `Extract key findings, contributions, and open questions from this material.\n\n${request.prompt}`, taskType: 'research' };
    case 'answer_question':
      return { prompt: `Answer the research question using the provided evidence-rich context.\n\n${request.prompt}`, taskType: 'pdf_qa' };
    case 'digest_annotations':
      return { prompt: `Group the annotations into themes, methods, findings, doubts, and next verification tasks.\n\n${request.prompt}`, taskType: 'research' };
    case 'explain_code':
      return { prompt: `Explain the code or script, its role, and any scientific implications.\n\n${request.prompt}`, taskType: 'code_explain' };
    case 'interpret_output':
      return { prompt: `Interpret this notebook output or experiment result and suggest next steps.\n\n${request.prompt}`, taskType: 'notebook_assist' };
  }
}

async function runGeneric(
  taskType: AiTaskType,
  prompt: string,
  settings: AiChatRequest['settings'],
  history: AiMessage[] | undefined,
  contextInput: Omit<AiChatRequest, 'prompt' | 'history' | 'settings' | 'signal'>,
  signal: AbortSignal | undefined,
): Promise<AiRunResult> {
  const explanatory = /(?:详细|深入|解释|讲解|展开|为什么|how|why|explain|derive|proof|公式|代码|论文|paper|formula|code)/iu.test(prompt);
  const selection = routeModel(taskType, settings);
  const promptContext = aiContextGraph.buildPromptContext(contextInput, selection.policy.maxContextTokens);

  const messages: AiMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(
        settings.systemPrompt,
        promptContext.evidenceRefs,
        selection.policy.evidenceRequired,
        prompt,
      ),
    },
    ...trimHistory(history, promptContext.evidenceRefs, Math.max(1500, Math.min(12000, selection.policy.maxContextTokens))),
    {
      role: 'user',
      content: [
        `User request:\n${prompt}`,
        availableDocumentNotice(contextInput.availableDocuments),
        'Use the supplied context. If evidence exists, cite it in the answer body.',
        `Context:\n${promptContext.prompt || '[no additional context]'}`,
      ].join('\n\n'),
    },
  ];

  const generationOptions = {
    model: selection.modelInfo.model ?? undefined,
    temperature: settings.temperature,
    maxTokens: chatOutputBudget(effectiveOutputTokenCeiling(settings.maxTokens, selection.provider.getMaxOutputTokens?.(selection.modelInfo.model)), prompt, explanatory),
    recoveryMaxTokens: effectiveOutputTokenCeiling(settings.maxTokens, selection.provider.getMaxOutputTokens?.(selection.modelInfo.model)),
    deadlineAt: selection.provider.requestTimeouts ? Date.now() + selection.provider.requestTimeouts.totalMs : undefined,
    signal,
    onProgress: contextInput.onProgress,
  };

  const requestMessages = withRequestImages(messages, contextInput.images);

  let result: AiGenerateResult = await executeAnswer({ generate: selection.provider.generate.bind(selection.provider), messages: requestMessages, options: generationOptions });

  result = await expandUnderAnsweredRequest(result, prompt, requestMessages, selection.provider, generationOptions);

  requestProgressReporter(contextInput.onProgress, Date.now(), 1).report('validating');
  result = await repairAnswerCitations(result, promptContext.evidenceRefs, requestMessages, selection.provider, generationOptions);
  return {
    text: result.text,
    evidenceRefs: promptContext.evidenceRefs,
    context: promptContext,
    model: selection.modelInfo,
    followUpActions: createFollowUpActions(),
    draftSuggestion: {
      type: draftTypeForTask(taskType),
      templateId: draftTemplateForTask(taskType),
      title: prompt.length > 64 ? `${prompt.slice(0, 64)}...` : prompt,
    },
  };
}

async function runGenericStreaming(
  taskType: AiTaskType,
  prompt: string,
  settings: AiChatRequest['settings'],
  history: AiMessage[] | undefined,
  contextInput: Omit<AiChatRequest, 'prompt' | 'history' | 'settings' | 'signal'>,
  signal: AbortSignal | undefined,
  onDelta: (text: string) => void,
): Promise<AiRunResult> {
  const explanatory = /(?:详细|深入|解释|讲解|展开|为什么|how|why|explain|derive|proof|公式|代码|论文|paper|formula|code)/iu.test(prompt);
  const selection = routeModel(taskType, settings);
  const promptContext = aiContextGraph.buildPromptContext(contextInput, selection.policy.maxContextTokens);
  const messages: AiMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(
        settings.systemPrompt,
        promptContext.evidenceRefs,
        selection.policy.evidenceRequired,
        prompt,
      ),
    },
    ...trimHistory(history, promptContext.evidenceRefs, Math.max(1500, Math.min(12000, selection.policy.maxContextTokens))),
    {
      role: 'user',
      content: [
        `User request:\n${prompt}`,
        availableDocumentNotice(contextInput.availableDocuments),
        'Use the supplied context. If evidence exists, cite it in the answer body.',
        `Context:\n${promptContext.prompt || '[no additional context]'}`,
      ].join('\n\n'),
    },
  ];
  const generationOptions = {
    model: selection.modelInfo.model ?? undefined,
    temperature: settings.temperature,
    maxTokens: chatOutputBudget(effectiveOutputTokenCeiling(settings.maxTokens, selection.provider.getMaxOutputTokens?.(selection.modelInfo.model)), prompt, explanatory),
    recoveryMaxTokens: effectiveOutputTokenCeiling(settings.maxTokens, selection.provider.getMaxOutputTokens?.(selection.modelInfo.model)),
    deadlineAt: selection.provider.requestTimeouts ? Date.now() + selection.provider.requestTimeouts.totalMs : undefined,
    signal,
    onProgress: contextInput.onProgress,
  };
  const requestMessages = withRequestImages(messages, contextInput.images);
  const streamed = await executeAnswer({ messages: requestMessages, options: generationOptions, generate: selection.provider.generate.bind(selection.provider), stream: selection.provider.stream.bind(selection.provider), onDelta });
  let text = streamed.text;
  const model = { ...selection.modelInfo, model: streamed.model || selection.modelInfo.model };

  const expanded = await expandUnderAnsweredRequest({ text, model: model.model ?? '' }, prompt, requestMessages, selection.provider, generationOptions);
  requestProgressReporter(contextInput.onProgress, Date.now(), 1).report('validating');
  const verified = await repairAnswerCitations(expanded, promptContext.evidenceRefs, requestMessages, selection.provider, generationOptions);
  text = verified.text;
  return {
    text,
    evidenceRefs: promptContext.evidenceRefs,
    context: promptContext,
    model,
    followUpActions: createFollowUpActions(),
    draftSuggestion: {
      type: draftTypeForTask(taskType),
      templateId: draftTemplateForTask(taskType),
      title: prompt.length > 64 ? `${prompt.slice(0, 64)}...` : prompt,
    },
  };
}

function safeJsonParse<T>(input: string): T | null {
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

export class AiOrchestrator {
  async runChat(request: AiChatRequest): Promise<AiRunResult> {
    return runGeneric(
      'chat',
      request.prompt,
      request.settings,
      request.history,
      {
        filePath: request.filePath,
        content: request.content,
        selection: request.selection,
        references: request.references,
        annotations: request.annotations,
        query: request.query ?? request.prompt,
        explicitEvidenceRefs: request.explicitEvidenceRefs,
        availableDocuments: request.availableDocuments,
        images: request.images,
        onProgress: request.onProgress,
      },
      request.signal,
    );
  }

  async runChatStreaming(
    request: AiChatRequest,
    onDelta: (text: string) => void,
  ): Promise<AiRunResult> {
    return runGenericStreaming(
      'chat',
      request.prompt,
      request.settings,
      request.history,
      {
        filePath: request.filePath,
        content: request.content,
        selection: request.selection,
        references: request.references,
        annotations: request.annotations,
        query: request.query ?? request.prompt,
        explicitEvidenceRefs: request.explicitEvidenceRefs,
        availableDocuments: request.availableDocuments,
        images: request.images,
        onProgress: request.onProgress,
      },
      request.signal,
      onDelta,
    );
  }

  async runInlineAction(request: AiInlineActionRequest): Promise<AiRunResult> {
    const { prompt, taskType } = promptForInlineAction(request);
    return runGeneric(taskType, prompt, request.settings, [], {
      filePath: request.filePath,
      content: request.content,
      selection: request.selection ?? request.input,
      references: request.references,
      annotations: request.annotations,
      query: request.input,
      explicitEvidenceRefs: request.explicitEvidenceRefs,
    }, undefined);
  }

  async runResearchAction(request: AiResearchActionRequest): Promise<AiRunResult> {
    const { prompt, taskType } = promptForResearchAction(request);
    return runGeneric(taskType, prompt, request.settings, [], {
      filePath: request.filePath,
      content: request.content,
      selection: request.selection,
      references: request.references,
      annotations: request.annotations,
      query: request.prompt,
      explicitEvidenceRefs: request.explicitEvidenceRefs,
    }, undefined);
  }

  async proposeTask(request: AiTaskProposalRequest): Promise<AiTaskProposal> {
    const selection = routeModel('task_proposal', request.settings);
    const promptContext = aiContextGraph.buildPromptContext(request, selection.policy.maxContextTokens);
    const messages: AiMessage[] = [
      {
        role: 'system',
        content: [
          request.settings.systemPrompt,
          'You are preparing a safe, half-automatic research task proposal for Lattice.',
          'Return JSON with: summary, steps[{title,description}], requiredApprovals[], plannedWrites[{targetPath,mode,contentPreview}].',
          'Do not assume autonomous execution. All writes require user approval.',
        ].join('\n\n'),
      },
      {
        role: 'user',
        content: `Task:\n${request.prompt}\n\nContext:\n${promptContext.prompt || '[no context]'}`,
      },
    ];

    const result = await selection.provider.generate(messages, {
      model: request.settings.model ?? undefined,
      temperature: 0.2,
      maxTokens: request.settings.maxTokens,
    });

    const parsed = safeJsonParse<{
      summary?: string;
      steps?: Array<{ title?: string; description?: string }>;
      requiredApprovals?: string[];
      plannedWrites?: Array<{ targetPath?: string; mode?: 'create' | 'append' | 'update'; contentPreview?: string }>;
    }>(result.text);

    const steps: AiTaskProposalStep[] = (parsed?.steps?.length
      ? parsed.steps
      : [{ title: 'Review context', description: 'Inspect the current evidence and decide the right write targets.' }]
    ).map((step, index) => ({
      id: `step-${index + 1}`,
      title: step.title || `Step ${index + 1}`,
      description: step.description || 'Review and confirm this step before execution.',
    }));
    const plannedWrites = buildLatticeProposalPlannedWrites({
      requestedWrites: parsed?.plannedWrites,
      prompt: request.prompt,
      summary: parsed?.summary || request.prompt,
      steps,
      evidenceRefs: promptContext.evidenceRefs,
      filePath: request.filePath,
    });

    return {
      id: `proposal-${Date.now()}`,
      summary: parsed?.summary || request.prompt,
      steps,
      sourceRefs: promptContext.evidenceRefs,
      requiredApprovals: parsed?.requiredApprovals?.length
        ? parsed.requiredApprovals
        : ['Confirm any file creation or updates before execution'],
      plannedWrites,
      status: 'pending',
      confirmedApprovals: [],
      approvedWrites: getApprovedPlannedWriteTargets(plannedWrites),
      generatedDraftTargets: [],
      createdAt: Date.now(),
    };
  }
}

export const aiOrchestrator = new AiOrchestrator();
