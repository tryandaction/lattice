import { aiContextGraph } from './context-graph';
import { routeModel } from './model-router';
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
} from './types';

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
): string {
  return [
    basePrompt,
    'You are Lattice AI, an evidence-first research copilot for a scientific workbench.',
    'Answer for a personal researcher. Be concise, precise, and practical.',
    evidenceRequired
      ? 'Default to evidence-first reasoning. Ground your answer in the provided context and reference the most relevant evidence explicitly.'
      : 'Use the provided context carefully.',
    'Prefer structured output with three sections when appropriate: Conclusion, Evidence, Next Actions.',
    evidenceRefs.length > 0
      ? `Available evidence references:\n${evidenceRefs.map((ref) => `- ${ref.label} -> ${ref.locator}`).join('\n')}`
      : 'No explicit evidence references were provided.',
  ].join('\n\n');
}

function trimHistory(history: AiMessage[] | undefined): AiMessage[] {
  if (!history?.length) return [];
  return history.slice(-8);
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
  contextInput: Omit<AiChatRequest, 'prompt' | 'history' | 'settings'>,
): Promise<AiRunResult> {
  const selection = routeModel(taskType, settings);
  const promptContext = aiContextGraph.buildPromptContext(contextInput, selection.policy.maxContextTokens);

  const messages: AiMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(
        settings.systemPrompt,
        promptContext.evidenceRefs,
        selection.policy.evidenceRequired,
      ),
    },
    ...trimHistory(history),
    {
      role: 'user',
      content: [
        `User request:\n${prompt}`,
        'Use the supplied context. If evidence exists, cite it in the answer body.',
        `Context:\n${promptContext.prompt || '[no additional context]'}`,
      ].join('\n\n'),
    },
  ];

  const result = await selection.provider.generate(messages, {
    model: settings.model ?? undefined,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
  });

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
        query: request.query,
        explicitEvidenceRefs: request.explicitEvidenceRefs,
      },
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
    });
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
    });
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

    return {
      id: `proposal-${Date.now()}`,
      summary: parsed?.summary || request.prompt,
      steps,
      sourceRefs: promptContext.evidenceRefs,
      requiredApprovals: parsed?.requiredApprovals?.length
        ? parsed.requiredApprovals
        : ['Confirm any file creation or updates before execution'],
      plannedWrites: (parsed?.plannedWrites ?? []).flatMap((write) => {
        if (!write.targetPath || !write.mode) return [];
        return [{
          targetPath: write.targetPath,
          mode: write.mode,
          contentPreview: write.contentPreview || '',
        }];
      }),
      status: 'pending',
      confirmedApprovals: [],
      approvedWrites: (parsed?.plannedWrites ?? [])
        .flatMap((write) => (write.targetPath && write.mode ? [write.targetPath] : [])),
      generatedDraftTargets: [],
      createdAt: Date.now(),
    };
  }
}

export const aiOrchestrator = new AiOrchestrator();
