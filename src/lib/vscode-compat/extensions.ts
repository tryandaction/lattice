import type {
  VSCodeExtensionCommandContribution,
  VSCodeExtensionInventoryEntry,
} from "./types";

export interface VSCodeRunnableCommand {
  id: string;
  title: string;
  extensionId: string;
  extensionLabel: string;
  category?: string;
}

export interface VSCodeActivityEntry {
  id: string;
  title: string;
  extensionId: string;
  extensionLabel: string;
  icon?: string;
  extensionPath?: string;
  when?: string;
  views: Array<{ id: string; name: string; when?: string }>;
  commands: VSCodeRunnableCommand[];
}

export type VSCodeExtensionPrimaryCapability =
  | "runnable"
  | "command-capable"
  | "view-capable"
  | "debug-capable"
  | "notebook-capable"
  | "grammar-theme-only"
  | "inventory-only";

export interface VSCodeExtensionCapability {
  primary: VSCodeExtensionPrimaryCapability;
  runnable: boolean;
  commandCapable: boolean;
  viewCapable: boolean;
  debugCapable: boolean;
  notebookCapable: boolean;
  grammarThemeOnly: boolean;
  inventoryOnly: boolean;
}

function normalizeString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isVSCodeNlsPlaceholder(value: string | null | undefined): boolean {
  return typeof value === "string" && /^%[^%\s][^%]*%$/.test(value.trim());
}

function readableLabelFromIdentifier(value: string): string {
  const source = value.includes(".") ? value.split(".").pop() ?? value : value;
  return source
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || value;
}

function normalizeVSCodeLabel(value: string | null | undefined, fallback: string): string {
  const normalized = normalizeString(value);
  if (!normalized || isVSCodeNlsPlaceholder(normalized)) {
    return fallback.includes(".") ? fallback : readableLabelFromIdentifier(fallback);
  }
  return normalized;
}

function normalizeStringArray(value: string[] | null | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function compareExtensionVersions(left: string | undefined, right: string | undefined): number {
  return (left ?? "").localeCompare(right ?? "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function resolveExtensionAssetPath(basePath: string | undefined, assetPath: string | undefined): string | undefined {
  const normalizedAsset = normalizeString(assetPath)?.replace(/\\/g, "/");
  if (!normalizedAsset || /^\$\([^)]+\)$/.test(normalizedAsset)) return undefined;
  if (/^(?:https?:|data:|file:)/i.test(normalizedAsset) || isAbsoluteVSCodeExtensionPath(normalizedAsset)) {
    return normalizedAsset;
  }
  const normalizedBase = normalizeString(basePath)?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedBase) return normalizedAsset;
  return `${normalizedBase}/${normalizedAsset.replace(/^\.?\/+/, "")}`;
}

function normalizeCommandItems(
  value: VSCodeExtensionCommandContribution[] | null | undefined,
): VSCodeExtensionCommandContribution[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item) => {
    const command = normalizeString(item?.command);
    if (!command) {
      return [];
    }
    const title = normalizeVSCodeLabel(item?.title, readableLabelFromIdentifier(command));
    const category = normalizeString(item?.category);
    return [{ command, title, ...(category && !isVSCodeNlsPlaceholder(category) ? { category } : {}) }];
  });
  return items.length > 0 ? items : undefined;
}

export function isAbsoluteVSCodeExtensionPath(path: string | null | undefined): boolean {
  const normalized = normalizeString(path);
  if (!normalized) return false;
  return /^[a-zA-Z]:[\\/]/.test(normalized) || normalized.startsWith("/") || normalized.startsWith("\\\\");
}

function hasContributionMetadata(extension: VSCodeExtensionInventoryEntry): boolean {
  const contributes = extension.contributes;
  return Boolean(
    contributes &&
    (
      (contributes.commandItems?.length ?? 0) > 0 ||
      (contributes.views?.length ?? 0) > 0 ||
      (contributes.notebooks?.length ?? 0) > 0 ||
      (contributes.notebookRenderers?.length ?? 0) > 0 ||
      (contributes.languages?.length ?? 0) > 0 ||
      (contributes.grammars?.length ?? 0) > 0 ||
      (contributes.themes?.length ?? 0) > 0
    )
  );
}

