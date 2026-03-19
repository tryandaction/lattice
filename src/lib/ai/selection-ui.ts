import type { SelectionAiMode, SelectionAiOrigin } from './types';
import type { SelectionContext } from './selection-context';
import { summarizeSelectionPreview } from './selection-context';

export interface SelectionPromptTemplate {
  id: string;
  label: string;
  prompt: (context: SelectionContext) => string;
}

export interface SelectionModeMeta {
  mode: SelectionAiMode;
  label: string;
  shortLabel: string;
  description: string;
  executionTarget: string;
  submitLabel: string;
  runningLabel: string;
  badgeLabel: string;
  templates: SelectionPromptTemplate[];
}

export function isMeaningfulSelectionText(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length >= 3 && /[\p{L}\p{N}]/u.test(normalized);
}

export function buildSelectionOrigin(context: SelectionContext, mode: SelectionAiMode): SelectionAiOrigin {
  return {
    kind: 'selection-ai',
    mode,
    sourceKind: context.sourceKind,
    sourceLabel: context.sourceLabel,
    selectionPreview: summarizeSelectionPreview(context.selectedText, 120),
  };
}

export const SELECTION_MODE_META: Record<SelectionAiMode, SelectionModeMeta> = {
  chat: {
    mode: 'chat',
    label: '快速问答',
    shortLabel: 'Chat',
    description: '聚焦当前选区，快速得到明确答案和关键证据，不进入复杂工作流。',
    executionTarget: '结果进入 AI Chat，并保留显式选区证据。',
    submitLabel: '发送到快速问答',
    runningLabel: '正在发送到快速问答…',
    badgeLabel: '快速问答',
    templates: [
      {
        id: 'chat-explain',
        label: '解释这段内容',
        prompt: (context) => `请用简洁准确的语言解释“${context.sourceLabel}”这段内容的核心含义。`,
      },
      {
        id: 'chat-key-points',
        label: '提炼要点',
        prompt: (context) => `请提炼“${context.sourceLabel}”这段内容的 3 个关键信息点，并说明每点依据。`,
      },
      {
        id: 'chat-question',
        label: '回答一个问题',
        prompt: (context) => `请回答我关于“${context.sourceLabel}”这段内容最值得先确认的问题。`,
      },
    ],
  },
  agent: {
    mode: 'agent',
    label: '深度分析',
    shortLabel: 'Agent',
    description: '以研究助理方式做更深入拆解，强调结论、证据和下一步动作。',
    executionTarget: '结果进入 AI Chat，并自动接入 Evidence Panel。',
    submitLabel: '启动深度分析',
    runningLabel: '正在执行深度分析…',
    badgeLabel: '深度分析',
    templates: [
      {
        id: 'agent-risks',
        label: '找出风险与缺口',
        prompt: (context) => `请深入分析“${context.sourceLabel}”这段内容的关键风险、证据缺口和需要进一步验证的点。`,
      },
      {
        id: 'agent-structure',
        label: '结构化拆解',
        prompt: (context) => `请把“${context.sourceLabel}”这段内容拆成 Conclusion / Evidence / Next Actions，并指出最重要的证据链。`,
      },
      {
        id: 'agent-compare',
        label: '对比与判断',
        prompt: (context) => `请基于“${context.sourceLabel}”这段内容进行深入判断，说明它支持什么、不支持什么，以及下一步该怎么做。`,
      },
    ],
  },
  plan: {
    mode: 'plan',
    label: '计划生成',
    shortLabel: 'Plan',
    description: '直接把当前选区转成可审阅计划，面向草稿集和后续写回。',
    executionTarget: '结果进入 AI Workbench Proposal，并优先展开目标草稿动作。',
    submitLabel: '生成整理计划',
    runningLabel: '正在生成整理计划…',
    badgeLabel: '计划生成',
    templates: [
      {
        id: 'plan-note',
        label: '整理成研究笔记',
        prompt: (context) => `请基于“${context.sourceLabel}”这段内容生成整理计划，目标是沉淀成结构化研究笔记。`,
      },
      {
        id: 'plan-drafts',
        label: '生成目标草稿集',
        prompt: (context) => `请基于“${context.sourceLabel}”这段内容规划目标草稿集，明确每份草稿的目标路径和写入策略。`,
      },
      {
        id: 'plan-checklist',
        label: '生成执行清单',
        prompt: (context) => `请把“${context.sourceLabel}”这段内容转成可执行计划，包含审批项、写入目标和执行顺序。`,
      },
    ],
  },
};

export function getSelectionModeMeta(mode: SelectionAiMode): SelectionModeMeta {
  return SELECTION_MODE_META[mode];
}
