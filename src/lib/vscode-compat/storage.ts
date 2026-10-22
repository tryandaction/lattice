import type {
  VSCodeDirectoryImportResult,
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
  VSCodeSnippetFile,
  VSCodeTasksFile,
} from "./types";
import { getDesktopHandlePath } from "@/lib/desktop-file-system";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeSettingsPayload(value: unknown): VSCodeSettingsFile {
  if (Array.isArray(value)) {
    return {
      keybindings: value.filter((item): item is VSCodeKeybinding => isObject(item) && typeof item.key === "string" && typeof item.command === "string"),
    };
  }

  if (!isObject(value)) return {};

  if (Array.isArray(value.tasks)) {
    return {
      tasks: value as VSCodeTasksFile,
    };
  }

  if (Array.isArray(value.configurations)) {
    return {
      launch: value as VSCodeSettingsFile["launch"],
    };
  }

  const hasWrappedShape = "settings" in value || "keybindings" in value || "snippets" in value || "tasks" in value || "launch" in value;
  if (!hasWrappedShape) {
    return {
      settings: value as VSCodeSettings,
    };
  }

  return {
    settings: isObject(value.settings) ? (value.settings as VSCodeSettingsFile["settings"]) : {},
    keybindings: Array.isArray(value.keybindings) ? value.keybindings as VSCodeSettingsFile["keybindings"] : [],
    snippets: isObject(value.snippets) ? (value.snippets as VSCodeSettingsFile["snippets"]) : {},
    tasks: isObject(value.tasks) ? (value.tasks as VSCodeSettingsFile["tasks"]) : undefined,
    launch: isObject(value.launch) ? (value.launch as VSCodeSettingsFile["launch"]) : undefined,
  };
}

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let stringQuote = "";
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = "";
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      inString = true;
      stringQuote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function stripTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, "$1");
}

function parseJsonLike(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripJsonComments(text))) as unknown;
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isVSCodeNlsPlaceholder(value: string): boolean {
  return /^%[^%\s][^%]*%$/.test(value.trim());
}

function readableLabelFromIdentifier(value: string): string {
  const source = value.includes(".") ? value.split(".").pop() ?? value : value;
  return source
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || value;
}

function resolveVSCodeNlsString(value: unknown, localization?: Record<string, string>, fallback?: string): string | undefined {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (isVSCodeNlsPlaceholder(trimmed)) {
    const key = trimmed.slice(1, -1);
    return localization?.[key]?.trim() || fallback;
  }
  return trimmed;
}

function normalizeExtensionAssetPath(basePath: string, assetPath: unknown): string | undefined {
  if (typeof assetPath !== "string") return undefined;
  const trimmed = assetPath.trim();
  if (!trimmed) return undefined;
  if (/^(?:https?:|data:|file:)/i.test(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\\\")) {
    return trimmed.replace(/\\/g, "/");
  }
  return `${basePath.replace(/\\/g, "/").replace(/\/+$/, "")}/${trimmed.replace(/^\.?[\\/]+/, "").replace(/\\/g, "/")}`;
}

function normalizeExtensionInventoryEntries(value: unknown): VSCodeExtensionInventoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VSCodeExtensionInventoryEntry[] => {
    if (!isObject(entry) || typeof entry.id !== "string") return [];
    const id = entry.id.trim().toLowerCase();
    if (!id) return [];
    const source = entry.source === "recommended" ? "recommended" : "installed";
    return [{
      id,
      source,
      ...(typeof entry.path === "string" && entry.path.trim() ? { path: entry.path.trim() } : {}),
      ...(typeof entry.displayName === "string" && entry.displayName.trim() ? { displayName: entry.displayName.trim() } : {}),
      ...(typeof entry.icon === "string" && entry.icon.trim() ? { icon: entry.icon.trim() } : {}),
      ...(typeof entry.version === "string" && entry.version.trim() ? { version: entry.version.trim() } : {}),
      ...(Array.isArray(entry.categories) ? { categories: entry.categories.filter((item): item is string => typeof item === "string") } : {}),
      ...(typeof entry.main === "string" && entry.main.trim() ? { main: entry.main.trim() } : {}),
      ...(typeof entry.browser === "string" && entry.browser.trim() ? { browser: entry.browser.trim() } : {}),
      ...(normalizeStringArray(entry.activationEvents).length > 0 ? { activationEvents: normalizeStringArray(entry.activationEvents) } : {}),
      ...(normalizeStringArray(entry.extensionKind).length > 0 ? { extensionKind: normalizeStringArray(entry.extensionKind) } : {}),
      ...(normalizeStringRecord(entry.engines) ? { engines: normalizeStringRecord(entry.engines) } : {}),
      ...(isObject(entry.contributes) ? { contributes: normalizeExtensionContributionSummary(entry.contributes) } : {}),
    }];
  });
}

