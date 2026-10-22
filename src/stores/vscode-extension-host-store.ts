"use client";

import { create } from "zustand";
import type { VSCodeExtensionInventoryEntry, VSCodeWorkbenchSettings } from "@/lib/vscode-compat/types";
import {
  getRunnableVSCodeExtensions,
} from "@/lib/vscode-compat/extensions";
import {
  activateVSCodeExtensionHostExtension,
  activateVSCodeExtensionHostView,
  canUseVSCodeExtensionHost,
  changeVSCodeExtensionHostDocument,
  drainVSCodeExtensionHostViewMessages,
  getVSCodeExtensionHostSnapshot,
  openVSCodeExtensionHostDocument,
  postVSCodeExtensionHostViewMessage,
  requestVSCodeExtensionHostLanguageFeature,
  resolveVSCodeExtensionHostTree,
  resolveVSCodeExtensionHostInteraction,
  resolveVSCodeExtensionHostView,
  runVSCodeExtensionHostCommand,
  saveVSCodeExtensionHostDocument,
  startVSCodeExtensionHost,
  stopVSCodeExtensionHost,
} from "@/lib/vscode-extension-host/desktop";
import { buildVSCodeHostCommandCatalog } from "@/lib/vscode-extension-host/command-adapter";
import {
  EMPTY_VSCODE_HOST_SNAPSHOT,
  type VSCodeHostCommand,
  type VSCodeHostDocumentSyncRequest,
  type VSCodeHostLanguageFeatureRequest,
  type VSCodeHostLanguageFeatureResponse,
  type VSCodeHostInteraction,
  type VSCodeHostInteractionResponse,
  type VSCodeHostSnapshot,
  type VSCodeHostTreeContent,
  type VSCodeHostWebviewContent,
} from "@/lib/vscode-extension-host/types";

interface SyncInput {
  enabled: boolean;
  workspaceRootPath?: string | null;
  extensions: VSCodeExtensionInventoryEntry[];
  settings: VSCodeWorkbenchSettings;
}

interface VSCodeExtensionHostState {
  snapshot: VSCodeHostSnapshot;
  pendingInteraction: VSCodeHostInteraction | null;
  manifestCommands: VSCodeHostCommand[];
  hostExtensionCount: number;
  lastSignature: string | null;
  syncWithCompat: (input: SyncInput) => Promise<void>;
  refresh: () => Promise<void>;
  stop: () => Promise<void>;
  runCommand: (commandId: string, args?: unknown[]) => Promise<void>;
  resolveInteraction: (response: VSCodeHostInteractionResponse) => Promise<void>;
  activateExtension: (extensionId: string) => Promise<VSCodeHostSnapshot>;
  activateView: (viewId: string) => Promise<VSCodeHostSnapshot>;
  openDocument: (input: { filePath: string; languageId?: string; content?: string; version?: number }) => Promise<void>;
  changeDocument: (input: VSCodeHostDocumentSyncRequest) => Promise<void>;
  saveDocument: (input: VSCodeHostDocumentSyncRequest) => Promise<void>;
  requestLanguageFeature: (input: VSCodeHostLanguageFeatureRequest) => Promise<VSCodeHostLanguageFeatureResponse>;
  resolveView: (viewId: string) => Promise<VSCodeHostWebviewContent>;
  resolveTree: (viewId: string) => Promise<VSCodeHostTreeContent>;
  postViewMessage: (viewId: string, message: unknown) => Promise<unknown[]>;
  drainViewMessages: (viewId: string) => Promise<unknown[]>;
}

function buildHostExtensions(extensions: VSCodeExtensionInventoryEntry[]) {
  return getRunnableVSCodeExtensions(extensions).flatMap((extension) => {
    const path = extension.path?.trim();
    const main = extension.main?.trim();
    if (!path || !main) {
      return [];
    }
    return [{
      id: extension.id,
      path,
      main,
      browser: extension.browser?.trim() || undefined,
      displayName: extension.displayName?.trim() || undefined,
      packageJSON: buildHostPackageJSON(extension),
      activationEvents: extension.activationEvents ?? [],
      extensionKind: extension.extensionKind,
      commandItems: extension.contributes?.commandItems ?? [],
      viewItems: (extension.contributes?.views ?? []).map((view) => ({
        id: view.id,
        title: view.name,
        container: view.container,
      })),
    }];
  });
}

