export type LinkTarget =
  | { type: "external_url"; url: string }
  | { type: "workspace_file"; path: string }
  | { type: "workspace_heading"; path: string; heading: string }
  | { type: "workspace_text"; path: string; snippet: string }
  | {
      type: "pdf_page";
      path: string;
      page: number;
      snippet?: string;
      rects?: WorkspaceEvidenceRect[];
    }
  | { type: "pdf_annotation"; path: string; annotationId: string; page?: number }
  | { type: "code_line"; path: string; line: number }
  | { type: "notebook_cell"; path: string; cellId: string }
  | { type: "system_path"; path: string };

/** Normalized page-relative rectangles carried by AI evidence navigation. */
export interface WorkspaceEvidenceRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WorkspaceEvidenceAnchor {
  page?: number;
  snippet?: string;
  rects?: WorkspaceEvidenceRect[];
}

export type WorkspaceNavigationTarget = Exclude<
  LinkTarget,
  { type: "external_url" } | { type: "system_path" } | { type: "workspace_file" }
>;

export interface ParsedLinkTarget {
  raw: string;
  normalized: string;
  target: LinkTarget | null;
}

export type NavigationStatus =
  | "success"
  | "pending"
  /** A newer navigation in this pane replaced this accepted request. */
  | "superseded"
  | "root_not_found"
  | "file_not_found"
  | "unsupported_target"
  | "page_not_ready"
  | "quote_not_found"
  | "renderer_timeout"
  | "pane_not_found";

export interface NavigationResult {
  ok: boolean;
  /** Structured alias for callers that do not use the legacy `ok` field. */
  success: boolean;
  requestId: string;
  status: NavigationStatus;
  target?: LinkTarget;
  filePath?: string;
}

export interface ParseLinkTargetOptions {
  currentFilePath?: string;
  pathMode?: "relative" | "workspace";
}