function dedupeExtensionInventoryEntries(entries: VSCodeExtensionInventoryEntry[]): VSCodeExtensionInventoryEntry[] {
  const byKey = new Map<string, VSCodeExtensionInventoryEntry>();
  for (const entry of entries) {
    const key = `${entry.source}:${entry.id}`;
    if (!byKey.has(key)) {
      byKey.set(key, entry);
      continue;
    }
    const existing = byKey.get(key);
    if (existing && !existing.path && entry.path) {
      byKey.set(key, entry);
    }
  }
  return Array.from(byKey.values()).sort((left, right) => {
    const sourceOrder = left.source.localeCompare(right.source);
    return sourceOrder === 0 ? left.id.localeCompare(right.id) : sourceOrder;
  });
}

export function mergeVSCodeSettingsFiles(target: VSCodeSettingsFile, next: VSCodeSettingsFile): VSCodeSettingsFile {
  return {
    settings: {
      ...(target.settings ?? {}),
      ...(next.settings ?? {}),
    },
    keybindings: [
      ...(target.keybindings ?? []),
      ...(next.keybindings ?? []),
    ],
    snippets: {
      ...(target.snippets ?? {}),
      ...(next.snippets ?? {}),
    },
    tasks: next.tasks ?? target.tasks ?? null,
    launch: next.launch ?? target.launch ?? null,
    extensions: dedupeExtensionInventoryEntries([
      ...normalizeExtensionInventoryEntries(target.extensions),
      ...normalizeExtensionInventoryEntries(next.extensions),
    ]),
  };
}

async function getOptionalFileHandle(directory: FileSystemDirectoryHandle, name: string): Promise<FileSystemFileHandle | null> {
  try {
    return await directory.getFileHandle(name);
  } catch {
    return null;
  }
}

async function getOptionalDirectoryHandle(directory: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await directory.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function readJsonFileHandle(handle: FileSystemFileHandle): Promise<unknown> {
  const file = await handle.getFile();
  return parseJsonLike(await file.text());
}

async function readKnownConfigFile(directory: FileSystemDirectoryHandle, fileName: string): Promise<unknown | null> {
  const handle = await getOptionalFileHandle(directory, fileName);
  if (!handle) return null;
  return readJsonFileHandle(handle);
}

async function readExtensionLocalization(directory: FileSystemDirectoryHandle): Promise<Record<string, string> | undefined> {
  try {
    return normalizeStringRecord(await readKnownConfigFile(directory, "package.nls.json") ?? undefined);
  } catch {
    return undefined;
  }
}

function normalizeSnippetFile(value: unknown): Record<string, VSCodeSnippetFile | VSCodeSnippet> {
  if (!isObject(value)) return {};
  return value as Record<string, VSCodeSnippetFile | VSCodeSnippet>;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function normalizeLanguageContributions(value: unknown): VSCodeExtensionLanguageContribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VSCodeExtensionLanguageContribution[] => {
    if (!isObject(entry) || typeof entry.id !== "string" || !entry.id.trim()) return [];
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
    if (!isObject(entry) || typeof entry.language !== "string" || typeof entry.path !== "string") return [];
    const language = entry.language.trim().toLowerCase();
    const path = entry.path.trim();
    return language && path ? [{ language, path }] : [];
  });
}

