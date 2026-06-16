import { listAgentToolDescriptors, type AgentToolName } from './agent-tool-broker';
import type { AgentContextBudgetProfileId } from './agent-context-budget-profiles';
import {
  listLatticeSkillCapabilities,
  listLatticeSkillsForWorkflow,
  type LatticeSkillDescriptor,
} from './lattice-skills/skill-registry';
import {
  formatLatticeOperationContractHint,
  listLatticeOperationCapabilities,
  listLatticeOperationContracts,
  type LatticeOperationContract,
} from './lattice-skills/operation-contract';
import type { AgentToolCapability } from './agent-policy';

export type ResearchAgentWorkflowId =
  | 'markdown-research'
  | 'reading-note'
  | 'notebook-analysis'
  | 'literature-matrix'
  | 'knowledge-organization'
  | 'teaching-explain'
  | 'paper-reading'
  | 'pdf-annotation'
  | 'notebook-from-paper';

export type NoteTakingLanguage = 'zh-CN' | 'en-US';
export type NoteTakingStyle = 'academic' | 'concise' | 'zotero-like' | 'cornell' | 'custom';
export type NoteFileNamingPolicy = 'title' | 'date-title' | 'pdf-title' | 'custom';
export type NoteQuotePolicy = 'short-quotes-only' | 'paraphrase-first' | 'evidence-table';
export type NoteAnnotationPolicy = 'none' | 'key-claims' | 'methods-results' | 'questions';
export type NoteNotebookPolicy = 'none' | 'experiments' | 'data-extraction';
export type NoteApprovalMode = 'draft-first' | 'ask-before-write' | 'auto-draft-only';

export interface NoteTakingSkillConfig {
  language: NoteTakingLanguage;
  noteStyle: NoteTakingStyle;
  template: string;
  fileNaming: NoteFileNamingPolicy;
  sections: string[];
  quotePolicy: NoteQuotePolicy;
  annotationPolicy: NoteAnnotationPolicy;
  notebookPolicy: NoteNotebookPolicy;
  approvalMode: NoteApprovalMode;
}

export type ResearchAgentOutputArtifactPolicy =
  | 'answer-only'
  | 'draft-optional'
  | 'proposal-optional'
  | 'draft-and-proposal-optional'
  | 'notebook-plan';

export interface ResearchAgentContextProfile {
  includeCurrentFileContent: boolean;
  includeSelection: boolean;
  includeAnnotations: boolean;
  includeWorkspaceSummary: boolean;
  memoryScopes: Array<'workspace' | 'project' | 'conversation' | 'user'>;
  maxContextTokens: number;
  contextBudgetProfileId: AgentContextBudgetProfileId;
}

export interface ResearchAgentWorkflowApprovalPolicy {
  createDraft: 'auto' | 'ask' | 'deny';
  createProposal: 'auto' | 'ask' | 'deny';
  runCode: 'auto' | 'ask' | 'deny';
  memoryWrite: 'auto' | 'ask' | 'deny';
}

export interface ResearchAgentWorkflowPreset {
  id: ResearchAgentWorkflowId;
  title: string;
  description: string;
  promptPreset: string;
  plannerHints: string[];
  contextProfile: ResearchAgentContextProfile;
  allowedTools: AgentToolName[];
  outputArtifactPolicy: ResearchAgentOutputArtifactPolicy;
  approvalPolicy: ResearchAgentWorkflowApprovalPolicy;
  traceLabels: {
    run: string;
    plan: string;
    result: string;
  };
  defaultNoteConfig?: Partial<NoteTakingSkillConfig>;
  pdfScoped?: boolean;
}

export interface ResearchAgentWorkflowExecutionProfile {
  workflowId: ResearchAgentWorkflowId;
  workflowTitle: string;
  noteConfig: NoteTakingSkillConfig;
  latticeSkills: LatticeSkillDescriptor[];
  currentThreadSkills: LatticeSkillDescriptor[];
  reservedPdfSkills: LatticeSkillDescriptor[];
  readOnlySkills: LatticeSkillDescriptor[];
  approvalGatedSkills: LatticeSkillDescriptor[];
  workspaceWriteSkills: LatticeSkillDescriptor[];
  operationContracts: LatticeOperationContract[];
  requiredCapabilities: AgentToolCapability[];
  plannerHints: string[];
}