function buildHostPackageJSON(extension: VSCodeExtensionInventoryEntry): Record<string, unknown> {
  const [publisher, ...nameParts] = extension.id.split(".");
  const name = nameParts.join(".") || extension.id;
  const contributes = extension.contributes
    ? {
      commands: extension.contributes.commandItems.map((command) => ({
        command: command.command,
        title: command.title,
        ...(command.category ? { category: command.category } : {}),
      })),
      views: extension.contributes.views.reduce<Record<string, Array<{ id: string; name: string; when?: string }>>>((groups, view) => {
        const entries = groups[view.container] ?? [];
        entries.push({
          id: view.id,
          name: view.name,
          ...(view.when ? { when: view.when } : {}),
        });
        groups[view.container] = entries;
        return groups;
      }, {}),
      viewsContainers: (extension.contributes.viewContainerItems ?? []).reduce<Record<string, Array<{ id: string; title: string; icon?: string; when?: string }>>>((groups, container) => {
        const entries = groups[container.location] ?? [];
        entries.push({
          id: container.id,
          title: container.title,
          ...(container.icon ? { icon: container.icon } : {}),
          ...(container.when ? { when: container.when } : {}),
        });
        groups[container.location] = entries;
        return groups;
      }, {}),
      languages: extension.contributes.languages,
      snippets: extension.contributes.snippets,
      grammars: extension.contributes.grammars,
      themes: extension.contributes.themes,
    }
    : undefined;

  return {
    publisher,
    name,
    displayName: extension.displayName ?? extension.id,
    version: extension.version,
    icon: extension.icon,
    main: extension.main,
    browser: extension.browser,
    activationEvents: extension.activationEvents ?? [],
    extensionKind: extension.extensionKind,
    categories: extension.categories,
    ...(contributes ? { contributes } : {}),
  };
}

function buildHostConfiguration(settings: VSCodeWorkbenchSettings): Record<string, unknown> {
  return {
    "editor.tabSize": settings.tabSize,
    "editor.insertSpaces": settings.insertSpaces,
    "editor.wordWrap": settings.wordWrap,
    "editor.fontFamily": settings.fontFamily,
    "editor.fontSize": settings.fontSize,
    "editor.lineNumbers": settings.lineNumbers,
    "editor.rulers": settings.rulers,
    "editor.formatOnSave": settings.formatOnSave,
    "editor.formatOnType": settings.formatOnType,
    "editor.minimap.enabled": settings.minimapEnabled,
    "editor.quickSuggestions": settings.quickSuggestions,
    "editor.suggestOnTriggerCharacters": settings.suggestOnTriggerCharacters,
    "editor.autoClosingBrackets": settings.autoClosingBrackets,
    "editor.autoClosingQuotes": settings.autoClosingQuotes,
    "editor.autoIndent": settings.autoIndent,
    "editor.smoothScrolling": settings.smoothScrolling,
    "editor.cursorBlinking": settings.cursorBlinking,
    "editor.renderWhitespace": settings.renderWhitespace,
    "editor.snippetSuggestions": settings.snippetSuggestions,
    "files.exclude": settings.filesExclude,
    "search.exclude": settings.searchExclude,
    "files.associations": settings.filesAssociations,
    "editor.defaultFormatter": settings.defaultFormatter,
    "workbench.colorTheme": settings.colorTheme,
  };
}

function buildSignature(input: SyncInput): string {
  return JSON.stringify({
    enabled: input.enabled,
    workspaceRootPath: input.workspaceRootPath ?? null,
    configuration: buildHostConfiguration(input.settings),
    extensions: buildHostExtensions(input.extensions).map((extension) => ({
      id: extension.id,
      path: extension.path,
      main: extension.main,
      browser: extension.browser ?? null,
      packageJSON: extension.packageJSON,
      activationEvents: extension.activationEvents,
      commandItems: extension.commandItems.map((command) => command.command),
      viewItems: extension.viewItems.map((view) => view.id),
    })),
  });
}

