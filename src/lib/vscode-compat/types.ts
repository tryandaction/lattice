export type VSCodeRawJson = Record<string, unknown>;

export interface VSCodeSettingsFile {
  settings?: VSCodeSettings;
  keybindings?: VSCodeKeybinding[];
  snippets?: Record<string, VSCodeSnippetFile | VSCodeSnippet>;
  tasks?: VSCodeTasksFile | null;
  launch?: VSCodeLaunchFile | null;
  extensions?: VSCodeExtensionInventoryEntry[];
}

export interface VSCodeDirectoryImportResult {
  config: VSCodeSettingsFile;
  sourceLabel: string;
  discoveredFiles: string[];
  warnings: string[];
}

export interface VSCodeExtensionInventoryEntry {
  id: string;
  source: "installed" | "recommended";
  path?: string;
  displayName?: string;
  icon?: string;
  version?: string;
  categories?: string[];
  main?: string;
  browser?: string;
  activationEvents?: string[];
  extensionKind?: string[];
  engines?: Record<string, string>;
  contributes?: VSCodeExtensionContributionSummary;
}

export interface VSCodeExtensionLanguageContribution {
  id: string;
  aliases: string[];
  extensions: string[];
  filenames: string[];
}

export interface VSCodeExtensionSnippetContribution {
  language: string;
  path: string;
}

export interface VSCodeExtensionCommandContribution {
  command: string;
  title: string;
  category?: string;
}

export interface VSCodeExtensionViewContribution {
  container: string;
  id: string;
  name: string;
  when?: string;
}

export interface VSCodeExtensionViewContainerContribution {
  id: string;
  title: string;
  location: string;
  icon?: string;
  when?: string;
}

export interface VSCodeExtensionGrammarContribution {
  language?: string;
  scopeName?: string;
  path?: string;
}

export interface VSCodeExtensionThemeContribution {
  label: string;
  id?: string;
  uiTheme?: string;
  path?: string;
}

export interface VSCodeExtensionContributionSummary {
  languages: VSCodeExtensionLanguageContribution[];
  snippets: VSCodeExtensionSnippetContribution[];
  commands: number;
  commandItems: VSCodeExtensionCommandContribution[];
  debuggers: number;
  configuration: boolean;
  views: VSCodeExtensionViewContribution[];
  viewContainers: string[];
  viewContainerItems?: VSCodeExtensionViewContainerContribution[];
  menus: number;
  notebooks: string[];
  notebookRenderers: string[];
  grammars: VSCodeExtensionGrammarContribution[];
  themes: VSCodeExtensionThemeContribution[];
}

export interface VSCodeSettings {
  [key: string]: unknown;
  "editor.tabSize"?: number;
  "editor.insertSpaces"?: boolean;
  "editor.wordWrap"?: "off" | "on" | "wordWrapColumn" | "bounded";
  "editor.fontFamily"?: string;
  "editor.fontSize"?: number;
  "editor.lineNumbers"?: "on" | "off" | "relative" | "interval";
  "editor.rulers"?: number[];
  "editor.formatOnSave"?: boolean;
  "editor.formatOnType"?: boolean;
  "editor.minimap.enabled"?: boolean;
  "editor.quickSuggestions"?: boolean | { comments?: boolean; strings?: boolean; other?: boolean };
  "editor.suggestOnTriggerCharacters"?: boolean;
  "editor.autoClosingBrackets"?: "always" | "languageDefined" | "beforeWhitespace" | "never";
  "editor.autoClosingQuotes"?: "always" | "languageDefined" | "beforeWhitespace" | "never";
  "editor.autoIndent"?: "none" | "keep" | "brackets" | "advanced" | "full";
  "editor.smoothScrolling"?: boolean;
  "editor.cursorBlinking"?: string;
  "editor.renderWhitespace"?: "none" | "boundary" | "selection" | "trailing" | "all";
  "editor.snippetSuggestions"?: "top" | "bottom" | "inline" | "none";
  "files.exclude"?: Record<string, boolean>;
  "search.exclude"?: Record<string, boolean>;
  "files.associations"?: Record<string, string>;
  "editor.defaultFormatter"?: string;
  "workbench.colorTheme"?: string;
}

export interface VSCodeKeybinding {
  key: string;
  command: string;
  when?: string;
  args?: unknown;
}

export interface VSCodeSnippetFile {
  [snippetName: string]: VSCodeSnippet;
}

export interface VSCodeSnippet {
  prefix?: string | string[];
  body?: string | string[];
  description?: string;
}

