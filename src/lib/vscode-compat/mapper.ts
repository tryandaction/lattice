import type {
  VSCodeImportResult,
  VSCodeExtensionCommandContribution,
  VSCodeExtensionContributionSummary,
  VSCodeExtensionGrammarContribution,
  VSCodeExtensionInventoryEntry,
  VSCodeExtensionLanguageContribution,
  VSCodeExtensionSnippetContribution,
  VSCodeExtensionThemeContribution,
  VSCodeExtensionViewContribution,
  VSCodeKeybinding,
  VSCodeSettings,
  VSCodeSettingsFile,
  VSCodeSnippet,
  VSCodeSnippetDefinition,
  VSCodeSnippetFile,
  VSCodeTask,
  VSCodeTasksFile,
  VSCodeLaunchConfiguration,
  VSCodeLaunchFile,
  VSCodeWorkbenchSettings,
} from "./types";

const DEFAULT_WORKBENCH_SETTINGS: VSCodeWorkbenchSettings = {
  tabSize: 2,
  insertSpaces: true,
  wordWrap: "off",
  fontFamily: null,
  fontSize: null,
  lineNumbers: "on",
  rulers: [],
  formatOnSave: false,
  formatOnType: false,
  minimapEnabled: true,
  quickSuggestions: true,
  suggestOnTriggerCharacters: true,
  autoClosingBrackets: true,
  autoClosingQuotes: true,
  autoIndent: "full",
  smoothScrolling: false,
  cursorBlinking: null,
  renderWhitespace: "none",
  snippetSuggestions: "inline",
  filesExclude: {},
  searchExclude: {},
  filesAssociations: {},
  defaultFormatter: null,
  colorTheme: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePatternMap(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => typeof entry === "boolean")
      .map(([pattern, enabled]) => [pattern, Boolean(enabled)]),
  );
}

function normalizeAssociationMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [pattern, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      result[pattern] = entry.toLowerCase();
    }
  }
  return result;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function normalizeLanguageContributions(value: unknown): VSCodeExtensionLanguageContribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VSCodeExtensionLanguageContribution[] => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim()) return [];
    return [{
      id: entry.id.trim().toLowerCase(),
      aliases: normalizeStringArray(entry.aliases),
      extensions: normalizeStringArray(entry.extensions).map((extension) => extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`),
      filenames: normalizeStringArray(entry.filenames),
    }];
  });
}

function normalizeSnippetContributions(value: unknown): VSCodeExtensionSnippetContribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VSCodeExtensionSnippetContribution[] => {
    if (!isRecord(entry) || typeof entry.language !== "string" || typeof entry.path !== "string") return [];
    const language = entry.language.trim().toLowerCase();
    const path = entry.path.trim();
    return language && path ? [{ language, path }] : [];
  });
}

function normalizeCommandContributions(value: unknown): VSCodeExtensionCommandContribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VSCodeExtensionCommandContribution[] => {
    if (!isRecord(entry) || typeof entry.command !== "string" || typeof entry.title !== "string") return [];
    const command = entry.command.trim();
    const title = entry.title.trim();
    if (!command || !title) return [];
    return [{
      command,
      title,
      ...(typeof entry.category === "string" && entry.category.trim() ? { category: entry.category.trim() } : {}),
    }];
  });
}

function normalizeViewContributions(value: unknown): VSCodeExtensionViewContribution[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry): VSCodeExtensionViewContribution[] => {
      if (!isRecord(entry) || typeof entry.container !== "string" || typeof entry.id !== "string" || typeof entry.name !== "string") return [];
      return [{
        container: entry.container.trim(),
        id: entry.id.trim(),
        name: entry.name.trim(),
        ...(typeof entry.when === "string" && entry.when.trim() ? { when: entry.when.trim() } : {}),
      }];
    }).filter((entry) => entry.container.length > 0 && entry.id.length > 0 && entry.name.length > 0);
  }
  if (!isRecord(value)) return [];
  const views: VSCodeExtensionViewContribution[] = [];
  for (const [container, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string") continue;
      const id = entry.id.trim();
      const name = entry.name.trim();
      if (!id || !name) continue;
      views.push({
        container,
        id,
        name,
        ...(typeof entry.when === "string" && entry.when.trim() ? { when: entry.when.trim() } : {}),
      });
    }
  }
  return views;
}

function normalizeViewContainers(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeStringArray(value);
  if (!isRecord(value)) return [];
  const ids: string[] = [];
  for (const entries of Object.values(value)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (isRecord(entry) && typeof entry.id === "string" && entry.id.trim()) {
        ids.push(entry.id.trim());
      }
    }
  }
  return Array.from(new Set(ids));
}

function normalizeViewContainerItems(value: unknown): VSCodeExtensionContributionSummary["viewContainerItems"] {
  if (!isRecord(value)) return [];
  const containers: NonNullable<VSCodeExtensionContributionSummary["viewContainerItems"]> = [];
  for (const [location, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.id !== "string") continue;
      const id = entry.id.trim();
      const title = typeof entry.title === "string" ? entry.title.trim() : id;
      if (!id || !title) continue;
      containers.push({
        id,
        title,
        location,
        ...(typeof entry.icon === "string" && entry.icon.trim() ? { icon: entry.icon.trim() } : {}),
        ...(typeof entry.when === "string" && entry.when.trim() ? { when: entry.when.trim() } : {}),
      });
    }
  }
  return containers;
}

function countMenuContributions(value: unknown): number {
  if (!isRecord(value)) return 0;
  return Object.values(value).reduce<number>((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0);
}

function normalizeNotebookContributions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): string[] => {
    if (typeof entry === "string") {
      const id = entry.trim();
      return id ? [id] : [];
    }
    if (!isRecord(entry)) return [];
    const id = typeof entry.type === "string" ? entry.type.trim() : typeof entry.id === "string" ? entry.id.trim() : "";
    return id ? [id] : [];
  });
}

function normalizeNotebookRendererContributions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): string[] => {
    if (typeof entry === "string") {
      const id = entry.trim();
      return id ? [id] : [];
    }
    if (!isRecord(entry)) return [];
    const id = typeof entry.id === "string" ? entry.id.trim() : typeof entry.viewType === "string" ? entry.viewType.trim() : "";
    return id ? [id] : [];
  });
}

function normalizeGrammarContributions(value: unknown): VSCodeExtensionGrammarContribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VSCodeExtensionGrammarContribution[] => {
    if (!isRecord(entry)) return [];
    const grammar: VSCodeExtensionGrammarContribution = {
      ...(typeof entry.language === "string" && entry.language.trim() ? { language: entry.language.trim().toLowerCase() } : {}),
      ...(typeof entry.scopeName === "string" && entry.scopeName.trim() ? { scopeName: entry.scopeName.trim() } : {}),
      ...(typeof entry.path === "string" && entry.path.trim() ? { path: entry.path.trim() } : {}),
    };
    return grammar.language || grammar.scopeName || grammar.path ? [grammar] : [];
  });
}

function normalizeThemeContributions(value: unknown): VSCodeExtensionThemeContribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VSCodeExtensionThemeContribution[] => {
    if (typeof entry === "string") {
      const label = entry.trim();
      return label ? [{ label }] : [];
    }
    if (!isRecord(entry)) return [];
    const label = typeof entry.label === "string" ? entry.label.trim() : typeof entry.id === "string" ? entry.id.trim() : "";
    if (!label) return [];
    return [{
      label,
      ...(typeof entry.id === "string" && entry.id.trim() ? { id: entry.id.trim() } : {}),
      ...(typeof entry.uiTheme === "string" && entry.uiTheme.trim() ? { uiTheme: entry.uiTheme.trim() } : {}),
      ...(typeof entry.path === "string" && entry.path.trim() ? { path: entry.path.trim() } : {}),
    }];
  });
}

function normalizeExtensionContributionSummary(value: unknown): VSCodeExtensionContributionSummary | undefined {
  if (!isRecord(value)) return undefined;
  const commandItems = normalizeCommandContributions(value.commandItems ?? value.commands);
  const viewContainerItems = normalizeViewContainerItems(value.viewContainerItems ?? value.viewsContainers) ?? [];
  const summary = {
    languages: normalizeLanguageContributions(value.languages),
    snippets: normalizeSnippetContributions(value.snippets),
    commands: commandItems.length > 0 ? commandItems.length : typeof value.commands === "number" ? value.commands : 0,
    commandItems,
    debuggers: Array.isArray(value.debuggers) ? value.debuggers.length : typeof value.debuggers === "number" ? value.debuggers : 0,
    configuration: Boolean(value.configuration),
    views: normalizeViewContributions(value.views),
    viewContainers: normalizeViewContainers(value.viewContainers),
    ...(viewContainerItems.length > 0 ? { viewContainerItems } : {}),
    menus: typeof value.menus === "number" ? value.menus : countMenuContributions(value.menus),
    notebooks: normalizeNotebookContributions(value.notebooks),
    notebookRenderers: normalizeNotebookRendererContributions(value.notebookRenderers ?? value.notebookRenderer),
    grammars: normalizeGrammarContributions(value.grammars),
    themes: normalizeThemeContributions(value.themes),
  };
  return summary.languages.length > 0 ||
    summary.snippets.length > 0 ||
    summary.commands > 0 ||
    summary.debuggers > 0 ||
    summary.configuration ||
    summary.views.length > 0 ||
    summary.viewContainers.length > 0 ||
    (summary.viewContainerItems?.length ?? 0) > 0 ||
    summary.menus > 0 ||
    summary.notebooks.length > 0 ||
    summary.notebookRenderers.length > 0 ||
    summary.grammars.length > 0 ||
    summary.themes.length > 0
    ? summary
    : undefined;
}

function normalizeSnippetBody(snippet: VSCodeSnippet): string {
  const body = snippet.body;
  if (Array.isArray(body)) {
    return body.join("\n");
  }
  if (typeof body === "string") {
    return body;
  }
  return "";
}

function normalizeSnippetPrefix(snippet: VSCodeSnippet): string[] {
  if (typeof snippet.prefix === "string") return [snippet.prefix];
  if (Array.isArray(snippet.prefix)) {
    return snippet.prefix.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function flattenSnippets(source: Record<string, VSCodeSnippetFile | VSCodeSnippet>): VSCodeSnippetDefinition[] {
  const definitions: VSCodeSnippetDefinition[] = [];

  for (const [scopeName, scopeValue] of Object.entries(source)) {
    if (!isRecord(scopeValue) || "prefix" in scopeValue || "body" in scopeValue) {
      const snippet = scopeValue as VSCodeSnippet;
      const prefixes = normalizeSnippetPrefix(snippet);
      const body = normalizeSnippetBody(snippet);
      if (prefixes.length > 0 && body) {
        definitions.push({
          name: scopeName,
          prefix: prefixes,
          body,
          description: typeof snippet.description === "string" ? snippet.description : undefined,
          scope: [],
        });
      }
      continue;
    }

    for (const [snippetName, snippetValue] of Object.entries(scopeValue)) {
      const prefixes = normalizeSnippetPrefix(snippetValue);
      const body = normalizeSnippetBody(snippetValue);
      if (prefixes.length === 0 || !body) continue;
      definitions.push({
        name: snippetName,
        prefix: prefixes,
        body,
        description: typeof snippetValue.description === "string" ? snippetValue.description : undefined,
        scope: [scopeName],
      });
    }
  }

  return definitions;
}

function flattenTasks(tasksFile: VSCodeTasksFile | null | undefined): VSCodeTask[] {
  if (!tasksFile || !Array.isArray(tasksFile.tasks)) return [];
  return tasksFile.tasks.flatMap((task): VSCodeTask[] => {
    if (!task || typeof task !== "object") return [];
    const label = typeof task.label === "string" && task.label.trim() ? task.label.trim() : null;
    const command = typeof task.command === "string" && task.command.trim() ? task.command.trim() : null;
    if (!label || !command) return [];
    const args = Array.isArray(task.args) ? task.args.filter((item): item is string => typeof item === "string") : [];
    const cwd = task.options && isRecord(task.options) && typeof task.options.cwd === "string" ? task.options.cwd : undefined;
    const env = task.options && isRecord(task.options) && isRecord(task.options.env)
      ? Object.fromEntries(Object.entries(task.options.env).filter(([, value]) => typeof value === "string")) as Record<string, string>
      : undefined;
    const group =
      typeof task.group === "string"
        ? task.group
        : isRecord(task.group) && typeof task.group.kind === "string"
          ? task.group.kind
          : undefined;
    const isDefault = isRecord(task.group) ? Boolean(task.group.isDefault) : false;
    return [{
      label,
      type: typeof task.type === "string" ? task.type : "shell",
      command,
      args,
      ...(cwd ? { cwd } : {}),
      ...(env ? { env } : {}),
      ...(group ? { group } : {}),
      ...(isDefault ? { isDefault } : {}),
      ...(task.presentation && isRecord(task.presentation) ? { presentation: task.presentation } : {}),
    }];
  });
}

function flattenLaunchConfigurations(launchFile: VSCodeLaunchFile | null | undefined): VSCodeLaunchConfiguration[] {
  if (!launchFile || !Array.isArray(launchFile.configurations)) return [];
  return launchFile.configurations.flatMap((config): VSCodeLaunchConfiguration[] => {
    if (!config || typeof config !== "object") return [];
    const name = typeof config.name === "string" && config.name.trim() ? config.name.trim() : null;
    const type = typeof config.type === "string" && config.type.trim() ? config.type.trim() : null;
    const request = typeof config.request === "string" && config.request.trim() ? config.request.trim() : "launch";
    if (!name || !type) return [];
    const args = Array.isArray(config.args) ? config.args.filter((item): item is string => typeof item === "string") : [];
    const env = config.env && isRecord(config.env)
      ? Object.fromEntries(Object.entries(config.env).filter(([, value]) => typeof value === "string")) as Record<string, string>
      : undefined;
    return [{
      name,
      type,
      request,
      ...(typeof config.program === "string" && config.program.trim() ? { program: config.program.trim() } : {}),
      ...(typeof config.module === "string" && config.module.trim() ? { module: config.module.trim() } : {}),
      ...(typeof config.cwd === "string" && config.cwd.trim() ? { cwd: config.cwd.trim() } : {}),
      args,
      ...(env ? { env } : {}),
      ...(typeof config.python === "string" && config.python.trim() ? { python: config.python.trim() } : {}),
      ...(typeof config.justMyCode === "boolean" ? { justMyCode: config.justMyCode } : {}),
      ...(typeof config.stopOnEntry === "boolean" ? { stopOnEntry: config.stopOnEntry } : {}),
      ...(typeof config.subProcess === "boolean" ? { subProcess: config.subProcess } : {}),
      ...(typeof config.runtimeExecutable === "string" && config.runtimeExecutable.trim()
        ? { runtimeExecutable: config.runtimeExecutable.trim() }
        : {}),
      ...(Array.isArray(config.runtimeArgs) ? { runtimeArgs: normalizeStringArray(config.runtimeArgs) } : {}),
      ...(typeof config.console === "string" && config.console.trim() ? { console: config.console.trim() } : {}),
      ...(typeof config.sourceMaps === "boolean" ? { sourceMaps: config.sourceMaps } : {}),
      ...(typeof config.smartStep === "boolean" ? { smartStep: config.smartStep } : {}),
      ...(Array.isArray(config.skipFiles) ? { skipFiles: normalizeStringArray(config.skipFiles) } : {}),
      ...(Array.isArray(config.outFiles) ? { outFiles: normalizeStringArray(config.outFiles) } : {}),
    }];
  });
}

function buildKeymap(bindings: VSCodeKeybinding[]): Record<string, string> {
  const pairs = bindings
    .filter((binding) => typeof binding?.key === "string" && typeof binding?.command === "string")
    .map((binding) => [binding.key.trim(), binding.command.trim()] as const)
    .filter(([key, command]) => key.length > 0 && command.length > 0);
  return Object.fromEntries(pairs);
}

function normalizeExtensionInventoryEntries(value: unknown): VSCodeExtensionInventoryEntry[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, VSCodeExtensionInventoryEntry>();

  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const id = entry.id.trim().toLowerCase();
    if (!id) continue;
    const source = entry.source === "recommended" ? "recommended" : "installed";
    const contributes = normalizeExtensionContributionSummary(entry.contributes);
    const normalized: VSCodeExtensionInventoryEntry = {
      id,
      source,
      ...(typeof entry.path === "string" && entry.path.trim() ? { path: entry.path.trim() } : {}),
      ...(typeof entry.displayName === "string" && entry.displayName.trim() ? { displayName: entry.displayName.trim() } : {}),
      ...(typeof entry.icon === "string" && entry.icon.trim() ? { icon: entry.icon.trim() } : {}),
      ...(typeof entry.version === "string" && entry.version.trim() ? { version: entry.version.trim() } : {}),
      ...(Array.isArray(entry.categories) ? { categories: entry.categories.filter((item): item is string => typeof item === "string") } : {}),
      ...(typeof entry.main === "string" && entry.main.trim() ? { main: entry.main.trim() } : {}),
      ...(typeof entry.browser === "string" && entry.browser.trim() ? { browser: entry.browser.trim() } : {}),
      ...(Array.isArray(entry.activationEvents) ? { activationEvents: entry.activationEvents.filter((item): item is string => typeof item === "string" && item.trim().length > 0) } : {}),
      ...(Array.isArray(entry.extensionKind) ? { extensionKind: entry.extensionKind.filter((item): item is string => typeof item === "string" && item.trim().length > 0) } : {}),
      ...(isRecord(entry.engines) ? { engines: Object.fromEntries(Object.entries(entry.engines).filter(([, value]) => typeof value === "string")) as Record<string, string> } : {}),
      ...(contributes ? { contributes } : {}),
    };
    byKey.set(`${source}:${id}`, normalized);
  }

  return Array.from(byKey.values());
}

export function normalizeVSCodeSettings(input: unknown): VSCodeSettings {
  if (!isRecord(input)) return {};
  return input as VSCodeSettings;
}

export function importVSCodeSettingsFile(input: VSCodeSettingsFile): VSCodeImportResult {
  const settings = normalizeVSCodeSettings(input.settings ?? {});
  const keybindings = Array.isArray(input.keybindings) ? input.keybindings : [];
  const snippets = input.snippets ?? {};
  const tasks = input.tasks ?? null;
  const launch = input.launch ?? null;
  const extensions = normalizeExtensionInventoryEntries(input.extensions);

  const tabSize = typeof settings["editor.tabSize"] === "number" && settings["editor.tabSize"] > 0
    ? Math.max(1, Math.min(16, Math.round(settings["editor.tabSize"])))
    : DEFAULT_WORKBENCH_SETTINGS.tabSize;
  const insertSpaces = typeof settings["editor.insertSpaces"] === "boolean"
    ? settings["editor.insertSpaces"]
    : DEFAULT_WORKBENCH_SETTINGS.insertSpaces;
  const wordWrap = settings["editor.wordWrap"] === "on" || settings["editor.wordWrap"] === "wordWrapColumn" || settings["editor.wordWrap"] === "bounded"
    ? settings["editor.wordWrap"]
    : "off";
  const lineNumbers = settings["editor.lineNumbers"] === "off" || settings["editor.lineNumbers"] === "relative" || settings["editor.lineNumbers"] === "interval"
    ? settings["editor.lineNumbers"]
    : "on";

  const normalizedKeybindings = keybindings.filter((binding): binding is VSCodeKeybinding => Boolean(binding && typeof binding.key === "string" && typeof binding.command === "string"));
  const normalizedSnippets = flattenSnippets(snippets);
  const normalizedTasks = flattenTasks(tasks);
  const normalizedLaunches = flattenLaunchConfigurations(launch);

  const result: VSCodeImportResult = {
    settings: {
      ...DEFAULT_WORKBENCH_SETTINGS,
      tabSize,
      insertSpaces,
      wordWrap,
      fontFamily: typeof settings["editor.fontFamily"] === "string" ? settings["editor.fontFamily"] : null,
      fontSize: typeof settings["editor.fontSize"] === "number" ? settings["editor.fontSize"] : null,
      lineNumbers,
      rulers: Array.isArray(settings["editor.rulers"]) ? settings["editor.rulers"].filter((entry): entry is number => typeof entry === "number") : [],
      formatOnSave: Boolean(settings["editor.formatOnSave"]),
      formatOnType: Boolean(settings["editor.formatOnType"]),
      minimapEnabled: settings["editor.minimap.enabled"] === false ? false : true,
      quickSuggestions: typeof settings["editor.quickSuggestions"] === "boolean" ? settings["editor.quickSuggestions"] : true,
      suggestOnTriggerCharacters: settings["editor.suggestOnTriggerCharacters"] === false ? false : true,
      autoClosingBrackets: settings["editor.autoClosingBrackets"] === "never" ? false : true,
      autoClosingQuotes: settings["editor.autoClosingQuotes"] === "never" ? false : true,
      autoIndent: settings["editor.autoIndent"] === "none" || settings["editor.autoIndent"] === "keep" || settings["editor.autoIndent"] === "brackets" || settings["editor.autoIndent"] === "advanced" || settings["editor.autoIndent"] === "full"
        ? settings["editor.autoIndent"]
        : "full",
      smoothScrolling: Boolean(settings["editor.smoothScrolling"]),
      cursorBlinking: typeof settings["editor.cursorBlinking"] === "string" ? settings["editor.cursorBlinking"] : null,
      renderWhitespace: settings["editor.renderWhitespace"] === "boundary" || settings["editor.renderWhitespace"] === "selection" || settings["editor.renderWhitespace"] === "trailing" || settings["editor.renderWhitespace"] === "all"
        ? settings["editor.renderWhitespace"]
        : "none",
      snippetSuggestions: settings["editor.snippetSuggestions"] === "top" || settings["editor.snippetSuggestions"] === "bottom" || settings["editor.snippetSuggestions"] === "inline" || settings["editor.snippetSuggestions"] === "none"
        ? settings["editor.snippetSuggestions"]
        : "inline",
      filesExclude: normalizePatternMap(settings["files.exclude"]),
      searchExclude: normalizePatternMap(settings["search.exclude"]),
      filesAssociations: normalizeAssociationMap(settings["files.associations"]),
      defaultFormatter: typeof settings["editor.defaultFormatter"] === "string" ? settings["editor.defaultFormatter"] : null,
      colorTheme: typeof settings["workbench.colorTheme"] === "string" ? settings["workbench.colorTheme"] : null,
    },
    keybindings: normalizedKeybindings,
    keymap: buildKeymap(normalizedKeybindings),
    snippets: normalizedSnippets,
    tasks: normalizedTasks,
    launches: normalizedLaunches,
    taskLabels: normalizedTasks.map((task) => task.label),
    extensions,
    warnings: [],
    raw: {
      settings,
      keybindings: normalizedKeybindings,
      snippets,
      tasks,
      launch,
      extensions,
    },
  };

  if (result.settings.defaultFormatter) {
    result.warnings.push("editor.defaultFormatter is imported but formatter routing is not yet wired to a specific provider.");
  }

  return result;
}

export function createDefaultVSCodeWorkbenchSettings(): VSCodeWorkbenchSettings {
  return { ...DEFAULT_WORKBENCH_SETTINGS };
}

export function isPlainObjectWithFileAssociations(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

export function extractSettingsFromVSCodeInput(input: unknown): VSCodeSettingsFile {
  if (!isRecord(input)) {
    return {};
  }
  const settings = isRecord(input.settings) ? input.settings : {};
  const keybindings = Array.isArray(input.keybindings) ? input.keybindings : [];
  const snippets = isRecord(input.snippets) ? input.snippets : {};
  const tasks = isRecord(input.tasks) ? input.tasks : null;
  const extensions = normalizeExtensionInventoryEntries(input.extensions);
  return {
    settings: settings as VSCodeSettings,
    keybindings: keybindings.filter((item): item is VSCodeKeybinding => isRecord(item) && typeof item.key === "string" && typeof item.command === "string"),
    snippets: snippets as Record<string, VSCodeSnippetFile | VSCodeSnippet>,
    tasks: tasks as VSCodeTasksFile | null,
    extensions,
  };
}

export function makeKeymapIndex(bindings: VSCodeKeybinding[]): Record<string, string> {
  return buildKeymap(bindings);
}
