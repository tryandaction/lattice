import type {
  PromptContextResolution,
  PromptContextSlot,
  PromptContextValues,
  PromptTemplate,
} from "@/lib/prompt/types";
import type { Locale } from "@/types/settings";

const CONTEXT_SLOT_LABELS: Record<Locale, Record<PromptContextSlot, string>> = {
  "en-US": {
    selected_text: "Selected text",
    current_file: "Current file",
    current_file_content: "Current file content",
    pdf_annotations: "PDF annotations",
    selected_evidence: "Selected evidence",
    active_draft: "Active draft",
    active_proposal: "Active proposal",
    workspace_summary: "Workspace summary",
  },
  "zh-CN": {
    selected_text: "当前选区",
    current_file: "当前文件",
    current_file_content: "当前文件内容",
    pdf_annotations: "PDF 批注",
    selected_evidence: "已选证据",
    active_draft: "当前草稿",
    active_proposal: "当前计划",
    workspace_summary: "工作区摘要",
  },
};

function normalizeContextValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function slotLabel(slot: PromptContextSlot, locale: Locale): string {
  return CONTEXT_SLOT_LABELS[locale]?.[slot] ?? CONTEXT_SLOT_LABELS["en-US"][slot];
}

function readyLabel(locale: Locale): string {
  return locale === "zh-CN" ? "已就绪" : "ready";
}

export function resolvePromptContext(
  template: Pick<PromptTemplate, "requiredContext" | "optionalContext">,
  values: PromptContextValues,
  locale: Locale = "en-US",
): PromptContextResolution {
  const normalizedValues: PromptContextValues = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, normalizeContextValue(value)]),
  ) as PromptContextValues;

  const missingRequiredContext = template.requiredContext.filter((slot) => !normalizedValues[slot]);
  const missingOptionalContext = template.optionalContext.filter((slot) => !normalizedValues[slot]);
  const contextSummary = [
    ...template.requiredContext,
    ...template.optionalContext.filter((slot) => !template.requiredContext.includes(slot)),
  ]
    .filter((slot, index, slots) => slots.indexOf(slot) === index)
    .filter((slot) => Boolean(normalizedValues[slot]))
    .map((slot) => {
      const separator = locale === "zh-CN" ? "：" : ": ";
      return `${slotLabel(slot, locale)}${separator}${readyLabel(locale)}`;
    })
    .join(" / ");

  return {
    values: normalizedValues,
    contextSummary,
    missingRequiredContext,
    missingOptionalContext,
  };
}