export const DEFAULT_NOTE_TAKING_SKILL_CONFIG: NoteTakingSkillConfig = {
  language: 'zh-CN',
  noteStyle: 'academic',
  template: [
    '# {{title}}',
    '',
    '## One-sentence takeaway',
    '',
    '## Key claims',
    '',
    '## Evidence',
    '',
    '## Methods / Setup',
    '',
    '## Results',
    '',
    '## Open questions',
    '',
    '## Links',
    '- Source: {{sourceLink}}',
  ].join('\n'),
  fileNaming: 'title',
  sections: [
    'One-sentence takeaway',
    'Key claims',
    'Evidence',
    'Methods / Setup',
    'Results',
    'Open questions',
    'Links',
  ],
  quotePolicy: 'paraphrase-first',
  annotationPolicy: 'key-claims',
  notebookPolicy: 'none',
  approvalMode: 'draft-first',
};

const BASE_RESEARCH_CONTEXT: ResearchAgentContextProfile = {
  includeCurrentFileContent: true,
  includeSelection: true,
  includeAnnotations: true,
  includeWorkspaceSummary: true,
  memoryScopes: ['workspace', 'project', 'conversation', 'user'],
  maxContextTokens: 24000,
  contextBudgetProfileId: 'research',
};

const READ_TOOLS: AgentToolName[] = [
  'workspace.search',
  'workspace.readIndexedContext',
  'lattice.resolvePathIdentity',
  'evidence.resolve',
];

const ASK_WRITE_APPROVAL: ResearchAgentWorkflowApprovalPolicy = {
  createDraft: 'ask',
  createProposal: 'ask',
  runCode: 'ask',
  memoryWrite: 'ask',
};