function hasUsefulInstalledMetadata(extension: VSCodeExtensionInventoryEntry): boolean {
  return Boolean(
    normalizeString(extension.displayName) ||
    normalizeString(extension.version) ||
    normalizeString(extension.main) ||
    normalizeString(extension.browser) ||
    (normalizeStringArray(extension.activationEvents)?.length ?? 0) > 0 ||
    (normalizeStringArray(extension.extensionKind)?.length ?? 0) > 0 ||
    (Array.isArray(extension.categories) && extension.categories.length > 0) ||
    hasContributionMetadata(extension) ||
    isAbsoluteVSCodeExtensionPath(extension.path)
  );
}

function isPriorityAgentExtension(extension: VSCodeExtensionInventoryEntry): boolean {
  return /(codex|chatgpt|claude|cline|roo|augment)/i.test(`${extension.id} ${extension.displayName ?? ""}`);
}

export function normalizeVSCodeExtensionInventory(
  entries: VSCodeExtensionInventoryEntry[],
): VSCodeExtensionInventoryEntry[] {
  const byKey = new Map<string, VSCodeExtensionInventoryEntry>();

  for (const entry of entries) {
    const id = normalizeString(entry?.id)?.toLowerCase();
    if (!id || !id.includes(".")) {
      continue;
    }

    const source = entry.source === "recommended" ? "recommended" : "installed";
    const path = normalizeString(entry.path);
    const displayName = normalizeString(entry.displayName);
    const icon = resolveExtensionAssetPath(path, entry.icon);
    const version = normalizeString(entry.version);
    const categories = Array.isArray(entry.categories)
      ? entry.categories.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined;
    const main = normalizeString(entry.main);
    const browser = normalizeString(entry.browser);
    const activationEvents = normalizeStringArray(entry.activationEvents);
    const extensionKind = normalizeStringArray(entry.extensionKind);
    const commandItems = normalizeCommandItems(entry.contributes?.commandItems);

    const normalized: VSCodeExtensionInventoryEntry = {
      id,
      source,
      ...(path ? { path } : {}),
      ...(displayName && !isVSCodeNlsPlaceholder(displayName) ? { displayName } : {}),
      ...(icon ? { icon } : {}),
      ...(version ? { version } : {}),
      ...(categories && categories.length > 0 ? { categories } : {}),
      ...(main ? { main } : {}),
      ...(browser ? { browser } : {}),
      ...(activationEvents ? { activationEvents } : {}),
      ...(extensionKind ? { extensionKind } : {}),
      ...(entry.engines ? { engines: entry.engines } : {}),
      ...(entry.contributes ? {
        contributes: {
          ...entry.contributes,
          commands: commandItems?.length ?? entry.contributes.commands ?? 0,
          commandItems: commandItems ?? [],
          views: (entry.contributes.views ?? []).map((view) => ({
            ...view,
            name: normalizeVSCodeLabel(view.name, readableLabelFromIdentifier(view.id)),
          })),
          viewContainerItems: (entry.contributes.viewContainerItems ?? []).map((container) => {
            const containerIcon = resolveExtensionAssetPath(path, container.icon);
            const normalizedContainer = {
              ...container,
              title: normalizeVSCodeLabel(container.title, readableLabelFromIdentifier(container.id)),
            };
            if (containerIcon) normalizedContainer.icon = containerIcon;
            else delete normalizedContainer.icon;
            return normalizedContainer;
          }),
        },
      } : {}),
    };

    if (source === "installed" && !hasUsefulInstalledMetadata(normalized)) {
      continue;
    }

    const key = `${source}:${id}`;
    const existing = byKey.get(key);
    if (existing && compareExtensionVersions(normalized.version, existing.version) < 0) {
      continue;
    }
    byKey.set(key, normalized);
  }

  return Array.from(byKey.values());
}

export function isRunnableVSCodeExtension(extension: VSCodeExtensionInventoryEntry): boolean {
  return isAbsoluteVSCodeExtensionPath(extension.path) && Boolean(normalizeString(extension.main));
}