function normalizeCommandContributions(value: unknown, localization?: Record<string, string>): VSCodeExtensionCommandContribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VSCodeExtensionCommandContribution[] => {
    if (!isObject(entry) || typeof entry.command !== "string" || typeof entry.title !== "string") return [];
    const command = entry.command.trim();
    const title = resolveVSCodeNlsString(entry.title, localization, readableLabelFromIdentifier(command));
    if (!command || !title) return [];
    return [{
      command,
      title,
      ...(resolveVSCodeNlsString(entry.category, localization) ? { category: resolveVSCodeNlsString(entry.category, localization)! } : {}),
    }];
  });
}

function normalizeViewContributions(value: unknown, localization?: Record<string, string>): VSCodeExtensionViewContribution[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry): VSCodeExtensionViewContribution[] => {
      if (!isObject(entry) || typeof entry.container !== "string" || typeof entry.id !== "string" || typeof entry.name !== "string") return [];
      const container = entry.container.trim();
      const id = entry.id.trim();
      const name = resolveVSCodeNlsString(entry.name, localization, readableLabelFromIdentifier(id));
      if (!container || !id || !name) return [];
      return [{
        container,
        id,
        name,
        ...(typeof entry.when === "string" && entry.when.trim() ? { when: entry.when.trim() } : {}),
      }];
    });
  }
  if (!isObject(value)) return [];
  const views: VSCodeExtensionViewContribution[] = [];
  for (const [container, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isObject(entry) || typeof entry.id !== "string" || typeof entry.name !== "string") continue;
      const id = entry.id.trim();
      const name = resolveVSCodeNlsString(entry.name, localization, readableLabelFromIdentifier(id));
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
  if (!isObject(value)) return [];
  const ids: string[] = [];
  for (const entries of Object.values(value)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (isObject(entry) && typeof entry.id === "string" && entry.id.trim()) {
        ids.push(entry.id.trim());
      }
    }
  }
  return Array.from(new Set(ids));
}

function normalizeViewContainerItems(
  value: unknown,
  localization?: Record<string, string>,
  basePath?: string,
): VSCodeExtensionContributionSummary["viewContainerItems"] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (!isObject(entry) || typeof entry.id !== "string" || typeof entry.location !== "string") return [];
      const id = entry.id.trim();
      const location = entry.location.trim();
      const title = resolveVSCodeNlsString(entry.title, localization, readableLabelFromIdentifier(id)) ?? id;
      if (!id || !location || !title) return [];
      return [{
        id,
        title,
        location,
        ...(typeof entry.icon === "string" && entry.icon.trim() ? { icon: entry.icon.trim() } : {}),
        ...(typeof entry.when === "string" && entry.when.trim() ? { when: entry.when.trim() } : {}),
      }];
    });
  }
  if (!isObject(value)) return [];
  const containers: NonNullable<VSCodeExtensionContributionSummary["viewContainerItems"]> = [];
  for (const [location, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isObject(entry) || typeof entry.id !== "string") continue;
      const id = entry.id.trim();
      const title = resolveVSCodeNlsString(entry.title, localization, readableLabelFromIdentifier(id)) ?? id;
      if (!id || !title) continue;
      containers.push({
        id,
        title,
        location,
        ...(basePath && normalizeExtensionAssetPath(basePath, entry.icon) ? { icon: normalizeExtensionAssetPath(basePath, entry.icon)! } : {}),
        ...(typeof entry.when === "string" && entry.when.trim() ? { when: entry.when.trim() } : {}),
      });
    }
  }
  return containers;
}

function countMenuContributions(value: unknown): number {
  if (!isObject(value)) return 0;
  return Object.values(value).reduce<number>((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0);
}

function normalizeNotebookContributions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): string[] => {
    if (typeof entry === "string") {
      const id = entry.trim();
      return id ? [id] : [];
    }
    if (!isObject(entry)) return [];
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
    if (!isObject(entry)) return [];
    const id = typeof entry.id === "string" ? entry.id.trim() : typeof entry.viewType === "string" ? entry.viewType.trim() : "";
    return id ? [id] : [];
  });
}

