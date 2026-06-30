import type { PromptTemplate } from "@/lib/prompt/types";
import type { Locale } from "@/types/settings";

const NOW = 1_710_000_000_000;

interface BuiltinPromptLocaleCopy {
  title: string;
  description: string;
  systemPrompt?: string;
  userPrompt: string;
}

interface BuiltinPromptTemplateInput extends Omit<PromptTemplate, "title" | "description" | "systemPrompt" | "userPrompt" | "builtin" | "version" | "createdAt" | "updatedAt"> {
  localized: Record<Locale, BuiltinPromptLocaleCopy>;
}

function copyForLocale(copy: Record<Locale, BuiltinPromptLocaleCopy>, locale: Locale): BuiltinPromptLocaleCopy {
  const localized = copy[locale] ?? copy["en-US"];
  if (!localized) {
    throw new Error(`Missing builtin prompt localization for ${locale}`);
  }
  return localized;
}

function createBuiltinTemplate(template: BuiltinPromptTemplateInput): PromptTemplate {
  const fallback = copyForLocale(template.localized, "en-US");
  return {
    ...template,
    title: fallback.title,
    description: fallback.description,
    systemPrompt: fallback.systemPrompt,
    userPrompt: fallback.userPrompt,
    builtin: true,
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function lines(parts: string[]): string {
  return parts.join("\n");
}

export function localizePromptTemplate(template: PromptTemplate, locale: Locale): PromptTemplate {
  if (!template.builtin || !template.localized) {
    return template;
  }

  const localized = copyForLocale(template.localized as Record<Locale, BuiltinPromptLocaleCopy>, locale);
  return {
    ...template,
    title: localized.title,
    description: localized.description,
    systemPrompt: localized.systemPrompt,
    userPrompt: localized.userPrompt,
  };
}

export function localizePromptTemplates(templates: PromptTemplate[], locale: Locale): PromptTemplate[] {
  return templates.map((template) => localizePromptTemplate(template, locale));
}

export const BUILTIN_PROMPT_TEMPLATES: PromptTemplate[] = [
  createBuiltinTemplate({
    id: "builtin-paper-summary",
    localized: {
      "en-US": {
        title: "Paper Summary",
        description: "Summarize the current material into research goals, methods, results, and conclusions.",
        systemPrompt: "You are a scientific research copilot. Answer concisely and evidence-first.",
        userPrompt: lines([
          "Generate a paper summary from the following content.",
          "",
          "# Current File",
          "{{current_file}}",
          "",
          "# Current File Content",
          "{{current_file_content}}",
          "",
          "Output:",
          "1. Conclusion",
          "2. Evidence",
          "3. Next Actions",
        ]),
      },
      "zh-CN": {
        title: "论文摘要",
        description: "快速整理当前材料的研究目标、方法、结果和结论。",
        systemPrompt: "你是严谨的科研助手。回答要简洁、准确，并优先基于证据。",
        userPrompt: lines([
          "请基于以下内容生成论文摘要。",
          "",
          "# 当前文件",
          "{{current_file}}",
          "",
          "# 当前文件内容",
          "{{current_file_content}}",
          "",
          "输出要求：",
          "1. 结论",
          "2. 关键证据",
          "3. 下一步行动",
        ]),
      },
    },
    category: "reading",
    surfaces: ["chat", "selection", "evidence"],
    outputMode: "structured-chat",
    requiredContext: ["current_file_content"],
    optionalContext: ["current_file"],
    pinned: true,
    preferredProvider: null,
    preferredModel: null,
  }),
  createBuiltinTemplate({
    id: "builtin-method-breakdown",
    localized: {
      "en-US": {
        title: "Method Breakdown",
        description: "Break a method into inputs, steps, assumptions, and risks.",
        systemPrompt: "You are an evidence-first research analyst.",
        userPrompt: lines([
          "Break down the method design in the current research material.",
          "",
          "# Selected Text",
          "{{selected_text}}",
          "",
          "# Current File Content",
          "{{current_file_content}}",
          "",
          "Output:",
          "1. Method Outline",
          "2. Evidence",
          "3. Risks / Open Questions",
        ]),
      },
      "zh-CN": {
        title: "方法拆解",
        description: "把方法流程拆成输入、步骤、假设和风险。",
        systemPrompt: "你是证据优先的研究分析助手。",
        userPrompt: lines([
          "请拆解当前研究材料的方法设计。",
          "",
          "# 当前选区",
          "{{selected_text}}",
          "",
          "# 当前文件内容",
          "{{current_file_content}}",
          "",
          "输出要求：",
          "1. 方法流程",
          "2. 支撑证据",
          "3. 风险 / 开放问题",
        ]),
      },
    },
    category: "reading",
    surfaces: ["chat", "selection"],
    outputMode: "structured-chat",
    requiredContext: ["selected_text"],
    optionalContext: ["current_file_content"],
    preferredProvider: null,
    preferredModel: null,
  }),
  createBuiltinTemplate({
    id: "builtin-innovation-points",
    localized: {
      "en-US": {
        title: "Novelty Extraction",
        description: "Extract novelty, boundaries, and applicable conditions from the material.",
        systemPrompt: "You are a scientific research copilot. Surface novelty precisely and avoid hype.",
        userPrompt: lines([
          "Extract the novelty in the current material.",
          "",
          "# Current File Content",
          "{{current_file_content}}",
          "",
          "Output:",
          "1. Novelty",
          "2. Supporting Evidence",
          "3. Applicability / Limits",
        ]),
      },
      "zh-CN": {
        title: "创新点提炼",
        description: "提炼材料中的创新点、边界和适用条件。",
        systemPrompt: "你是科研助手。请准确提炼创新点，避免夸大。",
        userPrompt: lines([
          "请提炼当前材料的创新点。",
          "",
          "# 当前文件内容",
          "{{current_file_content}}",
          "",
          "输出要求：",
          "1. 创新点",
          "2. 支撑证据",
          "3. 适用条件 / 边界",
        ]),
      },
    },
    category: "reading",
    surfaces: ["chat", "selection"],
    outputMode: "structured-chat",
    requiredContext: ["current_file_content"],
    optionalContext: ["selected_text"],
    preferredProvider: null,
    preferredModel: null,
  }),
  createBuiltinTemplate({
    id: "builtin-annotation-reading-note",
    localized: {
      "en-US": {
        title: "Reading Note from Annotations",
        description: "Convert PDF annotations into a durable research reading note.",
        systemPrompt: "You are a scientific note organizer. Convert annotation evidence into durable notes.",
        userPrompt: lines([
          "Create a reading note from the current PDF annotations.",
          "",
          "# PDF Annotations",
          "{{pdf_annotations}}",
          "",
          "# Current File",
          "{{current_file}}",
          "",
          "Output:",
          "1. Reading Note",
          "2. Evidence",
          "3. Follow-up Questions",
        ]),
      },
      "zh-CN": {
        title: "基于批注生成阅读笔记",
        description: "把 PDF 批注整理成研究阅读笔记。",
        systemPrompt: "你是科研笔记整理助手。请把批注证据转成可长期复用的笔记。",
        userPrompt: lines([
          "请基于当前 PDF 批注整理阅读笔记。",
          "",
          "# PDF 批注",
          "{{pdf_annotations}}",
          "",
          "# 当前文件",
          "{{current_file}}",
          "",
          "输出要求：",
          "1. 阅读笔记",
          "2. 关键证据",
          "3. 后续问题",
        ]),
      },
    },
    category: "annotation",
    surfaces: ["chat", "selection", "evidence"],
    outputMode: "draft",
    requiredContext: ["pdf_annotations"],
    optionalContext: ["current_file"],
    preferredProvider: null,
    preferredModel: null,
  }),
  createBuiltinTemplate({
    id: "builtin-compress-summary",
    localized: {
      "en-US": {
        title: "Compress to Summary",
        description: "Compress current content into a shorter summary.",
        systemPrompt: "You are an academic writing assistant. Compress content without losing meaning.",
        userPrompt: lines([
          "Compress the following content into a concise summary.",
          "",
          "{{selected_text}}",
          "",
          "If no selection is available, use the current file content.",
          "{{current_file_content}}",
        ]),
      },
      "zh-CN": {
        title: "压缩成摘要",
        description: "将当前内容压缩为更短的摘要。",
        systemPrompt: "你是学术写作助手。请在不丢失含义的前提下压缩内容。",
        userPrompt: lines([
          "请将以下内容压缩为简洁摘要。",
          "",
          "{{selected_text}}",
          "",
          "如果当前没有选区，请使用当前文件内容。",
          "{{current_file_content}}",
        ]),
      },
    },
    category: "writing",
    surfaces: ["chat", "selection", "workbench"],
    outputMode: "chat",
    requiredContext: [],
    optionalContext: ["selected_text", "current_file_content"],
    preferredProvider: null,
    preferredModel: null,
  }),
  createBuiltinTemplate({
    id: "builtin-expand-section",
    localized: {
      "en-US": {
        title: "Expand into Section",
        description: "Expand a summary or outline into a structured section.",
        systemPrompt: "You are an academic writing assistant. Expand notes into coherent sections.",
        userPrompt: lines([
          "Expand the following content into a structured section.",
          "",
          "# Selected Text",
          "{{selected_text}}",
          "",
          "# Active Draft",
          "{{active_draft}}",
        ]),
      },
      "zh-CN": {
        title: "扩写成章节",
        description: "将摘要或提纲扩写成结构化章节。",
        systemPrompt: "你是学术写作助手。请把笔记扩展成结构清晰的章节。",
        userPrompt: lines([
          "请将以下内容扩写成结构化章节。",
          "",
          "# 当前选区",
          "{{selected_text}}",
          "",
          "# 当前草稿",
          "{{active_draft}}",
        ]),
      },
    },
    category: "writing",
    surfaces: ["chat", "selection", "workbench"],
    outputMode: "draft",
    requiredContext: [],
    optionalContext: ["selected_text", "active_draft"],
    preferredProvider: null,
    preferredModel: null,
  }),
  createBuiltinTemplate({
    id: "builtin-academic-tone",
    localized: {
      "en-US": {
        title: "Academic Tone Rewrite",
        description: "Rewrite existing content in a more restrained academic tone.",
        systemPrompt: "You are an academic writing editor. Preserve meaning, improve scholarly tone.",
        userPrompt: lines([
          "Rewrite the following content in a more formal academic tone.",
          "",
          "{{selected_text}}",
          "",
          "{{current_file_content}}",
        ]),
      },
      "zh-CN": {
        title: "转为学术语气",
        description: "把现有内容改写成更克制的学术表达。",
        systemPrompt: "你是学术写作编辑。请保留原意，并提升学术表达。",
        userPrompt: lines([
          "请将以下内容改写为更正式的学术语气。",
          "",
          "{{selected_text}}",
          "",
          "{{current_file_content}}",
        ]),
      },
    },
    category: "writing",
    surfaces: ["chat", "selection", "workbench"],
    outputMode: "chat",
    requiredContext: [],
    optionalContext: ["selected_text", "current_file_content"],
    preferredProvider: null,
    preferredModel: null,
  }),
  createBuiltinTemplate({
    id: "builtin-export-polish",
    localized: {
      "en-US": {
        title: "Pre-export Polish Check",
        description: "Check structure, tone, and obvious issues before export.",
        systemPrompt: "You are a publication-oriented editor. Review structure, clarity, and missing elements.",
        userPrompt: lines([
          "Review the following content before export.",
          "",
          "{{current_file_content}}",
          "",
          "Output:",
          "1. Key Issues",
          "2. Suggested Fixes",
          "3. Ready / Not Ready",
        ]),
      },
      "zh-CN": {
        title: "导出前润色检查",
        description: "在导出前检查结构、语气和明显问题。",
        systemPrompt: "你是面向发表的编辑。请检查结构、清晰度和缺失要素。",
        userPrompt: lines([
          "请对以下内容做导出前润色检查。",
          "",
          "{{current_file_content}}",
          "",
          "输出要求：",
          "1. 主要问题",
          "2. 修改建议",
          "3. 是否已准备好",
        ]),
      },
    },
    category: "export",
    surfaces: ["chat", "workbench"],
    outputMode: "structured-chat",
    requiredContext: ["current_file_content"],
    optionalContext: ["current_file"],
    preferredProvider: null,
    preferredModel: null,
  }),
  createBuiltinTemplate({
    id: "builtin-compare-evidence",
    localized: {
      "en-US": {
        title: "Compare Evidence Sets",
        description: "Compare evidence sets around similarities, differences, and confidence.",
        systemPrompt: "You are an evidence comparison assistant. Highlight similarities, differences, and confidence.",
        userPrompt: lines([
          "Compare the following evidence sets.",
          "",
          "{{selected_evidence}}",
          "",
          "Output:",
          "1. Common Ground",
          "2. Differences",
          "3. Decision Impact",
        ]),
      },
      "zh-CN": {
        title: "比较两组证据",
        description: "围绕证据集合进行比较分析。",
        systemPrompt: "你是证据比较助手。请突出相同点、差异和可信度。",
        userPrompt: lines([
          "请比较以下证据集合。",
          "",
          "{{selected_evidence}}",
          "",
          "输出要求：",
          "1. 共同点",
          "2. 差异",
          "3. 对决策的影响",
        ]),
      },
    },
    category: "comparison",
    surfaces: ["chat", "evidence"],
    outputMode: "structured-chat",
    requiredContext: ["selected_evidence"],
    optionalContext: ["current_file"],
    preferredProvider: null,
    preferredModel: null,
  }),
  createBuiltinTemplate({
    id: "builtin-compare-pdf-items",
    localized: {
      "en-US": {
        title: "Compare Two PDF Items",
        description: "Compare methods and conclusions across PDF materials.",
        systemPrompt: "You are a research comparison assistant.",
        userPrompt: lines([
          "Compare the following research materials.",
          "",
          "# Evidence",
          "{{selected_evidence}}",
          "",
          "# Annotations",
          "{{pdf_annotations}}",
        ]),
      },
      "zh-CN": {
        title: "比较两个 PDF 条目",
        description: "比较不同 PDF 材料在方法和结论上的差异。",
        systemPrompt: "你是研究比较助手。",
        userPrompt: lines([
          "请比较以下研究材料。",
          "",
          "# 证据",
          "{{selected_evidence}}",
          "",
          "# 批注",
          "{{pdf_annotations}}",
        ]),
      },
    },
    category: "comparison",
    surfaces: ["chat", "evidence"],
    outputMode: "structured-chat",
    requiredContext: ["selected_evidence"],
    optionalContext: ["pdf_annotations"],
    preferredProvider: null,
    preferredModel: null,
  }),
  createBuiltinTemplate({
    id: "builtin-generate-proposal",
    localized: {
      "en-US": {
        title: "Generate Proposal",
        description: "Convert current content into a reviewable work plan.",
        systemPrompt: "You are a safe workflow planner. Produce reviewable, approval-gated plans only.",
        userPrompt: lines([
          "Generate a reviewable work plan for the following content.",
          "",
          "{{selected_text}}",
          "",
          "{{current_file_content}}",
        ]),
      },
      "zh-CN": {
        title: "生成计划",
        description: "把当前内容转成可审阅的工作计划。",
        systemPrompt: "你是安全的工作流规划助手。只生成可审阅、需审批的计划。",
        userPrompt: lines([
          "请为以下内容生成一个可审阅的工作计划。",
          "",
          "{{selected_text}}",
          "",
          "{{current_file_content}}",
        ]),
      },
    },
    category: "planning",
    surfaces: ["chat", "selection", "evidence", "workbench"],
    outputMode: "proposal",
    requiredContext: [],
    optionalContext: ["selected_text", "current_file_content"],
    pinned: true,
    preferredProvider: null,
    preferredModel: null,
  }),
  createBuiltinTemplate({
    id: "builtin-generate-target-drafts",
    localized: {
      "en-US": {
        title: "Generate Target Draft Set",
        description: "Organize the current plan or evidence into target draft files.",
        systemPrompt: "You are a workflow assistant. Prepare target drafts for user review.",
        userPrompt: lines([
          "Organize the following content into a target draft set.",
          "",
          "{{selected_evidence}}",
          "",
          "{{active_proposal}}",
        ]),
      },
      "zh-CN": {
        title: "生成目标草稿集",
        description: "将当前计划或证据整理成目标草稿集合。",
        systemPrompt: "你是工作流助手。请准备可供用户审阅的目标草稿。",
        userPrompt: lines([
          "请将以下内容整理成目标草稿集合。",
          "",
          "{{selected_evidence}}",
          "",
          "{{active_proposal}}",
        ]),
      },
    },
    category: "planning",
    surfaces: ["chat", "evidence", "workbench"],
    outputMode: "target-draft-set",
    requiredContext: [],
    optionalContext: ["selected_evidence", "active_proposal"],
    preferredProvider: null,
    preferredModel: null,
  }),
];