export const RESEARCH_AGENT_WORKFLOW_PRESETS: ResearchAgentWorkflowPreset[] = [
  {
    id: 'markdown-research',
    title: 'Markdown Research',
    description: 'Inspect notes and workspace context, then produce an evidence-backed research answer.',
    promptPreset: 'Use the selected markdown or active note as the anchor. Extract claims, resolve supporting evidence, and synthesize a concise research answer.',
    plannerHints: [
      'Prefer workspace.search before synthesis when the task asks about related notes.',
      'Use evidence.resolve for final citations.',
      'Do not create drafts unless explicitly requested.',
    ],
    contextProfile: BASE_RESEARCH_CONTEXT,
    allowedTools: READ_TOOLS,
    outputArtifactPolicy: 'draft-optional',
    approvalPolicy: ASK_WRITE_APPROVAL,
    traceLabels: {
      run: 'Markdown research',
      plan: 'Plan markdown evidence workflow',
      result: 'Evidence-backed markdown answer',
    },
  },
  {
    id: 'reading-note',
    title: 'Reading Note',
    description: 'Turn evidence into a structured reading note draft for review.',
    promptPreset: 'Create a structured reading note from the current source. Prioritize claims, methods, results, evidence, and open questions.',
    plannerHints: [
      'Resolve evidence before drafting.',
      'Use the configured note template and quote policy.',
      'Create drafts only through approval-gated Workbench tools.',
    ],
    contextProfile: BASE_RESEARCH_CONTEXT,
    allowedTools: [...READ_TOOLS, 'workbench.createDraft'],
    outputArtifactPolicy: 'draft-optional',
    approvalPolicy: ASK_WRITE_APPROVAL,
    traceLabels: {
      run: 'Reading note',
      plan: 'Plan reading note workflow',
      result: 'Reviewable reading note draft',
    },
    defaultNoteConfig: {
      noteStyle: 'academic',
      quotePolicy: 'evidence-table',
      annotationPolicy: 'key-claims',
    },
  },
  {
    id: 'notebook-analysis',
    title: 'Notebook Analysis',
    description: 'Inspect notebook context and explain results or propose next experiments.',
    promptPreset: 'Analyze notebook cells, outputs, and nearby notes. Explain results, assumptions, and practical next experiments.',
    plannerHints: [
      'Read indexed notebook context before synthesis.',
      'Runner/code execution remains approval-gated.',
      'Prefer proposed next steps over silent execution.',
    ],
    contextProfile: {
      ...BASE_RESEARCH_CONTEXT,
      maxContextTokens: 28000,
      contextBudgetProfileId: 'notebook',
    },
    allowedTools: [...READ_TOOLS, 'runner.runCode', 'workbench.createProposal'],
    outputArtifactPolicy: 'notebook-plan',
    approvalPolicy: ASK_WRITE_APPROVAL,
    traceLabels: {
      run: 'Notebook analysis',
      plan: 'Plan notebook analysis',
      result: 'Notebook interpretation and next experiment plan',
    },
    defaultNoteConfig: {
      notebookPolicy: 'experiments',
      sections: ['Question', 'Setup', 'Observed results', 'Interpretation', 'Next experiment', 'Risks'],
    },
  },
  {
    id: 'literature-matrix',
    title: 'Literature Matrix',
    description: 'Compare multiple sources and produce a structured evidence matrix.',
    promptPreset: 'Compare the selected sources by claims, methods, evidence strength, limitations, and open questions.',
    plannerHints: [
      'Search workspace for related source notes.',
      'Represent comparison results as a matrix when useful.',
      'Keep each claim tied to evidence refs.',
    ],
    contextProfile: {
      ...BASE_RESEARCH_CONTEXT,
      maxContextTokens: 32000,
      contextBudgetProfileId: 'knowledge-organization',
    },
    allowedTools: [...READ_TOOLS, 'workbench.createDraft'],
    outputArtifactPolicy: 'draft-optional',
    approvalPolicy: ASK_WRITE_APPROVAL,
    traceLabels: {
      run: 'Literature matrix',
      plan: 'Plan comparison matrix',
      result: 'Evidence-backed literature matrix',
    },
    defaultNoteConfig: {
      noteStyle: 'concise',
      quotePolicy: 'evidence-table',
      sections: ['Sources', 'Claims', 'Methods', 'Evidence', 'Limitations', 'Open questions'],
    },
  },
  {
    id: 'knowledge-organization',
    title: 'Knowledge Organization',
    description: 'Organize notes into links, summaries, draft structure, or proposal tasks.',
    promptPreset: 'Organize the current workspace knowledge. Identify clusters, missing links, duplicate ideas, and reviewable organization actions.',
    plannerHints: [
      'Use workspace.search and indexed context for related notes.',
      'Prefer proposals over direct writes.',
      'Do not mutate note links without approval.',
    ],
    contextProfile: {
      ...BASE_RESEARCH_CONTEXT,
      contextBudgetProfileId: 'knowledge-organization',
    },
    allowedTools: [...READ_TOOLS, 'workbench.createProposal'],
    outputArtifactPolicy: 'proposal-optional',
    approvalPolicy: ASK_WRITE_APPROVAL,
    traceLabels: {
      run: 'Knowledge organization',
      plan: 'Plan knowledge organization',
      result: 'Organization proposal',
    },
  },
  {
    id: 'teaching-explain',
    title: 'Teaching Explain',
    description: 'Explain a selected concept with examples, checks for understanding, and citations.',
    promptPreset: 'Explain the selected concept clearly. Include examples, common misconceptions, and a short quiz when useful.',
    plannerHints: [
      'Use evidence.resolve for citations.',
      'Prefer clear explanation over exhaustive context.',
      'Do not create artifacts unless requested.',
    ],
    contextProfile: {
      ...BASE_RESEARCH_CONTEXT,
      includeWorkspaceSummary: false,
      memoryScopes: ['conversation', 'user'],
      maxContextTokens: 12000,
      contextBudgetProfileId: 'chat',
    },
    allowedTools: ['evidence.resolve'],
    outputArtifactPolicy: 'answer-only',
    approvalPolicy: {
      createDraft: 'deny',
      createProposal: 'deny',
      runCode: 'deny',
      memoryWrite: 'ask',
    },
    traceLabels: {
      run: 'Teaching explanation',
      plan: 'Plan teaching explanation',
      result: 'Evidence-backed teaching answer',
    },
    defaultNoteConfig: {
      noteStyle: 'concise',
      sections: ['Concept', 'Explanation', 'Example', 'Misconceptions', 'Quiz', 'Evidence'],
    },
  },
  {
    id: 'paper-reading',
    title: 'Paper Reading',
    description: 'PDF-scoped paper reading workflow for notes plus approval-gated exact-quote annotation drafts.',
    promptPreset: 'Read a paper, extract claims, methods, results, open questions, and produce a reading note.',
    plannerHints: [
      'Use PDF item workspaces for notes and child documents; preserve existing _annotations.md draft blocks.',
      'For AI highlights/underlines, propose lattice-pdf-annotation exact-quote drafts in _annotations.md and let the PDF reader resolve coordinates.',
      'Never fabricate PDF highlight coordinates or quads.',
    ],
    contextProfile: BASE_RESEARCH_CONTEXT,
    allowedTools: READ_TOOLS,
    outputArtifactPolicy: 'draft-optional',
    approvalPolicy: ASK_WRITE_APPROVAL,
    traceLabels: {
      run: 'Paper reading',
      plan: 'Plan paper reading',
      result: 'Paper reading note',
    },
    defaultNoteConfig: {
      fileNaming: 'pdf-title',
      quotePolicy: 'evidence-table',
      annotationPolicy: 'methods-results',
    },
    pdfScoped: true,
  },
  {
    id: 'pdf-annotation',
    title: 'PDF Annotation',
    description: 'PDF-scoped annotation workflow using approval-gated exact-quote drafts resolved by the PDF reader.',
    promptPreset: 'Plan PDF annotations from reading goals, exact quotes, and evidence-backed page references.',
    plannerHints: [
      'Use Tool Broker and approval before proposing writes to PDF item _annotations.md.',
      'Write exact Quote text, page, type, color, optional comment, and tags only; never write coordinates.',
      'Lattice resolves approved drafts through the PDF text model into sidecar rects/quads when the PDF opens.',
    ],
    contextProfile: BASE_RESEARCH_CONTEXT,
    allowedTools: READ_TOOLS,
    outputArtifactPolicy: 'proposal-optional',
    approvalPolicy: ASK_WRITE_APPROVAL,
    traceLabels: {
      run: 'PDF annotation',
      plan: 'Plan PDF annotations',
      result: 'PDF annotation proposal',
    },
    defaultNoteConfig: {
      annotationPolicy: 'key-claims',
    },
    pdfScoped: true,
  },
  {
    id: 'notebook-from-paper',
    title: 'Notebook From Paper',
    description: 'PDF-scoped workflow for creating experiment notebooks from papers; implementation belongs to the PDF/notebook bridge phase.',
    promptPreset: 'Extract reproducible methods and propose notebook cells for experiments.',
    plannerHints: [
      'Paper extraction requires PDF-window tooling.',
      'Notebook creation must be approval-gated.',
    ],
    contextProfile: {
      ...BASE_RESEARCH_CONTEXT,
      maxContextTokens: 32000,
      contextBudgetProfileId: 'notebook',
    },
    allowedTools: [...READ_TOOLS, 'workbench.createProposal'],
    outputArtifactPolicy: 'notebook-plan',
    approvalPolicy: ASK_WRITE_APPROVAL,
    traceLabels: {
      run: 'Notebook from paper',
      plan: 'Plan notebook from paper',
      result: 'Notebook experiment plan',
    },
    defaultNoteConfig: {
      notebookPolicy: 'experiments',
      fileNaming: 'pdf-title',
    },
    pdfScoped: true,
  },
];