function normalizeGrammarContributions(value: unknown): VSCodeExtensionGrammarContribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VSCodeExtensionGrammarContribution[] => {
    if (!isObject(entry)) return [];
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
    if (!isObject(entry)) return [];
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

function normalizeExtensionContributionSummary(value: unknown, localization?: Record<string, string>, basePath?: string): VSCodeExtensionContributionSummary {
  const contributes = isObject(value) ? value : {};
  const commandItems = normalizeCommandContributions(contributes.commandItems ?? contributes.commands, localization);
  const viewContainerItems = normalizeViewContainerItems(
    contributes.viewContainerItems ?? contributes.viewsContainers,
    localization,
    basePath,
  ) ?? [];
  return {
    languages: normalizeLanguageContributions(contributes.languages),
    snippets: normalizeSnippetContributions(contributes.snippets),
    commands: commandItems.length > 0 ? commandItems.length : typeof contributes.commands === "number" ? contributes.commands : 0,
    commandItems,
    debuggers: Array.isArray(contributes.debuggers) ? contributes.debuggers.length : typeof contributes.debuggers === "number" ? contributes.debuggers : 0,
    configuration: Boolean(contributes.configuration),
    views: normalizeViewContributions(contributes.views, localization),
    viewContainers: normalizeViewContainers(contributes.viewContainers ?? contributes.viewsContainers),
    ...(viewContainerItems.length > 0 ? { viewContainerItems } : {}),
    menus: typeof contributes.menus === "number" ? contributes.menus : countMenuContributions(contributes.menus),
    notebooks: normalizeNotebookContributions(contributes.notebooks),
    notebookRenderers: normalizeNotebookRendererContributions(contributes.notebookRenderers ?? contributes.notebookRenderer),
    grammars: normalizeGrammarContributions(contributes.grammars),
    themes: normalizeThemeContributions(contributes.themes),
  };
}

function hasExtensionContributionSummary(value: VSCodeExtensionContributionSummary): boolean {
  return value.languages.length > 0 ||
    value.snippets.length > 0 ||
    value.commands > 0 ||
    value.debuggers > 0 ||
    value.configuration ||
    value.views.length > 0 ||
    value.viewContainers.length > 0 ||
    (value.viewContainerItems?.length ?? 0) > 0 ||
    value.menus > 0 ||
    value.notebooks.length > 0 ||
    value.notebookRenderers.length > 0 ||
    value.grammars.length > 0 ||
    value.themes.length > 0;
}

function normalizeRecommendedExtensions(value: unknown): VSCodeExtensionInventoryEntry[] {
  if (!isObject(value) || !Array.isArray(value.recommendations)) return [];
  return value.recommendations.flatMap((extensionId): VSCodeExtensionInventoryEntry[] => {
    if (typeof extensionId !== "string") return [];
    const id = extensionId.trim().toLowerCase();
    return id ? [{ id, source: "recommended" }] : [];
  });
}

function normalizeInstalledExtensionFromPackage(
  value: unknown,
  fallbackName: string,
  localization?: Record<string, string>,
): VSCodeExtensionInventoryEntry | null {
  if (isObject(value) && typeof value.publisher === "string" && typeof value.name === "string") {
    const id = `${value.publisher}.${value.name}`.trim().toLowerCase();
    const contributionSummary = normalizeExtensionContributionSummary(value.contributes, localization, fallbackName);
    const activationEvents = normalizeStringArray(value.activationEvents);
    const extensionKind = Array.isArray(value.extensionKind)
      ? normalizeStringArray(value.extensionKind)
      : typeof value.extensionKind === "string" && value.extensionKind.trim()
        ? [value.extensionKind.trim()]
        : [];
    const engines = normalizeStringRecord(value.engines);
    if (id.includes(".")) {
      return {
        id,
        source: "installed",
        path: fallbackName,
        ...(resolveVSCodeNlsString(value.displayName, localization) ? { displayName: resolveVSCodeNlsString(value.displayName, localization)! } : {}),
        ...(normalizeExtensionAssetPath(fallbackName, value.icon) ? { icon: normalizeExtensionAssetPath(fallbackName, value.icon)! } : {}),
        ...(typeof value.version === "string" && value.version.trim() ? { version: value.version.trim() } : {}),
        ...(Array.isArray(value.categories) ? { categories: value.categories.filter((item): item is string => typeof item === "string") } : {}),
        ...(typeof value.main === "string" && value.main.trim() ? { main: value.main.trim() } : {}),
        ...(typeof value.browser === "string" && value.browser.trim() ? { browser: value.browser.trim() } : {}),
        ...(activationEvents.length > 0 ? { activationEvents } : {}),
        ...(extensionKind.length > 0 ? { extensionKind } : {}),
        ...(engines ? { engines } : {}),
        ...(hasExtensionContributionSummary(contributionSummary) ? { contributes: contributionSummary } : {}),
      };
    }
  }
  return null;
}

async function getNestedFileHandle(root: FileSystemDirectoryHandle, relativePath: string): Promise<FileSystemFileHandle | null> {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter((part) => Boolean(part) && part !== ".");
  if (parts.length === 0) return null;

  let directory = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const nextDirectory = await getOptionalDirectoryHandle(directory, parts[index]);
    if (!nextDirectory) return null;
    directory = nextDirectory;
  }

  return getOptionalFileHandle(directory, parts[parts.length - 1]);
}