export interface VSCodeTaskDefinition {
  label?: string;
  type?: string;
  command?: string;
  args?: unknown[];
  options?: {
    cwd?: string;
    env?: Record<string, string>;
  };
  presentation?: Record<string, unknown>;
  group?: string | { kind?: string; isDefault?: boolean };
  problemMatcher?: unknown;
}

export interface VSCodeTasksFile {
  version?: string | number;
  tasks?: VSCodeTaskDefinition[];
}

export interface VSCodeLaunchConfigurationDefinition {
  name?: string;
  type?: string;
  request?: string;
  program?: string;
  module?: string;
  cwd?: string;
  args?: unknown[];
  env?: Record<string, string>;
  python?: string;
  justMyCode?: boolean;
  stopOnEntry?: boolean;
  subProcess?: boolean;
  runtimeExecutable?: string;
  runtimeArgs?: unknown[];
  console?: string;
  sourceMaps?: boolean;
  smartStep?: boolean;
  skipFiles?: unknown[];
  outFiles?: unknown[];
}

export interface VSCodeLaunchFile {
  version?: string | number;
  configurations?: VSCodeLaunchConfigurationDefinition[];
}

export interface VSCodeSnippetDefinition {
  name: string;
  prefix: string[];
  body: string;
  description?: string;
  scope?: string[];
}

export interface VSCodeTask {
  label: string;
  type: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  group?: string;
  isDefault?: boolean;
  presentation?: Record<string, unknown>;
}

export interface VSCodeLaunchConfiguration {
  name: string;
  type: string;
  request: string;
  program?: string;
  module?: string;
  cwd?: string;
  args: string[];
  env?: Record<string, string>;
  python?: string;
  justMyCode?: boolean;
  stopOnEntry?: boolean;
  subProcess?: boolean;
  runtimeExecutable?: string;
  runtimeArgs?: string[];
  console?: string;
  sourceMaps?: boolean;
  smartStep?: boolean;
  skipFiles?: string[];
  outFiles?: string[];
}

export interface VSCodeWorkbenchConfig {
  settings: VSCodeWorkbenchSettings;
  keybindings: VSCodeKeybinding[];
  snippets: VSCodeSnippetDefinition[];
  tasks: VSCodeTask[];
  launches: VSCodeLaunchConfiguration[];
  extensions: VSCodeExtensionInventoryEntry[];
  raw: {
    settings: VSCodeSettings;
    keybindings: VSCodeKeybinding[];
    snippets: Record<string, VSCodeSnippetFile | VSCodeSnippet>;
    tasks: VSCodeTasksFile | null;
    launch: VSCodeLaunchFile | null;
    extensions: VSCodeExtensionInventoryEntry[];
  };
}

export interface VSCodeWorkbenchSettings {
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: "off" | "on" | "wordWrapColumn" | "bounded";
  fontFamily: string | null;
  fontSize: number | null;
  lineNumbers: "on" | "off" | "relative" | "interval";
  rulers: number[];
  formatOnSave: boolean;
  formatOnType: boolean;
  minimapEnabled: boolean;
  quickSuggestions: boolean;
  suggestOnTriggerCharacters: boolean;
  autoClosingBrackets: boolean;
  autoClosingQuotes: boolean;
  autoIndent: "none" | "keep" | "brackets" | "advanced" | "full";
  smoothScrolling: boolean;
  cursorBlinking: string | null;
  renderWhitespace: "none" | "boundary" | "selection" | "trailing" | "all";
  snippetSuggestions: "top" | "bottom" | "inline" | "none";
  filesExclude: Record<string, boolean>;
  searchExclude: Record<string, boolean>;
  filesAssociations: Record<string, string>;
  defaultFormatter: string | null;
  colorTheme: string | null;
}

export interface VSCodeImportResult {
  settings: VSCodeWorkbenchSettings;
  keybindings: VSCodeKeybinding[];
  keymap: Record<string, string>;
  snippets: VSCodeSnippetDefinition[];
  tasks: VSCodeTask[];
  launches: VSCodeLaunchConfiguration[];
  taskLabels: string[];
  extensions: VSCodeExtensionInventoryEntry[];
  warnings: string[];
  raw: {
    settings: VSCodeSettings;
    keybindings: VSCodeKeybinding[];
    snippets: Record<string, VSCodeSnippetFile | VSCodeSnippet>;
    tasks: VSCodeTasksFile | null;
    launch: VSCodeLaunchFile | null;
    extensions: VSCodeExtensionInventoryEntry[];
  };
}
