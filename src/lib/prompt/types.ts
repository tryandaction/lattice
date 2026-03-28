export type PromptSurface =
  | "chat"
  | "selection"
  | "evidence"
  | "workbench"
  | "command";

export type PromptOutputMode =
  | "chat"
  | "structured-chat"
  | "draft"
  | "proposal"
  | "target-draft-set";

export type PromptContextSlot =
  | "selected_text"
  | "current_file"
  | "current_file_content"
  | "pdf_annotations"
  | "selected_evidence"
  | "active_draft"
  | "active_proposal"
  | "workspace_summary";

export type PromptCategory =
  | "reading"
  | "writing"
  | "comparison"
  | "planning"
  | "code"
  | "notebook"
  | "export"
  | "annotation";

export interface PromptTemplate {
  id: string;
  title: string;
  description: string;
  category: PromptCategory;
  systemPrompt?: string;
  userPrompt: string;
  surfaces: PromptSurface[];
  outputMode: PromptOutputMode;
  requiredContext: PromptContextSlot[];
  optionalContext: PromptContextSlot[];
  preferredProvider?: string | null;
  preferredModel?: string | null;
  pinned?: boolean;
  builtin?: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface PromptRun {
  id: string;
  templateId: string | null;
  surface: PromptSurface;
  renderedPrompt: string;
  renderedSystemPrompt?: string;
  contextSummary: string;
  outputMode: PromptOutputMode;
  resultMessageId?: string;
  resultDraftId?: string;
  resultProposalId?: string;
  createdAt: number;
}

export interface PromptContextValues {
  selected_text?: string | null;
  current_file?: string | null;
  current_file_content?: string | null;
  pdf_annotations?: string | null;
  selected_evidence?: string | null;
  active_draft?: string | null;
  active_proposal?: string | null;
  workspace_summary?: string | null;
}

export interface PromptContextResolution {
  values: PromptContextValues;
  contextSummary: string;
  missingRequiredContext: PromptContextSlot[];
  missingOptionalContext: PromptContextSlot[];
}

export interface RenderedPromptTemplate {
  renderedSystemPrompt?: string;
  renderedPrompt: string;
  contextSummary: string;
  missingRequiredContext: PromptContextSlot[];
  missingOptionalContext: PromptContextSlot[];
  values: PromptContextValues;
}

export interface PromptWorkspacePreference {
  recentTemplateIds: string[];
  defaultTemplatesBySurface: Partial<Record<PromptSurface, string>>;
}

export interface PromptExecutionDraftResult {
  title: string;
  content: string;
}