function buildLanguageAssociationSettings(languages: VSCodeExtensionLanguageContribution[]): VSCodeSettings {
  const associations: Record<string, string> = {};
  for (const language of languages) {
    for (const extension of language.extensions) {
      associations[`*${extension}`] = language.id;
    }
    for (const filename of language.filenames) {
      associations[filename] = language.id;
    }
  }
  return Object.keys(associations).length > 0 ? { "files.associations": associations } : {};
}

async function readExtensionSnippetContributions(
  directory: FileSystemDirectoryHandle,
  extension: VSCodeExtensionInventoryEntry,
  warnings: string[],
): Promise<Record<string, VSCodeSnippetFile | VSCodeSnippet>> {
  const snippets: Record<string, VSCodeSnippetFile | VSCodeSnippet> = {};
  const contributions = extension.contributes?.snippets ?? [];
  for (const contribution of contributions) {
    try {
      const handle = await getNestedFileHandle(directory, contribution.path);
      if (!handle) {
        warnings.push(`Could not find VS Code extension snippet ${extension.id}/${contribution.path}`);
        continue;
      }
      const parsed = await readJsonFileHandle(handle);
      const snippetFile = normalizeSnippetFile(parsed);
      const scopeName = `${extension.id}:${contribution.language}`;
      const existingScope = isObject(snippets[scopeName]) && !("prefix" in (snippets[scopeName] as Record<string, unknown>))
        ? snippets[scopeName] as VSCodeSnippetFile
        : {};
      snippets[scopeName] = {
        ...existingScope,
        ...snippetFile,
      };
    } catch (error) {
      warnings.push(`Could not read VS Code extension snippet ${extension.id}/${contribution.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return snippets;
}

async function readSnippetsFromDirectory(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  warnings: string[],
): Promise<Record<string, VSCodeSnippetFile | VSCodeSnippet>> {
  const snippets: Record<string, VSCodeSnippetFile | VSCodeSnippet> = {};

  for await (const entry of directory.values()) {
    if (entry.kind !== "file" || !entry.name.toLowerCase().endsWith(".json")) {
      continue;
    }

    try {
      const parsed = await readJsonFileHandle(entry as FileSystemFileHandle);
      const snippetFile = normalizeSnippetFile(parsed);
      for (const [name, snippet] of Object.entries(snippetFile)) {
        snippets[`${prefix}:${name}`] = snippet;
      }
    } catch (error) {
      warnings.push(`Could not read VS Code snippet file ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return snippets;
}

function appendDiscovered(discoveredFiles: string[], path: string, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  discoveredFiles.push(path);
  return true;
}

export async function readTextFile(file: File): Promise<string> {
  return file.text();
}

export async function parseVSCodeSettingsJsonText(text: string): Promise<VSCodeSettingsFile> {
  const parsed = parseJsonLike(text);
  return normalizeSettingsPayload(parsed);
}

export async function readVSCodeSettingsFile(file: File): Promise<VSCodeSettingsFile> {
  const text = await readTextFile(file);
  return parseVSCodeSettingsJsonText(text);
}

export async function readVSCodeConfigFromDirectory(root: FileSystemDirectoryHandle): Promise<VSCodeDirectoryImportResult> {
  const warnings: string[] = [];
  const discoveredFiles: string[] = [];
  let config: VSCodeSettingsFile = {};

  const vscodeDirectory = root.name === ".vscode" ? root : await getOptionalDirectoryHandle(root, ".vscode");
  const userDirectory = root.name === "User" ? root : await getOptionalDirectoryHandle(root, "User");
  const candidateConfigDirectories: Array<{ label: string; handle: FileSystemDirectoryHandle; includeTasks: boolean }> = [
    ...(userDirectory ? [{ label: "User", handle: userDirectory, includeTasks: false }] : []),
    ...(vscodeDirectory ? [{ label: ".vscode", handle: vscodeDirectory, includeTasks: true }] : []),
  ];

  const seen = new Set<FileSystemDirectoryHandle>();
  for (const candidate of candidateConfigDirectories) {
    if (seen.has(candidate.handle)) continue;
    seen.add(candidate.handle);

    try {
      const settings = await readKnownConfigFile(candidate.handle, "settings.json");
      if (appendDiscovered(discoveredFiles, `${candidate.label}/settings.json`, settings)) {
        config = mergeVSCodeSettingsFiles(config, { settings: normalizeSettingsPayload(settings).settings ?? {} });
      }
    } catch (error) {
      warnings.push(`Could not read ${candidate.label}/settings.json: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const keybindings = await readKnownConfigFile(candidate.handle, "keybindings.json");
      if (appendDiscovered(discoveredFiles, `${candidate.label}/keybindings.json`, keybindings)) {
        config = mergeVSCodeSettingsFiles(config, normalizeSettingsPayload(keybindings));
      }
    } catch (error) {
      warnings.push(`Could not read ${candidate.label}/keybindings.json: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (candidate.includeTasks) {
      try {
        const tasks = await readKnownConfigFile(candidate.handle, "tasks.json");
        if (appendDiscovered(discoveredFiles, `${candidate.label}/tasks.json`, tasks)) {
          config = mergeVSCodeSettingsFiles(config, { tasks: normalizeSettingsPayload(tasks).tasks ?? null });
        }
      } catch (error) {
        warnings.push(`Could not read ${candidate.label}/tasks.json: ${error instanceof Error ? error.message : String(error)}`);
      }

      try {
        const launch = await readKnownConfigFile(candidate.handle, "launch.json");
        if (appendDiscovered(discoveredFiles, `${candidate.label}/launch.json`, launch)) {
          config = mergeVSCodeSettingsFiles(config, { launch: normalizeSettingsPayload(launch).launch ?? null });
        }
      } catch (error) {
        warnings.push(`Could not read ${candidate.label}/launch.json: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const snippetsDirectory = await getOptionalDirectoryHandle(candidate.handle, "snippets");
    if (snippetsDirectory) {
      const snippets = await readSnippetsFromDirectory(snippetsDirectory, candidate.label, warnings);
      if (Object.keys(snippets).length > 0) {
        discoveredFiles.push(`${candidate.label}/snippets/*.json`);
        config = mergeVSCodeSettingsFiles(config, { snippets });
      }
    }

    if (candidate.includeTasks) {
      try {
        const extensions = await readKnownConfigFile(candidate.handle, "extensions.json");
        const recommendedExtensions = normalizeRecommendedExtensions(extensions);
        if (appendDiscovered(discoveredFiles, `${candidate.label}/extensions.json`, extensions) && recommendedExtensions.length > 0) {
          config = mergeVSCodeSettingsFiles(config, { extensions: recommendedExtensions });
        }
      } catch (error) {
        warnings.push(`Could not read ${candidate.label}/extensions.json: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (root.name === "snippets") {
    const snippets = await readSnippetsFromDirectory(root, root.name, warnings);
    if (Object.keys(snippets).length > 0) {
      discoveredFiles.push("snippets/*.json");
      config = mergeVSCodeSettingsFiles(config, { snippets });
    }
  }

  if (root.name === "extensions") {
    const extensionConfig = await readVSCodeExtensionConfigFromDirectory(root, warnings);
    if ((extensionConfig.extensions?.length ?? 0) > 0) {
      discoveredFiles.push("extensions/*/package.json");
      if (Object.keys(extensionConfig.settings?.["files.associations"] ?? {}).length > 0) {
        discoveredFiles.push("extensions/*/contributes.languages");
      }
      if (Object.keys(extensionConfig.snippets ?? {}).length > 0) {
        discoveredFiles.push("extensions/*/contributes.snippets");
      }
      config = mergeVSCodeSettingsFiles(config, extensionConfig);
    }
  }

  if (discoveredFiles.length === 0) {
    warnings.push("No VS Code settings, keybindings, snippets, tasks, or extensions were found in the selected folder.");
  }

  return {
    config,
    sourceLabel: `${root.name} (${discoveredFiles.length} VS Code file${discoveredFiles.length === 1 ? "" : "s"})`,
    discoveredFiles,
    warnings,
  };
}

export async function readVSCodeExtensionConfigFromDirectory(
  root: FileSystemDirectoryHandle,
  warnings: string[] = [],
): Promise<VSCodeSettingsFile> {
  const extensions: VSCodeExtensionInventoryEntry[] = [];
  let settings: VSCodeSettings = {};
  let snippets: Record<string, VSCodeSnippetFile | VSCodeSnippet> = {};

  for await (const entry of root.values()) {
    if (entry.kind !== "directory") continue;

    const directory = entry as FileSystemDirectoryHandle;
    if (directory.name.startsWith(".")) {
      continue;
    }
    try {
      const packageJson = await readKnownConfigFile(directory, "package.json");
      if (!packageJson) {
        if (!directory.name.startsWith(".")) {
          warnings.push(`Could not read VS Code extension ${directory.name}: package.json not found`);
        }
        continue;
      }
      const extensionPath = getDesktopHandlePath(directory) ?? directory.name;
      const localization = await readExtensionLocalization(directory);
      const normalized = normalizeInstalledExtensionFromPackage(
        packageJson,
        extensionPath,
        localization,
      );
      if (normalized) {
        extensions.push(normalized);
        const languageSettings = buildLanguageAssociationSettings(normalized.contributes?.languages ?? []);
        settings = {
          ...settings,
          ...languageSettings,
          "files.associations": {
            ...((settings["files.associations"] as Record<string, string> | undefined) ?? {}),
            ...((languageSettings["files.associations"] as Record<string, string> | undefined) ?? {}),
          },
        };
        const extensionSnippets = await readExtensionSnippetContributions(directory, normalized, warnings);
        snippets = {
          ...snippets,
          ...extensionSnippets,
        };
      }
    } catch (error) {
      warnings.push(`Could not read VS Code extension ${directory.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    settings,
    snippets,
    extensions: dedupeExtensionInventoryEntries(extensions),
  };
}

export async function readVSCodeExtensionsFromDirectory(
  root: FileSystemDirectoryHandle,
  warnings: string[] = [],
): Promise<VSCodeExtensionInventoryEntry[]> {
  const config = await readVSCodeExtensionConfigFromDirectory(root, warnings);
  return config.extensions ?? [];
}