const WORKFLOW_BY_ID = new Map(RESEARCH_AGENT_WORKFLOW_PRESETS.map((workflow) => [workflow.id, workflow]));

function mergeUnique<T>(left: T[], right: T[] | undefined): T[] {
  return [...new Set([...left, ...(right ?? [])])];
}

export function listResearchAgentWorkflows(options: {
  includePdfScoped?: boolean;
} = {}): ResearchAgentWorkflowPreset[] {
  return RESEARCH_AGENT_WORKFLOW_PRESETS.filter((workflow) =>
    options.includePdfScoped || !workflow.pdfScoped,
  );
}

export function getResearchAgentWorkflow(
  id: ResearchAgentWorkflowId,
): ResearchAgentWorkflowPreset {
  const workflow = WORKFLOW_BY_ID.get(id);
  if (!workflow) {
    throw new Error(`Unknown Research Agent workflow: ${id}`);
  }
  return workflow;
}

export interface InferResearchAgentWorkflowInput {
  task?: string;
  query?: string;
  filePath?: string;
  content?: string;
  selection?: string;
}

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function inferResearchAgentWorkflow(input: InferResearchAgentWorkflowInput): ResearchAgentWorkflowId {
  const filePath = input.filePath?.toLowerCase() ?? '';
  const text = [
    input.task,
    input.query,
    input.selection,
    input.content?.slice(0, 2000),
    filePath,
  ].filter(Boolean).join('\n').toLowerCase();

  if (
    filePath.endsWith('.ipynb') ||
    containsAny(text, [
      /\bnotebook\b/,
      /\bcell\b/,
      /\boutput\b/,
      /\bexperiment\b/,
      /\bplot\b/,
      /笔记本/,
      /代码单元/,
      /单元格/,
      /输出/,
      /实验输出/,
      /实验结果/,
      /实验数据/,
      /运行实验/,
      /结果图/,
      /图表/,
      /绘图/,
    ])
  ) {
    return 'notebook-analysis';
  }

  if (containsAny(text, [
    /\bmatrix\b/,
    /\bcompare\b/,
    /\bcomparison\b/,
    /\bliterature\b/,
    /\btable\b/,
    /文献矩阵/,
    /文献综述/,
    /文献对比/,
    /论文对比/,
    /对比/,
    /比较/,
    /表格/,
  ])) {
    return 'literature-matrix';
  }

  if (containsAny(text, [
    /\borganize\b/,
    /\bcluster\b/,
    /\blink\b/,
    /\bstructure\b/,
    /\btaxonomy\b/,
    /整理/,
    /组织/,
    /链接/,
    /关联/,
    /聚类/,
    /结构/,
    /知识库/,
    /知识组织/,
  ])) {
    return 'knowledge-organization';
  }

  if (containsAny(text, [
    /\bteach\b/,
    /\bexplain\b/,
    /\bquiz\b/,
    /\bexample\b/,
    /\bmisconception\b/,
    /教学/,
    /解释/,
    /讲解/,
    /例子/,
    /示例/,
    /测验/,
    /误区/,
    /通俗/,
  ])) {
    return 'teaching-explain';
  }

  if (containsAny(text, [
    /\breading note\b/,
    /\bnote draft\b/,
    /\bdraft note\b/,
    /\bannotat/,
    /阅读笔记/,
    /读书笔记/,
    /笔记草稿/,
    /批注/,
    /摘录/,
    /要点笔记/,
  ])) {
    return 'reading-note';
  }

  return 'markdown-research';
}

