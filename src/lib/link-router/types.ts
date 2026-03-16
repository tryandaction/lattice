export type LinkTarget =
  | { type: "external_url"; url: string }
  | { type: "workspace_file"; path: string }
  | { type: "workspace_heading"; path: string; heading: string }
  | { type: "pdf_page"; path: string; page: number }
  | { type: "pdf_annotation"; path: string; annotationId: string }
  | { type: "code_line"; path: string; line: number }
  | { type: "notebook_cell"; path: string; cellId: string }
  | { type: "system_path"; path: string };

export type WorkspaceNavigationTarget = Exclude<
  LinkTarget,
  { type: "external_url" } | { type: "system_path" } | { type: "workspace_file" }
>;

export interface ParsedLinkTarget {
  raw: string;
  normalized: string;
  target: LinkTarget | null;
}

export interface ParseLinkTargetOptions {
  currentFilePath?: string;
}
