import {
  getVSCodeActivityEntries,
  type VSCodeActivityEntry,
  type VSCodeRunnableCommand,
} from "@/lib/vscode-compat/extensions";
import type { VSCodeExtensionInventoryEntry } from "@/lib/vscode-compat/types";
import type {
  VSCodeHostExtensionState,
  VSCodeHostSnapshot,
  VSCodeHostView,
} from "@/lib/vscode-extension-host/types";

export type VSCodeBuiltInContainerId = "explorer" | "scm" | "debug" | "test";

export interface VSCodeContributionView {
  id: string;
  title: string;
  extensionId: string;
  container: string;
  kind?: VSCodeHostView["kind"];
  status: "unresolved" | "registered";
}

export interface VSCodeContributionContainer {
  id: string;
  title: string;
  extensionId: string;
  extensionLabel: string;
  icon?: string;
  extensionPath?: string;
  status: "starting" | "ready";
  views: VSCodeContributionView[];
  commands: VSCodeRunnableCommand[];
}

export interface VSCodeContributionDiagnostic {
  extensionId: string;
  extensionLabel: string;
  status: VSCodeHostExtensionState["status"] | "warning";
  code?: "duplicate-container";
  error?: string;
  missingApi: string[];
}

export interface VSCodeContributionRegistry {
  containers: VSCodeContributionContainer[];
  builtInViews: Partial<Record<VSCodeBuiltInContainerId, VSCodeContributionView[]>>;
  diagnostics: VSCodeContributionDiagnostic[];
}

const BUILT_IN_CONTAINERS = new Set<VSCodeBuiltInContainerId>([
  "explorer",
  "scm",
  "debug",
  "test",
]);

function toContributionViews(
  entry: VSCodeActivityEntry,
  hostViews: Map<string, VSCodeHostView>,
): VSCodeContributionView[] {
  return entry.views.map((view) => {
    const registered = hostViews.get(view.id);
    return {
      id: view.id,
      title: registered?.title || view.name,
      extensionId: entry.extensionId,
      container: registered?.container || entry.id,
      ...(registered ? { kind: registered.kind } : {}),
      status: registered ? "registered" : "unresolved",
    };
  });
}

function contextValue(value: string): unknown {
  const normalized = value.trim();
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    return normalized.slice(1, -1);
  }
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (normalized === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  return normalized;
}

function evaluateWhenAtom(atom: string, contextKeys: Record<string, unknown>): boolean {
  const expression = atom.trim();
  const comparison = expression.match(/^([\w.:-]+)\s*(===|!==|==|!=)\s*(.+)$/);
  if (comparison) {
    const [, key, operator, rawExpected] = comparison;
    const actual = contextKeys[key];
    const expected = contextValue(rawExpected);
    return operator === "!=" || operator === "!==" ? actual !== expected : actual === expected;
  }
  const negated = expression.match(/^!\s*([\w.:-]+)$/);
  if (negated) return !Boolean(contextKeys[negated[1]]);
  if (/^[\w.:-]+$/.test(expression)) return Boolean(contextKeys[expression]);

  // Unknown clauses stay visible; hiding a contribution incorrectly is worse than showing it.
  return true;
}

function matchesWhenClause(when: string | undefined, contextKeys: Record<string, unknown> | undefined): boolean {
  if (!when || !contextKeys) return true;
  return when
    .split(/\s*\|\|\s*/)
    .some((branch) => branch
      .split(/\s*&&\s*/)
      .every((atom) => evaluateWhenAtom(atom, contextKeys)));
}

function extensionDiagnostic(
  state: VSCodeHostExtensionState,
  labels: Map<string, string>,
): VSCodeContributionDiagnostic | null {
  if (state.status !== "failed" && !state.error && (state.missingApi?.length ?? 0) === 0) {
    return null;
  }
  return {
    extensionId: state.id,
    extensionLabel: state.displayName || labels.get(state.id) || state.id,
    status: state.status,
    ...(state.error ? { error: state.error } : {}),
    missingApi: state.missingApi ?? [],
  };
}

export function buildVSCodeContributionRegistry(
  extensions: VSCodeExtensionInventoryEntry[],
  snapshot: VSCodeHostSnapshot,
): VSCodeContributionRegistry {
  const result: VSCodeContributionRegistry = {
    containers: [],
    builtInViews: {},
    diagnostics: [],
  };
  const labels = new Map(extensions.map((extension) => [
    extension.id,
    extension.displayName || extension.id,
  ]));
  const hostViews = new Map(snapshot.views.map((view) => [view.id, view]));
  const hostExtensions = new Map(snapshot.extensions.map((extension) => [extension.id, extension]));
  const containerIndexes = new Map<string, number>();

  for (const state of snapshot.extensions) {
    const diagnostic = extensionDiagnostic(state, labels);
    if (diagnostic) result.diagnostics.push(diagnostic);
  }

  if (snapshot.status === "error" || snapshot.status === "unavailable" || snapshot.status === "idle") {
    return result;
  }

  for (const entry of getVSCodeActivityEntries(extensions)) {
    if (!matchesWhenClause(entry.when, snapshot.contextKeys)) continue;
    const visibleEntry = {
      ...entry,
      views: entry.views.filter((view) => matchesWhenClause(view.when, snapshot.contextKeys)),
    };
    if (visibleEntry.views.length === 0) continue;

    const extensionState = hostExtensions.get(entry.extensionId);
    if (extensionState?.status === "failed") continue;

    const views = toContributionViews(visibleEntry, hostViews);
    if (BUILT_IN_CONTAINERS.has(visibleEntry.id as VSCodeBuiltInContainerId)) {
      const containerId = visibleEntry.id as VSCodeBuiltInContainerId;
      result.builtInViews[containerId] = [
        ...(result.builtInViews[containerId] ?? []),
        ...views,
      ];
      continue;
    }

    const containerKey = `${visibleEntry.extensionId}:${visibleEntry.id}`;
    const existingIndex = containerIndexes.get(containerKey);
    if (existingIndex !== undefined) {
      const existing = result.containers[existingIndex];
      const viewIds = new Set(existing.views.map((view) => view.id));
      const commandIds = new Set(existing.commands.map((command) => command.id));
      existing.views.push(...views.filter((view) => !viewIds.has(view.id)));
      existing.commands.push(...visibleEntry.commands.filter((command) => !commandIds.has(command.id)));
      continue;
    }
    containerIndexes.set(containerKey, result.containers.length);

    result.containers.push({
      id: visibleEntry.id,
      title: visibleEntry.title,
      extensionId: visibleEntry.extensionId,
      extensionLabel: visibleEntry.extensionLabel,
      ...(visibleEntry.icon ? { icon: visibleEntry.icon } : {}),
      ...(visibleEntry.extensionPath ? { extensionPath: visibleEntry.extensionPath } : {}),
      status: snapshot.status === "starting" ? "starting" : "ready",
      views,
      commands: visibleEntry.commands,
    });
  }

  return result;
}