export function classifyVSCodeExtensionCapability(
  extension: VSCodeExtensionInventoryEntry,
): VSCodeExtensionCapability {
  const contributes = extension.contributes;
  const runnable = isRunnableVSCodeExtension(extension);
  const commandCapable = (contributes?.commandItems.length ?? 0) > 0;
  const viewCapable = (contributes?.views.length ?? 0) > 0 || (contributes?.viewContainerItems?.length ?? 0) > 0;
  const debugCapable = (contributes?.debuggers ?? 0) > 0;
  const notebookCapable = (contributes?.notebooks.length ?? 0) > 0 || (contributes?.notebookRenderers.length ?? 0) > 0;
  const grammarThemeOnly = !runnable && !commandCapable && !viewCapable && !debugCapable && !notebookCapable &&
    ((contributes?.grammars.length ?? 0) > 0 || (contributes?.themes.length ?? 0) > 0);
  const inventoryOnly = !runnable && !commandCapable && !viewCapable && !debugCapable && !notebookCapable && !grammarThemeOnly;
  const primary: VSCodeExtensionPrimaryCapability = viewCapable
    ? "view-capable"
    : commandCapable
      ? "command-capable"
      : debugCapable
        ? "debug-capable"
        : notebookCapable
          ? "notebook-capable"
          : runnable
            ? "runnable"
            : grammarThemeOnly
              ? "grammar-theme-only"
              : "inventory-only";

  return {
    primary,
    runnable,
    commandCapable,
    viewCapable,
    debugCapable,
    notebookCapable,
    grammarThemeOnly,
    inventoryOnly,
  };
}

function extensionPriority(extension: VSCodeExtensionInventoryEntry): number {
  const commands = extension.contributes?.commandItems?.length ?? 0;
  const views = extension.contributes?.views?.length ?? 0;
  const notebooks = (extension.contributes?.notebooks?.length ?? 0) + (extension.contributes?.notebookRenderers?.length ?? 0);
  return (isPriorityAgentExtension(extension) ? 50_000 : 0) + (views + notebooks > 0 ? 10_000 : 0) + (commands * 100) + (views * 10) + notebooks;
}

export function getRunnableVSCodeExtensions(
  entries: VSCodeExtensionInventoryEntry[],
): VSCodeExtensionInventoryEntry[] {
  return normalizeVSCodeExtensionInventory(entries)
    .filter(isRunnableVSCodeExtension)
    .sort((left, right) => {
      const priorityDiff = extensionPriority(right) - extensionPriority(left);
      if (priorityDiff !== 0) return priorityDiff;
      return (left.displayName ?? left.id).localeCompare(right.displayName ?? right.id);
    });
}