export function resolveNoteTakingSkillConfig(
  workflow?: ResearchAgentWorkflowPreset | null,
  overrides: Partial<NoteTakingSkillConfig> = {},
): NoteTakingSkillConfig {
  const workflowConfig = workflow?.defaultNoteConfig ?? {};
  return {
    ...DEFAULT_NOTE_TAKING_SKILL_CONFIG,
    ...workflowConfig,
    ...overrides,
    sections: mergeUnique(
      DEFAULT_NOTE_TAKING_SKILL_CONFIG.sections,
      workflowConfig.sections,
    ),
    ...(overrides.sections ? { sections: overrides.sections } : {}),
  };
}

function formatSkill(skill: LatticeSkillDescriptor): string {
  return `${skill.title} [${skill.status}/${skill.approvalMode}]`;
}

function formatSkillList(skills: LatticeSkillDescriptor[], fallback: string): string {
  return skills.length > 0 ? skills.map(formatSkill).join(', ') : fallback;
}

function formatToolList(tools: AgentToolName[]): string {
  return tools.length > 0 ? [...new Set(tools)].join(', ') : 'none';
}

export function buildResearchAgentWorkflowExecutionProfile(
  workflow: ResearchAgentWorkflowPreset,
  noteConfig: NoteTakingSkillConfig = resolveNoteTakingSkillConfig(workflow),
): ResearchAgentWorkflowExecutionProfile {
  const latticeSkills = listLatticeSkillsForWorkflow(workflow.id, { includePdfScoped: true });
  const currentThreadSkills = latticeSkills.filter((skill) => skill.owner === 'ai-agent-thread');
  const reservedPdfSkills = latticeSkills.filter((skill) => (
    skill.pdfScoped &&
    (skill.owner === 'pdf-thread' || skill.approvalMode === 'reserved')
  ));
  const readOnlySkills = currentThreadSkills.filter((skill) => skill.approvalMode === 'read-only');
  const approvalGatedSkills = currentThreadSkills.filter((skill) => skill.approvalMode === 'approval-gated');
  const workspaceWriteSkills = currentThreadSkills.filter((skill) => skill.writesWorkspace);
  const skillTools = currentThreadSkills.flatMap((skill) => skill.allowedTools);
  const operationContracts = listLatticeOperationContracts(
    latticeSkills.flatMap((skill) => skill.operationContractIds),
  );
  const requiredCapabilities = [
    ...listLatticeSkillCapabilities(currentThreadSkills),
    ...listLatticeOperationCapabilities(operationContracts.filter((contract) => contract.owner === 'ai-agent-thread')),
  ].filter((capability, index, all) => all.indexOf(capability) === index);
  const writeHint = workspaceWriteSkills.length > 0
    ? `Lattice workspace writes: approval-gated via ${formatSkillList(workspaceWriteSkills, 'none')}.`
    : 'Lattice workspace writes: none in the current workflow unless the user explicitly requests an approved Workbench artifact.';

  return {
    workflowId: workflow.id,
    workflowTitle: workflow.title,
    noteConfig,
    latticeSkills,
    currentThreadSkills,
    reservedPdfSkills,
    readOnlySkills,
    approvalGatedSkills,
    workspaceWriteSkills,
    operationContracts,
    requiredCapabilities,
    plannerHints: [
      `Lattice workflow profile: ${workflow.title} uses ${currentThreadSkills.length} current-thread skill${currentThreadSkills.length === 1 ? '' : 's'} and ${reservedPdfSkills.length} PDF-reserved skill${reservedPdfSkills.length === 1 ? '' : 's'}.`,
      `Current-thread Lattice skills: ${formatSkillList(currentThreadSkills, 'none')}.`,
      `Read-only Lattice skills: ${formatSkillList(readOnlySkills, 'none')}.`,
      `Approval-gated Lattice skills: ${formatSkillList(approvalGatedSkills, 'none')}.`,
      `Required Lattice capabilities: ${requiredCapabilities.join(', ') || 'none'}.`,
      reservedPdfSkills.length > 0
        ? `PDF-reserved Lattice skills: ${formatSkillList(reservedPdfSkills, 'none')}. Do not fabricate PDF coordinates; use exact-quote drafts for AI-assisted text markup.`
        : null,
      `Lattice skill tools available through this profile: ${formatToolList(skillTools)}.`,
      writeHint,
      `Note-taking contract: language=${noteConfig.language}, style=${noteConfig.noteStyle}, naming=${noteConfig.fileNaming}, approval=${noteConfig.approvalMode}.`,
      ...operationContracts.map(formatLatticeOperationContractHint),
    ].filter((hint): hint is string => Boolean(hint)),
  };
}