let pendingHostStart: { signature: string; promise: Promise<void> } | null = null;
let hostSyncGeneration = 0;
let hostLifecycleTail: Promise<void> = Promise.resolve();

function enqueueHostLifecycle(operation: () => Promise<void>): Promise<void> {
  const next = hostLifecycleTail.then(operation, operation);
  hostLifecycleTail = next.catch(() => undefined);
  return next;
}

async function waitForPendingHostStart(): Promise<void> {
  const pending = pendingHostStart;
  if (pending) {
    await pending.promise;
  }
}

export const useVSCodeExtensionHostStore = create<VSCodeExtensionHostState>((set, get) => ({
  snapshot: EMPTY_VSCODE_HOST_SNAPSHOT,
  pendingInteraction: null,
  manifestCommands: [],
  hostExtensionCount: 0,
  lastSignature: null,

  syncWithCompat: async (input) => {
    const hostExtensions = buildHostExtensions(input.extensions);
    const manifestCommands = buildVSCodeHostCommandCatalog(getRunnableVSCodeExtensions(input.extensions));
    const hostExtensionCount = hostExtensions.length;

    set({ manifestCommands, hostExtensionCount });

    if (!input.enabled) {
      const syncGeneration = ++hostSyncGeneration;
      set({
        snapshot: EMPTY_VSCODE_HOST_SNAPSHOT,
        pendingInteraction: null,
        lastSignature: null,
      });
      if (canUseVSCodeExtensionHost()) {
        await enqueueHostLifecycle(async () => {
          if (syncGeneration === hostSyncGeneration) {
            await stopVSCodeExtensionHost();
          }
        });
      }
      return;
    }

    if (!canUseVSCodeExtensionHost()) {
      set({
        snapshot: {
          ...EMPTY_VSCODE_HOST_SNAPSHOT,
          status: "unavailable",
          lastError: "VS Code extension host is only available in the desktop build.",
        },
        lastSignature: null,
        pendingInteraction: null,
      });
      return;
    }

    if (hostExtensions.length === 0) {
      const syncGeneration = ++hostSyncGeneration;
      set({
        snapshot: {
          ...EMPTY_VSCODE_HOST_SNAPSHOT,
          status: "unavailable",
          lastError: "No imported VS Code extensions expose a runnable desktop main entry yet.",
        },
        lastSignature: null,
        pendingInteraction: null,
      });
      await enqueueHostLifecycle(async () => {
        if (syncGeneration === hostSyncGeneration) {
          await stopVSCodeExtensionHost();
        }
      });
      return;
    }

    const signature = buildSignature(input);
    if (pendingHostStart) {
      if (pendingHostStart.signature === signature) {
        await pendingHostStart.promise;
        return;
      }
    }
    if (get().lastSignature === signature && get().snapshot.status === "ready") {
      const snapshot = await getVSCodeExtensionHostSnapshot();
      set({ snapshot, manifestCommands, hostExtensionCount });
      return;
    }

    const syncGeneration = ++hostSyncGeneration;
    if (pendingHostStart) {
      await pendingHostStart.promise.catch(() => undefined);
    }

    set({
      snapshot: {
        ...get().snapshot,
        status: "starting",
        runtime: get().snapshot.runtime === "none" ? "node" : get().snapshot.runtime,
        lastError: null,
      },
    });

    const promise = (async () => {
      await enqueueHostLifecycle(async () => {
        if (syncGeneration !== hostSyncGeneration) return;
        try {
          const snapshot = await startVSCodeExtensionHost({
            workspaceRootPath: input.workspaceRootPath ?? null,
            configuration: buildHostConfiguration(input.settings),
            extensions: hostExtensions,
          });
          if (syncGeneration !== hostSyncGeneration) return;
          set({
            snapshot,
            pendingInteraction: null,
            manifestCommands,
            hostExtensionCount,
            lastSignature: signature,
          });
        } catch (error) {
          if (syncGeneration !== hostSyncGeneration) return;
          const lastError = error instanceof Error ? error.message : String(error);
          set({
            snapshot: {
              ...EMPTY_VSCODE_HOST_SNAPSHOT,
              status: "error",
              runtime: "node",
              lastError,
            },
            manifestCommands,
            hostExtensionCount,
            lastSignature: null,
            pendingInteraction: null,
          });
          throw error;
        }
      });
    })();
    pendingHostStart = { signature, promise };
    try {
      await promise;
    } finally {
      if (pendingHostStart?.promise === promise) {
        pendingHostStart = null;
      }
    }
  },

  refresh: async () => {
    if (!canUseVSCodeExtensionHost()) {
      return;
    }
    const snapshot = await getVSCodeExtensionHostSnapshot();
    set({ snapshot });
  },

  stop: async () => {
    const syncGeneration = ++hostSyncGeneration;
    if (!canUseVSCodeExtensionHost()) {
      set({
        snapshot: EMPTY_VSCODE_HOST_SNAPSHOT,
        pendingInteraction: null,
        lastSignature: null,
      });
      return;
    }
    let snapshot = EMPTY_VSCODE_HOST_SNAPSHOT;
    await enqueueHostLifecycle(async () => {
      if (syncGeneration !== hostSyncGeneration) return;
      snapshot = await stopVSCodeExtensionHost();
    });
    if (syncGeneration === hostSyncGeneration) {
      set({
        snapshot,
        pendingInteraction: null,
        lastSignature: null,
      });
    }
  },

  runCommand: async (commandId, args = []) => {
    await waitForPendingHostStart();
    const result = await runVSCodeExtensionHostCommand(commandId, args);
    set({
      snapshot: result.snapshot,
      pendingInteraction: result.interaction ?? null,
    });
  },

  resolveInteraction: async (response) => {
    await waitForPendingHostStart();
    const result = await resolveVSCodeExtensionHostInteraction(response);
    set({
      snapshot: result.snapshot,
      pendingInteraction: result.interaction ?? null,
    });
  },

  activateExtension: async (extensionId) => {
    await waitForPendingHostStart();
    const snapshot = await activateVSCodeExtensionHostExtension(extensionId);
    set({ snapshot });
    return snapshot;
  },

  activateView: async (viewId) => {
    await waitForPendingHostStart();
    const snapshot = await activateVSCodeExtensionHostView(viewId);
    set({ snapshot });
    if (!snapshot.views.some((view) => view.id === viewId)) {
      throw new Error(snapshot.lastError || `VS Code view did not register after activation: ${viewId}`);
    }
    return snapshot;
  },

  openDocument: async (input) => {
    if (!canUseVSCodeExtensionHost() || get().snapshot.status !== "ready") {
      return;
    }
    const snapshot = await openVSCodeExtensionHostDocument({
      ...input,
      version: input.version ?? 1,
    });
    set({ snapshot });
  },

  changeDocument: async (input) => {
    if (!canUseVSCodeExtensionHost() || get().snapshot.status !== "ready") {
      return;
    }
    const snapshot = await changeVSCodeExtensionHostDocument(input);
    set({ snapshot });
  },

  saveDocument: async (input) => {
    if (!canUseVSCodeExtensionHost() || get().snapshot.status !== "ready") {
      return;
    }
    const snapshot = await saveVSCodeExtensionHostDocument(input);
    set({ snapshot });
  },

  requestLanguageFeature: async (input) => {
    if (!canUseVSCodeExtensionHost() || get().snapshot.status !== "ready") {
      return {
        ok: false,
        feature: input.feature,
        documentVersion: input.version,
        providers: [],
        results: [],
      };
    }
    return requestVSCodeExtensionHostLanguageFeature(input);
  },

  resolveView: async (viewId) => {
    await waitForPendingHostStart();
    return resolveVSCodeExtensionHostView(viewId);
  },

  resolveTree: async (viewId) => {
    await waitForPendingHostStart();
    return resolveVSCodeExtensionHostTree(viewId);
  },

  postViewMessage: async (viewId, message) => {
    await waitForPendingHostStart();
    const result = await postVSCodeExtensionHostViewMessage(viewId, message);
    set({ snapshot: result.snapshot });
    return result.messages;
  },

  drainViewMessages: async (viewId) => {
    await waitForPendingHostStart();
    const result = await drainVSCodeExtensionHostViewMessages(viewId);
    set({ snapshot: result.snapshot });
    return result.messages;
  },
}));
