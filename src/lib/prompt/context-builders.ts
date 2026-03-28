import type { EvidenceRef } from "@/lib/ai/types";
import type { SelectionContext } from "@/lib/ai/selection-context";
import type { PromptContextValues } from "@/lib/prompt/types";

export function formatPromptEvidenceRefs(evidenceRefs: EvidenceRef[]): string | null {
  if (evidenceRefs.length === 0) {
    return null;
  }

  return evidenceRefs
    .map((ref, index) => {
      const preview = ref.preview?.trim();
      return `${index + 1}. ${ref.label} -> ${ref.locator}${preview ? `\n${preview}` : ""}`;
    })
    .join("\n");
}

export function buildSelectionPromptContextValues(context: SelectionContext): PromptContextValues {
  return {
    selected_text: context.selectedText,
    current_file: context.filePath ?? context.fileName,
    current_file_content: context.contextText ?? context.selectedText,
    selected_evidence: formatPromptEvidenceRefs(context.evidenceRefs),
    workspace_summary: context.contextSummary ?? context.sourceLabel,
  };
}

export function buildEvidencePromptContextValues(input: {
  evidenceRefs: EvidenceRef[];
  currentFile?: string | null;
  currentFileContent?: string | null;
  workspaceSummary?: string | null;
}): PromptContextValues {
  return {
    current_file: input.currentFile ?? null,
    current_file_content: input.currentFileContent ?? null,
    selected_evidence: formatPromptEvidenceRefs(input.evidenceRefs),
    workspace_summary: input.workspaceSummary ?? null,
  };
}