export function buildResearchAgentWorkflowPlannerHints(
  workflow: ResearchAgentWorkflowPreset,
  noteConfig: NoteTakingSkillConfig = resolveNoteTakingSkillConfig(workflow),
): string {
  const executionProfile = buildResearchAgentWorkflowExecutionProfile(workflow, noteConfig);
  const toolSchemaSummary = listAgentToolDescriptors(workflow.allowedTools)
    .map((tool) => `${tool.name} ${tool.argsSummary} -> ${tool.resultSummary}`)
    .join('; ');
  return [
    `Workflow: ${workflow.title} (${workflow.id})`,
    `Prompt preset: ${workflow.promptPreset}`,
    `Allowed tools: ${workflow.allowedTools.join(', ') || 'none'}`,
    toolSchemaSummary ? `Tool schemas: ${toolSchemaSummary}` : null,
    `Output artifact policy: ${workflow.outputArtifactPolicy}`,
    `Approval policy: draft=${workflow.approvalPolicy.createDraft}, proposal=${workflow.approvalPolicy.createProposal}, runCode=${workflow.approvalPolicy.runCode}, memory=${workflow.approvalPolicy.memoryWrite}`,
    `Note style: ${noteConfig.noteStyle}`,
    `Quote policy: ${noteConfig.quotePolicy}`,
    `Annotation policy: ${noteConfig.annotationPolicy}`,
    `Sections: ${noteConfig.sections.join(', ')}`,
    ...executionProfile.plannerHints,
    ...workflow.plannerHints.map((hint) => `Hint: ${hint}`),
  ].join('\n');
}
