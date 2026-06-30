import type { Locale } from "@/types/settings";
import type { SelectionAiMode, SelectionAiOrigin } from "./types";
import type { SelectionContext } from "./selection-context";
import { summarizeSelectionPreview } from "./selection-context";

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
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length >= 3 && /[\p{L}\p{N}]/u.test(normalized);
}

export function buildSelectionOrigin(context: SelectionContext, mode: SelectionAiMode): SelectionAiOrigin {
  return {
    kind: "selection-ai",
    mode,
    sourceKind: context.sourceKind,
    sourceLabel: context.sourceLabel,
    selectionPreview: summarizeSelectionPreview(context.selectedText, 120),
  };
}

const EN_SELECTION_MODE_META: Record<SelectionAiMode, SelectionModeMeta> = {
  chat: {
    mode: "chat",
    label: "Quick answer",
    shortLabel: "Chat",
    description: "Ask about the current selection and get a concise answer with explicit evidence.",
    executionTarget: "Result goes to AI Chat with the selection kept as evidence.",
    submitLabel: "Send to quick answer",
    runningLabel: "Sending...",
    badgeLabel: "Quick answer",
    templates: [
      {
        id: "chat-explain",
        label: "Explain this selection",
        prompt: (context) => `Explain the core meaning of the selected content from "${context.sourceLabel}" clearly and concisely.`,
      },
      {
        id: "chat-key-points",
        label: "Extract key points",
        prompt: (context) => `Extract three key points from the selected content in "${context.sourceLabel}" and state the evidence for each point.`,
      },
      {
        id: "chat-question",
        label: "Answer a question",
        prompt: (context) => `Answer the most important question to clarify about the selected content in "${context.sourceLabel}".`,
      },
    ],
  },
  agent: {
    mode: "agent",
    label: "Deep analysis",
    shortLabel: "Agent",
    description: "Analyze the selection as a research assistant, emphasizing conclusions, evidence, and next actions.",
    executionTarget: "Result goes to AI Chat and can be inspected through the Evidence Panel.",
    submitLabel: "Start deep analysis",
    runningLabel: "Analyzing...",
    badgeLabel: "Deep analysis",
    templates: [
      {
        id: "agent-risks",
        label: "Find risks and gaps",
        prompt: (context) => `Analyze key risks, evidence gaps, and points that need further validation in the selected content from "${context.sourceLabel}".`,
      },
      {
        id: "agent-structure",
        label: "Structure as conclusion/evidence/actions",
        prompt: (context) => `Break down the selected content from "${context.sourceLabel}" into Conclusion / Evidence / Next Actions and identify the strongest evidence chain.`,
      },
      {
        id: "agent-compare",
        label: "Compare and judge",
        prompt: (context) => `Based on the selected content from "${context.sourceLabel}", state what it supports, what it does not support, and what to do next.`,
      },
    ],
  },
  plan: {
    mode: "plan",
    label: "Plan generation",
    shortLabel: "Plan",
    description: "Turn the current selection into a reviewable plan for drafts and follow-up work.",
    executionTarget: "Result goes to an AI Workbench proposal with target-draft actions.",
    submitLabel: "Generate plan",
    runningLabel: "Generating plan...",
    badgeLabel: "Plan generation",
    templates: [
      {
        id: "plan-note",
        label: "Organize into research note",
        prompt: (context) => `Generate a plan to turn the selected content from "${context.sourceLabel}" into a structured research note.`,
      },
      {
        id: "plan-drafts",
        label: "Generate target draft set",
        prompt: (context) => `Plan a target draft set from the selected content in "${context.sourceLabel}", including target paths and write strategy.`,
      },
      {
        id: "plan-checklist",
        label: "Create execution checklist",
        prompt: (context) => `Convert the selected content from "${context.sourceLabel}" into an execution plan with approvals, targets, and order of operations.`,
      },
    ],
  },
};

const ZH_SELECTION_MODE_META: Record<SelectionAiMode, SelectionModeMeta> = {
  chat: {
    mode: "chat",
    label: "快速问答",
    shortLabel: "问答",
    description: "围绕当前选区快速提问，得到简洁回答并保留证据来源。",
    executionTarget: "结果进入 AI 聊天，并保留当前选区作为证据。",
    submitLabel: "发送到快速问答",
    runningLabel: "发送中...",
    badgeLabel: "快速问答",
    templates: [
      {
        id: "chat-explain",
        label: "解释选区",
        prompt: (context) => `请清晰简洁地解释来自“${context.sourceLabel}”的选区核心含义。`,
      },
      {
        id: "chat-key-points",
        label: "提取要点",
        prompt: (context) => `请从“${context.sourceLabel}”的选区中提取三个关键点，并说明每一点的证据。`,
      },
      {
        id: "chat-question",
        label: "回答关键问题",
        prompt: (context) => `请回答一个最能澄清“${context.sourceLabel}”选区内容的关键问题。`,
      },
    ],
  },
  agent: {
    mode: "agent",
    label: "深度分析",
    shortLabel: "分析",
    description: "像研究助理一样分析选区，强调结论、证据链和下一步动作。",
    executionTarget: "结果进入 AI 聊天，并可通过证据面板检查引用来源。",
    submitLabel: "开始深度分析",
    runningLabel: "分析中...",
    badgeLabel: "深度分析",
    templates: [
      {
        id: "agent-risks",
        label: "查找风险与缺口",
        prompt: (context) => `请分析来自“${context.sourceLabel}”选区中的关键风险、证据缺口和需要进一步验证的点。`,
      },
      {
        id: "agent-structure",
        label: "整理为结论/证据/行动",
        prompt: (context) => `请把来自“${context.sourceLabel}”的选区拆解为 Conclusion / Evidence / Next Actions，并指出最强证据链。`,
      },
      {
        id: "agent-compare",
        label: "比较与判断",
        prompt: (context) => `请基于“${context.sourceLabel}”的选区说明它支持什么、不支持什么，以及下一步应做什么。`,
      },
    ],
  },
  plan: {
    mode: "plan",
    label: "计划生成",
    shortLabel: "计划",
    description: "把当前选区转成可审查、可执行的草稿与后续工作计划。",
    executionTarget: "结果进入 AI 工作台计划，并生成可审查的目标草稿动作。",
    submitLabel: "生成计划",
    runningLabel: "生成中...",
    badgeLabel: "计划生成",
    templates: [
      {
        id: "plan-note",
        label: "整理为研究笔记",
        prompt: (context) => `请生成计划，把来自“${context.sourceLabel}”的选区整理为结构化研究笔记。`,
      },
      {
        id: "plan-drafts",
        label: "生成目标草稿集",
        prompt: (context) => `请基于“${context.sourceLabel}”的选区规划目标草稿集，包括目标路径和写入策略。`,
      },
      {
        id: "plan-checklist",
        label: "创建执行清单",
        prompt: (context) => `请把来自“${context.sourceLabel}”的选区转换为包含审批、目标和执行顺序的计划。`,
      },
    ],
  },
};

const SELECTION_MODE_META_BY_LOCALE: Record<Locale, Record<SelectionAiMode, SelectionModeMeta>> = {
  "en-US": EN_SELECTION_MODE_META,
  "zh-CN": ZH_SELECTION_MODE_META,
};

export const SELECTION_MODE_META = EN_SELECTION_MODE_META;

export function getSelectionModeMeta(mode: SelectionAiMode, locale: Locale = "en-US"): SelectionModeMeta {
  return SELECTION_MODE_META_BY_LOCALE[locale]?.[mode] ?? EN_SELECTION_MODE_META[mode];
}
