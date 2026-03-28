import type {
  PromptContextResolution,
  PromptContextSlot,
  PromptContextValues,
  PromptTemplate,
} from "@/lib/prompt/types";

function normalizeContextValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function slotLabel(slot: PromptContextSlot): string {
  switch (slot) {
    case "selected_text":
      return "Selected Text";
    case "current_file":
      return "Current File";
    case "current_file_content":
      return "Current File Content";
    case "pdf_annotations":
      return "PDF Annotations";
    case "selected_evidence":
      return "Selected Evidence";
    case "active_draft":
      return "Active Draft";
    case "active_proposal":
      return "Active Proposal";
    case "workspace_summary":
      return "Workspace Summary";
  }
}

export function resolvePromptContext(
  template: Pick<PromptTemplate, "requiredContext" | "optionalContext">,
  values: PromptContextValues,
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
    .map((slot) => `${slotLabel(slot)}: ready`)
    .join(" · ");

  return {
    values: normalizedValues,
    contextSummary,
    missingRequiredContext,
    missingOptionalContext,
  };
}
