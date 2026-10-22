export interface VSCodeHostExtensionInput {
  id: string;
  path: string;
  main?: string;
  browser?: string;
  displayName?: string;
  packageJSON?: Record<string, unknown>;
  activationEvents: string[];
  extensionKind?: string[];
  commandItems?: Array<{
    command: string;
    title: string;
    category?: string;
  }>;
  viewItems?: Array<{
    id: string;
    title: string;
    container?: string;
  }>;
}

export interface VSCodeHostStartRequest {
  workspaceRootPath?: string | null;
  configuration?: Record<string, unknown>;
  extensions: VSCodeHostExtensionInput[];
}

export interface VSCodeHostOpenDocumentRequest {
  filePath: string;
  languageId?: string;
  content?: string;
  version: number;
}

export type VSCodeHostDocumentSyncRequest = Required<Pick<
  VSCodeHostOpenDocumentRequest,
  "filePath" | "content" | "version"
>> & Pick<VSCodeHostOpenDocumentRequest, "languageId">;

export interface VSCodeHostPosition {
  line: number;
  character: number;
}

export interface VSCodeHostRange {
  start: VSCodeHostPosition;
  end: VSCodeHostPosition;
}

export type VSCodeHostLanguageFeature =
  | "completion"
  | "hover"
  | "definition"
  | "diagnostics"
  | "references"
  | "rename"
  | "codeAction"
  | "formatting";

export interface VSCodeHostLanguageFeatureRequest {
  feature: VSCodeHostLanguageFeature;
  filePath: string;
  languageId: string;
  version: number;
  position?: VSCodeHostPosition;
  range?: VSCodeHostRange;
  triggerCharacter?: string;
  newName?: string;
  formattingOptions?: {
    tabSize: number;
    insertSpaces: boolean;
  };
  context?: {
    diagnostics?: unknown[];
    only?: string;
    triggerKind?: number;
  };
}

export interface VSCodeHostLanguageProviderResult {
  extensionId: string;
  durationMs: number;
  status: "ok" | "empty" | "error" | "timeout";
  value?: unknown;
  error?: string;
}

export interface VSCodeHostLanguageFeatureResponse {
  ok: boolean;
  feature: VSCodeHostLanguageFeature;
  documentVersion: number;
  providers: VSCodeHostLanguageProviderResult[];
  results: unknown[];
}

export interface VSCodeHostCommand {
  id: string;
  title: string;
  extensionId: string;
  category?: string;
  source: "host";
}

export interface VSCodeHostQuickPickItem {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
}

export interface VSCodeHostInteraction {
  id: string;
  type: "quickPick" | "inputBox";
  title?: string;
  placeHolder?: string;
  prompt?: string;
  canPickMany?: boolean;
  ignoreFocusOut?: boolean;
  password?: boolean;
  value?: string;
  items?: VSCodeHostQuickPickItem[];
}

export interface VSCodeHostCommandResult {
  snapshot: VSCodeHostSnapshot;
  interaction?: VSCodeHostInteraction;
}

export interface VSCodeHostInteractionResponse {
  interactionId: string;
  cancelled?: boolean;
  selectedIds?: string[];
  value?: string;
}

export interface VSCodeHostView {
  id: string;
  title: string;
  extensionId: string;
  container?: string;
  kind: "tree" | "webview" | "custom";
  source: "host";
}

export interface VSCodeHostWebviewOptions {
  enableScripts?: boolean;
  enableForms?: boolean;
  retainContextWhenHidden?: boolean;
}

export interface VSCodeHostExtensionState {
  id: string;
  displayName?: string;
  status: "pending" | "active" | "failed" | "skipped";
  commandCount: number;
  viewCount: number;
  error?: string;
  missingApi?: string[];
}

export interface VSCodeHostWebviewContent {
  viewId: string;
  title: string;
  extensionId: string;
  html: string;
  messages?: unknown[];
  options?: VSCodeHostWebviewOptions;
  source: "host";
}

export interface VSCodeHostWebviewMessageResult {
  viewId: string;
  messages: unknown[];
  snapshot: VSCodeHostSnapshot;
}

export interface VSCodeHostTreeItem {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  collapsibleState: "none" | "collapsed" | "expanded";
  command?: {
    command: string;
    title?: string;
    arguments?: unknown[];
  };
  children?: VSCodeHostTreeItem[];
}

export interface VSCodeHostTreeContent {
  viewId: string;
  title: string;
  extensionId: string;
  items: VSCodeHostTreeItem[];
  source: "host";
}

export interface VSCodeHostSnapshot {
  status: "idle" | "starting" | "ready" | "error" | "unavailable";
  runtime: "node" | "code-electron-node" | "none";
  commandCount: number;
  activeExtensionCount: number;
  commands: VSCodeHostCommand[];
  views: VSCodeHostView[];
  extensions: VSCodeHostExtensionState[];
  contextKeys?: Record<string, unknown>;
  lastError: string | null;
}

export const EMPTY_VSCODE_HOST_SNAPSHOT: VSCodeHostSnapshot = {
  status: "idle",
  runtime: "none",
  commandCount: 0,
  activeExtensionCount: 0,
  commands: [],
  views: [],
  extensions: [],
  contextKeys: {},
  lastError: null,
};