export function getRunnableVSCodeCommands(
  entries: VSCodeExtensionInventoryEntry[],
): VSCodeRunnableCommand[] {
  const commands = getRunnableVSCodeExtensions(entries).flatMap((extension) =>
    (extension.contributes?.commandItems ?? []).map((command) => ({
      id: command.command,
      title: command.title,
      ...(command.category ? { category: command.category } : {}),
      extensionId: extension.id,
      extensionLabel: extension.displayName ?? extension.id,
    })),
  );

  const seen = new Set<string>();
  return commands
    .filter((command) => {
      if (seen.has(command.id)) {
        return false;
      }
      seen.add(command.id);
      return true;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getVSCodeActivityEntries(entries: VSCodeExtensionInventoryEntry[]): VSCodeActivityEntry[] {
  return getRunnableVSCodeExtensions(entries)
    .flatMap((extension) => {
      if (!classifyVSCodeExtensionCapability(extension).viewCapable) {
        return [];
      }
      const containers = extension.contributes?.viewContainerItems ?? [];
      const views = extension.contributes?.views ?? [];
      const commands = (extension.contributes?.commandItems ?? []).map((command) => ({
        id: command.command,
        title: command.title,
        ...(command.category ? { category: command.category } : {}),
        extensionId: extension.id,
        extensionLabel: extension.displayName ?? extension.id,
      }));

      if (containers.length > 0) {
        return containers
          .filter((container) => container.location === "activitybar" || views.some((view) => view.container === container.id))
          .map((container) => ({
            id: container.id,
            title: container.title,
            ...(container.icon || extension.icon ? { icon: container.icon ?? extension.icon } : {}),
            ...(extension.path ? { extensionPath: extension.path } : {}),
            ...(container.when ? { when: container.when } : {}),
            extensionId: extension.id,
            extensionLabel: extension.displayName ?? extension.id,
            views: views
              .filter((view) => view.container === container.id)
              .map((view) => ({
                id: view.id,
                name: view.name,
                ...(view.when ? { when: view.when } : {}),
              })),
            commands,
          }));
      }

      if (views.length > 0) {
        const groupedViews = new Map<string, typeof views>();
        for (const view of views) {
          const container = view.container ?? extension.id;
          const existing = groupedViews.get(container);
          if (existing) {
            existing.push(view);
          } else {
            groupedViews.set(container, [view]);
          }
        }

        return Array.from(groupedViews, ([container, containerViews]) => ({
          id: container,
          title: extension.displayName ?? extension.id,
          extensionId: extension.id,
          extensionLabel: extension.displayName ?? extension.id,
          ...(extension.path ? { extensionPath: extension.path } : {}),
          views: containerViews.map((view) => ({
            id: view.id,
            name: view.name,
            ...(view.when ? { when: view.when } : {}),
          })),
          commands,
        }));
      }

      if (commands.length > 0) {
        return [{
          id: extension.id,
          title: extension.displayName ?? extension.id,
          extensionId: extension.id,
          extensionLabel: extension.displayName ?? extension.id,
          ...(extension.path ? { extensionPath: extension.path } : {}),
          views: [],
          commands,
        }];
      }

      return [];
    })
    .sort((left, right) => {
      const agentDiff = Number(isPriorityAgentEntry(right)) - Number(isPriorityAgentEntry(left));
      if (agentDiff !== 0) return agentDiff;
      const viewDiff = right.views.length - left.views.length;
      if (viewDiff !== 0) return viewDiff;
      const commandDiff = right.commands.length - left.commands.length;
      if (commandDiff !== 0) return commandDiff;
      return left.title.localeCompare(right.title);
    });
}

function isPriorityAgentEntry(entry: VSCodeActivityEntry): boolean {
  return /(codex|chatgpt|claude|cline|roo|augment)/i.test(`${entry.extensionId} ${entry.title} ${entry.extensionLabel}`);
}

export function shouldRepairVSCodeExtensionImport(
  entries: VSCodeExtensionInventoryEntry[],
): boolean {
  const normalized = normalizeVSCodeExtensionInventory(entries);
  const installed = normalized.filter((entry) => entry.source === "installed");
  if (installed.length === 0) {
    return false;
  }

  if (installed.some((entry) => normalizeString(entry.path) && !isAbsoluteVSCodeExtensionPath(entry.path))) {
    return true;
  }

  if (installed.some((entry) => normalizeString(entry.main) && !normalizeString(entry.path))) {
    return true;
  }

  if (installed.some((entry) => !hasUsefulInstalledMetadata(entry))) {
    return true;
  }

  const runnable = installed.filter(isRunnableVSCodeExtension);
  const contributionCount = runnable.reduce((total, extension) => {
    const contributes = extension.contributes;
    if (!contributes) return total;
    return total +
      (contributes.commandItems?.length ?? 0) +
      (contributes.views?.length ?? 0) +
      (contributes.viewContainers?.length ?? 0) +
      (contributes.viewContainerItems?.length ?? 0) +
      (contributes.notebooks?.length ?? 0) +
      (contributes.notebookRenderers?.length ?? 0) +
      (contributes.grammars?.length ?? 0) +
      (contributes.languages?.length ?? 0);
  }, 0);
  if (runnable.length >= 3 && contributionCount === 0) {
    return true;
  }

  return installed.every((entry) => !isRunnableVSCodeExtension(entry) && !normalizeString(entry.browser));
}
