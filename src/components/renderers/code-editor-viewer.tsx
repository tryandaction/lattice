"use client";

import { useCallback, useMemo, useRef, useEffect, useState, startTransition } from "react";
import type { Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap } from "@codemirror/view";
import {
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import {
  CodeEditor,
  CodeEditorLanguage,
  CodeEditorRef,
} from "@/components/editor/codemirror/code-editor";
import { getFileExtension } from "@/lib/file-utils";
import { useAnnotationNavigation } from "../../hooks/use-annotation-navigation";
import { OutputArea } from "@/components/notebook/output-area";
import { KernelStatus } from "@/components/notebook/kernel-status";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import type { CommandBarAction, CommandBarState, PaneId } from "@/types/layout";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { resolveCodeReference } from "@/lib/reference-navigation";
import { isSameWorkspacePath } from "@/lib/link-router/path-utils";
import { getRunnerDefinition } from "@/lib/runner/extension-map";
import { dirname, resolveWorkspaceFilePath } from "@/lib/runner/path-utils";
import type { ExecutionDiagnostic, ExecutionOrigin, ExecutionProblem, RunnerExecutionRequest } from "@/lib/runner/types";
import {
  buildRunnerPreferenceCommit,
  getLanguagePreferenceKey,
  resolveRunnerExecutionRequest,
} from "@/lib/runner/preferences";
import { useExecutionRunner } from "@/hooks/use-execution-runner";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import { ProblemsPanel } from "@/components/runner/problems-panel";
import { diagnosticsToExecutionProblems, mergeExecutionProblems, runnerHealthIssuesToExecutionProblems } from "@/lib/runner/problem-utils";
import { useRunnerHealth } from "@/hooks/use-runner-health";
import { WorkspaceRunnerManager } from "@/components/runner/workspace-runner-manager";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useExecutionDockLayout } from "@/hooks/use-execution-dock-layout";
import { HorizontalScrollStrip } from "@/components/ui/horizontal-scroll-strip";
import { useI18n } from "@/hooks/use-i18n";
import { toast } from "sonner";
import { buildPersistedFileViewStateKey, loadPersistedFileViewState, savePersistedFileViewState } from "@/lib/file-view-state";
import { setExecutionHealthSnapshot } from "@/stores/execution-session-store";
import { extractCodeOutlineSymbols } from "@/lib/code-outline";
import { CodeOutlinePanel } from "@/components/renderers/code-outline-panel";
import { resolveCodeEditorLanguageForFile } from "@/lib/vscode-compat/language";
import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";
import { useVSCodeExtensionHostStore } from "@/stores/vscode-extension-host-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  buildVSCodeLaunchActions,
  buildVSCodeLaunchExecutionRequest,
  buildVSCodeTaskActions,
  buildVSCodeTaskExecutionRequest,
} from "@/lib/vscode-compat/task-actions";
import type { VSCodeTask } from "@/lib/vscode-compat/types";
import {
  canUseTypeScriptDesktopService,
  getTypeScriptDesktopDefinition,
  getTypeScriptDesktopDiagnostics,
  getTypeScriptDesktopQuickInfo,
  getTypeScriptDesktopReferences,
  type TypeScriptReferenceSnapshot,
} from "@/lib/typescript-service/desktop";
import {
  canUsePythonDesktopService,
  getPythonDesktopDefinition,
  getPythonDesktopDiagnostics,
  getPythonDesktopQuickInfo,
  getPythonDesktopReferences,
  type PythonReferenceSnapshot,
} from "@/lib/python-service/desktop";
import {
  canUseRustDesktopService,
  getRustDesktopDefinition,
  getRustDesktopDiagnostics,
  getRustDesktopQuickInfo,
  getRustDesktopReferences,
  type RustReferenceSnapshot,
} from "@/lib/rust-service/desktop";
import { createDesktopFileHandle } from "@/lib/desktop-file-system";
import { isTauriHost } from "@/lib/storage-adapter";
import { createDebugEditorExtension } from "@/lib/vscode-debug/editor-extension";
import { useVSCodeDebugStore } from "@/stores/vscode-debug-store";
import { normalizeDebugSourcePath } from "@/lib/vscode-debug/paths";
import {
  buildVSCodeLanguageEditorExtensions,
  applyVSCodeFormattingResponse,
  applyVSCodeRenameResponse,
  firstVSCodeDefinitionLocation,
  mapVSCodeReferenceLocations,
  resolveVSCodeCodeActionResponse,
  textOffsetToVSCodePosition,
  type VSCodeLanguageDiagnostic,
} from "@/lib/vscode-compat/language-bridge";

interface CodeEditorViewerProps {
  content: string;
  fileName: string;
  onContentChange?: (content: string) => void;
  onSave?: () => Promise<void>;
  isReadOnly?: boolean;
  paneId: PaneId;
  tabId: string;
  filePath: string;
  executionScopeId: string;
  /** Remote/shared items must execute inline and never resolve a local file path. */
  executionMode?: "workspace-file" | "inline-only";
  extraCommandActions?: CommandBarAction[];
}

const DEBOUNCE_DELAY = 500;
const HEAVY_EDITOR_FEATURE_CHAR_LIMIT = 150_000;
const DEFAULT_EXTRA_COMMAND_ACTIONS: CommandBarAction[] = [];

function messageFromUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) return null;
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function getIdentifierAtOffset(text: string, offset: number | null): string | null {
  if (offset === null || offset < 0 || offset > text.length) {
    return null;
  }
  const isWordChar = (value: string) => /[\w$]/.test(value);
  let start = offset;
  let end = offset;
  while (start > 0 && isWordChar(text[start - 1] ?? "")) {
    start -= 1;
  }
  while (end < text.length && isWordChar(text[end] ?? "")) {
    end += 1;
  }
  return start === end ? null : text.slice(start, end);
}

function lineColumnToOffset(text: string, line: number, column: number): number | null {
  if (line <= 0 || column <= 0) {
    return null;
  }
  const lines = text.split(/\r?\n/);
  if (line > lines.length) {
    return null;
  }
  let offset = 0;
  for (let index = 0; index < line - 1; index += 1) {
    offset += lines[index]?.length ?? 0;
    offset += 1;
  }
  return offset + column - 1;
}

function applyLocalSymbolRename(
  text: string,
  references: Array<TypeScriptReferenceSnapshot | PythonReferenceSnapshot | RustReferenceSnapshot>,
  previousName: string,
  nextName: string,
): string {
  const replacements = references
    .map((reference) => {
      const start = lineColumnToOffset(text, reference.line, reference.column);
      if (start === null) {
        return null;
      }
      return {
        start,
        end: start + previousName.length,
      };
    })
    .filter((value): value is { start: number; end: number } => value !== null)
    .sort((left, right) => right.start - left.start);

  let nextText = text;
  for (const replacement of replacements) {
    if (nextText.slice(replacement.start, replacement.end) !== previousName) {
      continue;
    }
    nextText =
      nextText.slice(0, replacement.start) +
      nextName +
      nextText.slice(replacement.end);
  }
  return nextText;
}

export function CodeEditorViewer({
  content,
  fileName,
  onContentChange,
  onSave,
  isReadOnly = false,
  paneId,
  tabId,
  filePath,
  executionScopeId,
  executionMode = "workspace-file",
  extraCommandActions = DEFAULT_EXTRA_COMMAND_ACTIONS,
}: CodeEditorViewerProps) {
  const { t } = useI18n();
  const extension = getFileExtension(fileName);
  const language = useMemo<CodeEditorLanguage>(
    () => resolveCodeEditorLanguageForFile(fileName),
    [fileName],
  );
  const runnerDefinition = useMemo(
    () => getRunnerDefinition(extension),
    [extension],
  );
  const rootName = useWorkspaceStore((state) => state.rootHandle?.name ?? state.fileTree.root?.name ?? null);
  const openFileInPane = useWorkspaceStore((state) => state.openFileInPane);
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const runnerPreferences = useWorkspaceStore((state) => state.runnerPreferences);
  const vscodeCompatEnabled = useSettingsStore((state) => state.settings.vscodeCompatEnabled);
  const vscodeCompatTasks = useVSCodeCompatStore((state) => state.tasks);
  const vscodeCompatLaunches = useVSCodeCompatStore((state) => state.launches);
  const vscodeCompatSettings = useVSCodeCompatStore((state) => state.settings);
  const vscodeHostStatus = useVSCodeExtensionHostStore((state) => state.snapshot.status);
  const openVSCodeHostDocument = useVSCodeExtensionHostStore((state) => state.openDocument);
  const changeVSCodeHostDocument = useVSCodeExtensionHostStore((state) => state.changeDocument);
  const saveVSCodeHostDocument = useVSCodeExtensionHostStore((state) => state.saveDocument);
  const requestVSCodeHostLanguageFeature = useVSCodeExtensionHostStore((state) => state.requestLanguageFeature);
  const runVSCodeHostCommand = useVSCodeExtensionHostStore((state) => state.runCommand);
  const setRecentRunConfig = useWorkspaceStore((state) => state.setRecentRunConfig);
  const setRunnerPreferences = useWorkspaceStore((state) => state.setRunnerPreferences);
  const saveCachedEditorState = useContentCacheStore((state) => state.saveEditorState);
  const getCachedEditorState = useContentCacheStore((state) => state.getEditorState);
  const persistedViewStateKey = useMemo(
    () => buildPersistedFileViewStateKey({
      kind: "code",
      workspaceKey,
      workspaceRootPath,
      filePath,
      fallbackName: fileName,
    }),
    [fileName, filePath, workspaceKey, workspaceRootPath],
  );

  const {
    status: runnerStatus,
    outputs,
    panelMeta,
    error: runnerError,
    summary,
    problems,
    run,
    terminate,
    clearOutputs,
    setPanelMeta,
    setExternalProblems,
    isRunning,
    isLoading,
    lastRequest,
    commandState,
  } = useExecutionRunner({
    scope: {
      scopeId: executionScopeId,
      kind: "code",
      paneId,
      tabId,
      filePath,
      fileName,
    },
    capability: {
      supportsSelection: Boolean(runnerDefinition?.supportsInlineCode),
      supportsPersistentSession: false,
      supportsNotebook: false,
      supportsLocalExecution: true,
      supportsPyodide: false,
      canRun: Boolean(runnerDefinition) && !isReadOnly,
      canStop: Boolean(runnerDefinition) && !isReadOnly,
      canInterrupt: false,
      canRestart: false,
    },
  });

  const [syntaxProblems, setSyntaxProblems] = useState<ExecutionProblem[]>([]);
  const [languageServiceProblems, setLanguageServiceProblems] = useState<ExecutionProblem[]>([]);
  const [extensionHostProblems, setExtensionHostProblems] = useState<ExecutionProblem[]>([]);
  const [referenceResults, setReferenceResults] = useState<Array<TypeScriptReferenceSnapshot | PythonReferenceSnapshot | RustReferenceSnapshot>>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const currentContentRef = useRef(content);
  const editorRef = useRef<CodeEditorRef | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const handleEditorReady = useCallback(() => setEditorRevision((revision) => revision + 1), []);
  const languageServiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vscodeDocumentVersionRef = useRef(1);
  const vscodeDocumentSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const { menuState: selectionMenuState, closeMenu: closeSelectionMenu } = useSelectionContextMenu(
    editorContainerRef,
    ({ text, inputOffsets, lineStart, lineEnd }) => createSelectionContext({
      sourceKind: "code",
      paneId,
      fileName,
      filePath,
      selectedText: text,
      documentText: currentContentRef.current,
      selectionRange: inputOffsets
        ? {
            start: inputOffsets.start,
            end: inputOffsets.end,
            lineStart,
            lineEnd,
          }
        : undefined,
    }),
    {
      getSelectionSnapshot: () => {
        const details = editorRef.current?.getSelectionDetails();
        if (!details) {
          return null;
        }
        return {
          text: details.text,
          inputOffsets: {
            start: details.start,
            end: details.end,
          },
          lineStart: details.lineStart,
          lineEnd: details.lineEnd,
        };
      },
    }
  );
  const pendingNavigation = useLinkNavigationStore((state) => state.pendingByPane[paneId]);
  const completePendingNavigation = useLinkNavigationStore((state) => state.completePendingNavigation);
  const setPendingNavigation = useLinkNavigationStore((state) => state.setPendingNavigation);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasChangedRef = useRef(false);
  const {
    dockSize,
    isDockOpen: showOutput,
    activeDockTab,
    setDockSize,
    setIsDockOpen: setShowOutput,
    setActiveDockTab,
  } = useExecutionDockLayout({
    paneId,
    surfaceId: "code-execution",
    defaultSize: 38,
    defaultOpen: false,
    defaultTab: "run",
  });

  const absoluteFilePath = useMemo(
    () => executionMode === "inline-only" ? null : resolveWorkspaceFilePath(workspaceRootPath, filePath, rootName),
    [executionMode, workspaceRootPath, filePath, rootName],
  );
  const debugWorkspaceKey = workspaceKey ?? workspaceRootPath;

  useEffect(() => {
    if (!debugWorkspaceKey) return;
    const debugStore = useVSCodeDebugStore.getState();
    if (debugStore.workspaceKey !== debugWorkspaceKey) {
      debugStore.loadBreakpoints(debugWorkspaceKey);
    }
  }, [debugWorkspaceKey]);
  const executionContext = useMemo(() => ({
    kind: "file" as const,
    filePath: absoluteFilePath ?? filePath,
    fileName,
    language,
    label: fileName,
  }), [absoluteFilePath, fileName, filePath, language]);
  const runCwd = useMemo(
    () => executionMode === "inline-only" ? undefined : absoluteFilePath ? dirname(absoluteFilePath) : workspaceRootPath ?? undefined,
    [absoluteFilePath, executionMode, workspaceRootPath],
  );
  const {
    runnerHealthSnapshot,
    refresh: refreshRunnerHealth,
  } = useRunnerHealth({
    cwd: runCwd,
    fileKey: filePath,
    commands: runnerDefinition?.command ? [runnerDefinition.command] : [],
    checkPython: runnerDefinition?.runnerType === "python-local",
    autoRefresh: vscodeCompatEnabled,
  });
  const healthContext = useMemo(
    () => ({
      kind: "workspace" as const,
      filePath: absoluteFilePath ?? filePath,
      fileName,
      label: t("workbench.runner.currentFileEnv"),
    }),
    [absoluteFilePath, fileName, filePath, t],
  );

  useAnnotationNavigation({
    handlers: {
      onCodeLineNavigate: (line) => {
        editorRef.current?.scrollToLine(line);
        window.setTimeout(() => {
          editorRef.current?.flashLine(line);
        }, 120);
      },
    },
  });

  useEffect(() => {
    currentContentRef.current = content;
  }, [content]);

  useEffect(() => {
    if (!vscodeCompatEnabled || vscodeHostStatus !== "ready") {
      return;
    }
    const targetPath = absoluteFilePath ?? filePath;
    if (!targetPath) {
      return;
    }
    vscodeDocumentVersionRef.current = 1;
    void openVSCodeHostDocument({
      filePath: targetPath,
      languageId: language,
      content: currentContentRef.current,
      version: vscodeDocumentVersionRef.current,
    }).catch(() => undefined);
    return () => {
      if (vscodeDocumentSyncTimerRef.current) {
        clearTimeout(vscodeDocumentSyncTimerRef.current);
        vscodeDocumentSyncTimerRef.current = null;
      }
    };
  }, [absoluteFilePath, filePath, language, openVSCodeHostDocument, vscodeCompatEnabled, vscodeHostStatus]);

  useEffect(() => {
    const editor = editorRef.current;
    let cancelled = false;
    const restore = async () => {
      const cachedState = getCachedEditorState(filePath);
      if (
        cachedState &&
        typeof cachedState.cursorPosition === "number" &&
        typeof cachedState.scrollTop === "number"
      ) {
        requestAnimationFrame(() => {
          editorRef.current?.restoreEditorState(cachedState as {
            cursorPosition: number;
            scrollTop: number;
            scrollLeft?: number;
            selection?: { from: number; to: number };
          });
        });
        return;
      }

      const persistedState = await loadPersistedFileViewState(persistedViewStateKey);
      if (
        cancelled ||
        !persistedState ||
        typeof persistedState.cursorPosition !== "number" ||
        typeof persistedState.scrollTop !== "number"
      ) {
        return;
      }

      requestAnimationFrame(() => {
        editorRef.current?.restoreEditorState(persistedState as {
          cursorPosition: number;
          scrollTop: number;
          scrollLeft?: number;
          selection?: { from: number; to: number };
        });
      });
      saveCachedEditorState(filePath, persistedState as {
        cursorPosition: number;
        scrollTop: number;
        scrollLeft?: number;
        selection?: { from: number; to: number };
      });
    };

    void restore();

    return () => {
      cancelled = true;
      const editorState = editor?.getEditorState();
      if (editorState) {
        saveCachedEditorState(filePath, editorState);
        void savePersistedFileViewState(persistedViewStateKey, editorState);
      }
    };
  }, [filePath, getCachedEditorState, persistedViewStateKey, saveCachedEditorState]);

  useEffect(() => {
    if (!pendingNavigation || !isSameWorkspacePath(pendingNavigation.filePath, filePath)) {
      return;
    }

    if (pendingNavigation.target.type !== "code_line" && pendingNavigation.target.type !== "workspace_text") {
      return;
    }
    if (!editorRef.current?.isReady()) return;

    // CodeMirror normalizes CRLF. Resolve against its current document so source
    // offsets also remain correct while unsaved edits are visible.
    const editorContent = editorRef.current?.getContent() ?? content.replace(/\r\n?/g, "\n");
    const resolution = resolveCodeReference(
      pendingNavigation.target,
      editorContent.split("\n").length,
      editorContent,
    );
    if (!resolution) return;
    if (resolution.status !== "success") {
      completePendingNavigation(paneId, pendingNavigation.requestId, { status: resolution.status });
      return;
    }
    const line = resolution.line;
    if (!line || !editorRef.current) return;
    editorRef.current.scrollToLine(line);
    const timer = window.setTimeout(() => {
      const editor = editorRef.current;
      if (!editor || editor.getContent() !== editorContent) {
        completePendingNavigation(paneId, pendingNavigation.requestId, { status: "quote_not_found" });
        return;
      }
      const found = resolution.range ? editor.flashRange(resolution.range) : (editor.flashLine(line), true);
      completePendingNavigation(paneId, pendingNavigation.requestId, { status: found ? "success" : "quote_not_found" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [completePendingNavigation, content, editorRevision, filePath, paneId, pendingNavigation]);

  useEffect(() => {
    if (outputs.some((output) => output.type === "error")) {
      startTransition(() => {
        setShowOutput(true);
        setActiveDockTab("problems");
      });
    }
  }, [outputs, setActiveDockTab, setShowOutput]);

  useEffect(() => {
    if (syntaxProblems.length > 0) {
      startTransition(() => {
        setShowOutput(true);
        setActiveDockTab("problems");
      });
    }
  }, [setActiveDockTab, setShowOutput, syntaxProblems.length]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (vscodeDocumentSyncTimerRef.current) {
        clearTimeout(vscodeDocumentSyncTimerRef.current);
      }
    };
  }, []);

  const syncVSCodeHostSave = useCallback(async () => {
    if (!vscodeCompatEnabled || vscodeHostStatus !== "ready") {
      return;
    }
    const targetPath = absoluteFilePath ?? filePath;
    if (!targetPath) {
      return;
    }
    if (vscodeDocumentSyncTimerRef.current) {
      clearTimeout(vscodeDocumentSyncTimerRef.current);
      vscodeDocumentSyncTimerRef.current = null;
    }
    await saveVSCodeHostDocument({
      filePath: targetPath,
      languageId: language,
      content: currentContentRef.current,
      version: vscodeDocumentVersionRef.current,
    });
  }, [absoluteFilePath, filePath, language, saveVSCodeHostDocument, vscodeCompatEnabled, vscodeHostStatus]);

  const persistFileAndSyncHost = useCallback(async () => {
    await onSave?.();
    await syncVSCodeHostSave();
  }, [onSave, syncVSCodeHostSave]);

  const handleChange = useCallback((newContent: string) => {
    currentContentRef.current = newContent;
    onContentChange?.(newContent);
    hasChangedRef.current = true;

    if (vscodeCompatEnabled && vscodeHostStatus === "ready") {
      const targetPath = absoluteFilePath ?? filePath;
      if (targetPath) {
        vscodeDocumentVersionRef.current += 1;
        const version = vscodeDocumentVersionRef.current;
        if (vscodeDocumentSyncTimerRef.current) {
          clearTimeout(vscodeDocumentSyncTimerRef.current);
        }
        vscodeDocumentSyncTimerRef.current = setTimeout(() => {
          void changeVSCodeHostDocument({
            filePath: targetPath,
            languageId: language,
            content: currentContentRef.current,
            version,
          }).catch(() => undefined);
          vscodeDocumentSyncTimerRef.current = null;
        }, 150);
      }
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (onSave) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (!hasChangedRef.current) return;
        const contentAtSave = currentContentRef.current;
        void persistFileAndSyncHost()
          .then(() => {
            // A newer edit may have arrived while the write was in flight.
            // Only clear dirty state when the saved snapshot is still current.
            if (currentContentRef.current === contentAtSave) {
              hasChangedRef.current = false;
            }
          })
          .catch((error) => {
            // Keep the dirty flag so the next edit or explicit save can retry.
            hasChangedRef.current = true;
            console.error("Failed to save file:", error);
          });
      }, DEBOUNCE_DELAY);
    }
  }, [absoluteFilePath, changeVSCodeHostDocument, filePath, language, onContentChange, onSave, persistFileAndSyncHost, vscodeCompatEnabled, vscodeHostStatus]);

  const flushPendingSave = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (!onSave) {
      hasChangedRef.current = false;
      return;
    }

    await persistFileAndSyncHost();
    hasChangedRef.current = false;
  }, [onSave, persistFileAndSyncHost]);

  const buildRunRequest = useCallback(async (
    mode: RunnerExecutionRequest["mode"],
    codeOverride?: string,
  ): Promise<{
    request: RunnerExecutionRequest | null;
    origin: ExecutionOrigin | null;
    diagnostics: ExecutionDiagnostic[];
    context: typeof executionContext;
  }> => {
    if (!runnerDefinition) {
      return { request: null, origin: null, diagnostics: [], context: executionContext };
    }

    const code = codeOverride ?? currentContentRef.current;
    const languageKey = getLanguagePreferenceKey(extension);

    if (mode === "file") {
      try {
        await flushPendingSave();
      } catch (error) {
        const message = messageFromUnknownError(error);
        return {
          request: null,
          origin: null,
          diagnostics: [
            {
              severity: "error",
              title: "保存失败，已阻止运行",
              message,
              hint: "请先解决保存问题，再重新运行当前文件。",
              stage: "request-build",
            },
          ],
          context: executionContext,
        };
      }
    }

    const resolved = await resolveRunnerExecutionRequest({
      runnerDefinition,
      mode,
      code,
      cwd: runCwd,
      absoluteFilePath: absoluteFilePath ?? undefined,
      fileKey: filePath,
      language: languageKey,
      preferences: runnerPreferences,
    });

    return {
      request: resolved.request,
      origin: resolved.meta.origin,
      diagnostics: resolved.meta.diagnostics,
      context: executionContext,
    };
  }, [absoluteFilePath, executionContext, extension, filePath, flushPendingSave, runCwd, runnerDefinition, runnerPreferences]);

  const handleRun = useCallback(async () => {
    if (!runnerDefinition || !commandState.canRun) {
      return;
    }
    await refreshRunnerHealth();
    const { request, origin, diagnostics, context } = await buildRunRequest("file");
    clearOutputs();
    setPanelMeta({ origin, diagnostics, context });
    setShowOutput(true);
    setActiveDockTab(diagnostics.length > 0 ? "problems" : "run");
    if (!request) {
      return;
    }

    const result = await run(request);
    if (result.success && runnerDefinition) {
      const commit = buildRunnerPreferenceCommit({
        fileKey: filePath,
        language: extension,
        request,
        preferences: runnerPreferences,
      });
      setRecentRunConfig(commit.fileKey, commit.recentRunConfig);
      setRunnerPreferences(commit.preferences);
    }
  }, [buildRunRequest, clearOutputs, commandState.canRun, extension, filePath, refreshRunnerHealth, run, runnerDefinition, runnerPreferences, setActiveDockTab, setPanelMeta, setRecentRunConfig, setRunnerPreferences, setShowOutput]);

  const handleRunSelection = useCallback(async () => {
    if (!runnerDefinition || !commandState.canRun) {
      return;
    }
    const selection = editorRef.current?.getSelection();
    if (!selection?.trim()) return;

    await refreshRunnerHealth();
    const { request, origin, diagnostics, context } = await buildRunRequest("selection", selection);
    clearOutputs();
    setPanelMeta({ origin, diagnostics, context });
    setShowOutput(true);
    setActiveDockTab(diagnostics.length > 0 ? "problems" : "run");
    if (!request) {
      closeSelectionMenu();
      return;
    }

    closeSelectionMenu();
    await run(request);
  }, [buildRunRequest, clearOutputs, closeSelectionMenu, commandState.canRun, refreshRunnerHealth, run, runnerDefinition, setActiveDockTab, setPanelMeta, setShowOutput]);

  const handleRerun = useCallback(async () => {
    if (!lastRequest || !commandState.canRerun) {
      return;
    }

    if (lastRequest.mode === "file") {
      try {
        await flushPendingSave();
      } catch (error) {
        const message = messageFromUnknownError(error);
        clearOutputs();
        setPanelMeta({
          origin: null,
          diagnostics: [
            {
              severity: "error",
              title: "保存失败，已阻止重新运行",
              message,
              hint: "请先解决保存问题，再重新运行当前文件。",
              stage: "request-build",
            },
          ],
          context: executionContext,
        });
        setShowOutput(true);
        setActiveDockTab("problems");
        return;
      }
    }

    clearOutputs();
    setShowOutput(true);
    setActiveDockTab("run");
    await run(lastRequest);
  }, [clearOutputs, commandState.canRerun, executionContext, flushPendingSave, lastRequest, run, setActiveDockTab, setPanelMeta, setShowOutput]);

  const healthProblems = useMemo(
    () => runnerHealthIssuesToExecutionProblems(runnerHealthSnapshot.issues, healthContext),
    [healthContext, runnerHealthSnapshot.issues],
  );

  const externalProblems = useMemo(
    () => mergeExecutionProblems(
      syntaxProblems,
      languageServiceProblems,
      extensionHostProblems,
      diagnosticsToExecutionProblems(panelMeta.diagnostics, "preflight", panelMeta.context ?? executionContext),
    ),
    [executionContext, extensionHostProblems, languageServiceProblems, panelMeta.context, panelMeta.diagnostics, syntaxProblems],
  );

  useEffect(() => {
    setExternalProblems(externalProblems);
  }, [externalProblems, setExternalProblems]);

  useEffect(() => {
    const normalizedExtension = extension.toLowerCase();
    const targetFilePath = absoluteFilePath ?? filePath;
    if (!targetFilePath) {
      setLanguageServiceProblems([]);
      return;
    }

    const supportsTypeScript =
      (normalizedExtension === "ts" ||
        normalizedExtension === "tsx" ||
        normalizedExtension === "js" ||
        normalizedExtension === "jsx" ||
        normalizedExtension === "mjs" ||
        normalizedExtension === "cjs") &&
      canUseTypeScriptDesktopService();
    const supportsPython = normalizedExtension === "py" && canUsePythonDesktopService();
    const supportsRust = normalizedExtension === "rs" && canUseRustDesktopService();

    if (!supportsTypeScript && !supportsPython && !supportsRust) {
      setLanguageServiceProblems([]);
      return;
    }

    if (languageServiceTimerRef.current) {
      clearTimeout(languageServiceTimerRef.current);
    }

    languageServiceTimerRef.current = setTimeout(() => {
      const request = supportsTypeScript
        ? getTypeScriptDesktopDiagnostics({
            workspaceRootPath,
            filePath: targetFilePath,
            content: currentContentRef.current,
          })
        : supportsPython
          ? getPythonDesktopDiagnostics({
              workspaceRootPath,
              pythonPath: runnerPreferences.defaultPythonPath,
              filePath: targetFilePath,
              content: currentContentRef.current,
            })
          : getRustDesktopDiagnostics({
              workspaceRootPath,
              filePath: targetFilePath,
              content: currentContentRef.current,
            });

      request
        .then((diagnostics) => {
          setLanguageServiceProblems(diagnostics.map((diagnostic, index): ExecutionProblem => ({
            id: `${supportsTypeScript ? "tsservice" : "pyservice"}:${targetFilePath}:${diagnostic.line}:${diagnostic.column}:${diagnostic.code ?? ""}:${index}`,
            source: "preflight",
            severity: diagnostic.severity,
            title: diagnostic.code
              ? `${supportsTypeScript ? "TypeScript" : supportsPython ? "Python" : "Rust"} ${diagnostic.code}`
              : supportsTypeScript
                ? "TypeScript"
                : supportsPython
                  ? "Python"
                  : "Rust",
            message: diagnostic.message,
            code: diagnostic.code ?? undefined,
            context: {
              kind: "file",
              filePath: targetFilePath,
              line: diagnostic.line,
            },
          })));
        })
        .catch(() => {
          setLanguageServiceProblems([]);
        });
    }, 350);

    return () => {
      if (languageServiceTimerRef.current) {
        clearTimeout(languageServiceTimerRef.current);
        languageServiceTimerRef.current = null;
      }
    };
  }, [absoluteFilePath, content, extension, filePath, runnerPreferences.defaultPythonPath, workspaceRootPath]);

  useEffect(() => {
    setExecutionHealthSnapshot(executionScopeId, runnerHealthSnapshot, healthProblems);
  }, [executionScopeId, healthProblems, runnerHealthSnapshot]);

  const navigateToProblem = useCallback((problem: ExecutionProblem) => {
    const line = problem.context?.line;
    if (!line) {
      return;
    }

    editorRef.current?.scrollToLine(line);
    window.setTimeout(() => {
      editorRef.current?.flashLine(line);
    }, 120);
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (runnerDefinition && event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      if (commandState.canRun) {
        void handleRun();
      }
    }
  }, [commandState.canRun, handleRun, runnerDefinition]);

  const canRun = Boolean(runnerDefinition) && !isReadOnly;
  const enableHeavyEditorFeatures = !isReadOnly
    && Boolean(onContentChange)
    && content.length <= HEAVY_EDITOR_FEATURE_CHAR_LIMIT;
  const durationLabel = formatDuration(summary.durationMs);
  const shouldRenderDock = showOutput || outputs.length > 0 || problems.length > 0 || isRunning || isLoading;
  const runnerCommand = runnerDefinition?.command;
  const outlineSymbols = useMemo(
    () => (outlineOpen ? extractCodeOutlineSymbols(content, language) : []),
    [content, language, outlineOpen],
  );
  const handleRunVSCodeTask = useCallback(async (task: VSCodeTask) => {
    const request = buildVSCodeTaskExecutionRequest(task, { workspaceRootPath });
    clearOutputs();
    setPanelMeta({
      origin: {
        runnerType: "external-command",
        mode: "file",
        sourceLabel: "VS Code Task",
        detailLabel: task.label,
      },
      diagnostics: [],
      context: {
        kind: "workspace",
        filePath: workspaceRootPath ?? filePath,
        label: `VS Code task: ${task.label}`,
      },
    });
    setShowOutput(true);
    setActiveDockTab("run");
    await run(request);
  }, [clearOutputs, filePath, run, setActiveDockTab, setPanelMeta, setShowOutput, workspaceRootPath]);

  const handleRunVSCodeLaunch = useCallback(async (launch: import("@/lib/vscode-compat/types").VSCodeLaunchConfiguration) => {
    const request = buildVSCodeLaunchExecutionRequest(launch, {
      workspaceRootPath,
      defaultPythonPath: runnerPreferences.defaultPythonPath,
    });
    if (!request) {
      toast.error("Launch configuration not supported / 运行配置暂不支持");
      return;
    }
    clearOutputs();
    setPanelMeta({
      origin: {
        runnerType: request.runnerType,
        mode: request.mode,
        sourceLabel: "VS Code Launch",
        detailLabel: launch.name,
      },
      diagnostics: [],
      context: {
        kind: "workspace",
        filePath: workspaceRootPath ?? filePath,
        label: `VS Code launch: ${launch.name}`,
      },
    });
    setShowOutput(true);
    setActiveDockTab("run");
    await run(request);
  }, [clearOutputs, filePath, run, runnerPreferences.defaultPythonPath, setActiveDockTab, setPanelMeta, setShowOutput, workspaceRootPath]);

  const isTypeScriptLanguageServiceSupported = useMemo(() => {
    const normalizedExtension = extension.toLowerCase();
    return normalizedExtension === "ts" ||
      normalizedExtension === "tsx" ||
      normalizedExtension === "js" ||
      normalizedExtension === "jsx" ||
      normalizedExtension === "mjs" ||
      normalizedExtension === "cjs";
  }, [extension]);
  const isPythonLanguageServiceSupported = extension.toLowerCase() === "py";
  const isRustLanguageServiceSupported = extension.toLowerCase() === "rs";
  const isCodeIntelligenceSupported = isTypeScriptLanguageServiceSupported || isPythonLanguageServiceSupported || isRustLanguageServiceSupported;

  const typeScriptHoverExtension = useMemo<Extension[]>(() => {
    if (
      (!isTypeScriptLanguageServiceSupported && !isPythonLanguageServiceSupported && !isRustLanguageServiceSupported) ||
      (isTypeScriptLanguageServiceSupported && !canUseTypeScriptDesktopService()) ||
      (isPythonLanguageServiceSupported && !canUsePythonDesktopService()) ||
      (isRustLanguageServiceSupported && !canUseRustDesktopService())
    ) {
      return [];
    }
    const targetFilePath = absoluteFilePath ?? filePath;
    if (!targetFilePath) {
      return [];
    }

    const hover = hoverTooltip(async (view, pos) => {
      const line = view.state.doc.lineAt(pos);
      const lineText = line.text;
      const localOffset = pos - line.from;
      const isWordChar = (value: string) => /[\w$]/.test(value);

      let start = localOffset;
      let end = localOffset;
      while (start > 0 && isWordChar(lineText[start - 1] ?? "")) {
        start -= 1;
      }
      while (end < lineText.length && isWordChar(lineText[end] ?? "")) {
        end += 1;
      }

      if (start === end) {
        return null;
      }

      const info = isTypeScriptLanguageServiceSupported
        ? await getTypeScriptDesktopQuickInfo({
            workspaceRootPath,
            filePath: targetFilePath,
            content: view.state.doc.toString(),
            offset: line.from + start,
          })
        : isPythonLanguageServiceSupported
          ? await getPythonDesktopQuickInfo({
              workspaceRootPath,
              pythonPath: runnerPreferences.defaultPythonPath,
              filePath: targetFilePath,
              content: view.state.doc.toString(),
              offset: line.from + start,
            })
          : await getRustDesktopQuickInfo({
              workspaceRootPath,
              filePath: targetFilePath,
              content: view.state.doc.toString(),
              offset: line.from + start,
            });
      if (!info) {
        return null;
      }

      return {
        pos: line.from + start,
        end: line.from + end,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "max-w-[28rem] rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg";

          const title = document.createElement("div");
          title.className = "font-mono whitespace-pre-wrap text-foreground";
          title.textContent = info.display;
          dom.appendChild(title);

          if (info.documentation) {
            const description = document.createElement("div");
            description.className = "mt-2 whitespace-pre-wrap text-muted-foreground";
            description.textContent = info.documentation;
            dom.appendChild(description);
          }

          return { dom };
        },
      };
    }, { hoverTime: 350 });

    return [hover, EditorView.baseTheme({ ".cm-tooltip": { zIndex: "40" } })];
  }, [absoluteFilePath, filePath, isPythonLanguageServiceSupported, isRustLanguageServiceSupported, isTypeScriptLanguageServiceSupported, runnerPreferences.defaultPythonPath, workspaceRootPath]);

  const resolveLanguageServiceOffset = useCallback(() => {
    const selection = editorRef.current?.getSelectionDetails();
    if (selection) {
      return selection.start;
    }
    return editorRef.current?.getCursorOffset() ?? null;
  }, []);

  const toWorkspaceNavigationPath = useCallback((targetAbsolutePath: string) => {
    const normalizedTarget = targetAbsolutePath.replace(/\\/g, "/");
    const normalizedRoot = workspaceRootPath?.replace(/\\/g, "/").replace(/\/+$/, "") ?? null;
    if (!normalizedRoot) {
      return normalizedTarget;
    }
    const prefix = `${normalizedRoot}/`;
    if (!normalizedTarget.startsWith(prefix)) {
      return normalizedTarget;
    }
    const relative = normalizedTarget.slice(prefix.length);
    return rootName ? `${rootName}/${relative}` : relative;
  }, [rootName, workspaceRootPath]);

  const handleShowTypeScriptQuickInfo = useCallback(async () => {
    const offset = resolveLanguageServiceOffset();
    await handleShowTypeScriptQuickInfoAtOffset(offset);
  }, [resolveLanguageServiceOffset]);

  const handleShowTypeScriptQuickInfoAtOffset = useCallback(async (offset: number | null) => {
    if (
      (!isTypeScriptLanguageServiceSupported && !isPythonLanguageServiceSupported && !isRustLanguageServiceSupported) ||
      (isTypeScriptLanguageServiceSupported && !canUseTypeScriptDesktopService()) ||
      (isPythonLanguageServiceSupported && !canUsePythonDesktopService()) ||
      (isRustLanguageServiceSupported && !canUseRustDesktopService())
    ) {
      return;
    }
    const targetFilePath = absoluteFilePath ?? filePath;
    if (!targetFilePath || offset === null) {
      toast.error(t("workbench.quickInfo.unavailable"));
      return;
    }

    try {
      const info = isTypeScriptLanguageServiceSupported
        ? await getTypeScriptDesktopQuickInfo({
            workspaceRootPath,
            filePath: targetFilePath,
            content: currentContentRef.current,
            offset,
          })
        : isPythonLanguageServiceSupported
          ? await getPythonDesktopQuickInfo({
              workspaceRootPath,
              pythonPath: runnerPreferences.defaultPythonPath,
              filePath: targetFilePath,
              content: currentContentRef.current,
              offset,
            })
          : await getRustDesktopQuickInfo({
              workspaceRootPath,
              filePath: targetFilePath,
              content: currentContentRef.current,
              offset,
            });
      if (!info) {
        toast(t("workbench.quickInfo.none"));
        return;
      }
      toast.success(info.display, {
        description: info.documentation ?? undefined,
        duration: 5000,
      });
    } catch (error) {
      toast.error(t("workbench.quickInfo.failed"), {
        description: messageFromUnknownError(error),
      });
    }
  }, [absoluteFilePath, filePath, isPythonLanguageServiceSupported, isRustLanguageServiceSupported, isTypeScriptLanguageServiceSupported, runnerPreferences.defaultPythonPath, t, workspaceRootPath]);

  const handleGoToTypeScriptDefinition = useCallback(async () => {
    const offset = resolveLanguageServiceOffset();
    await handleGoToTypeScriptDefinitionAtOffset(offset);
  }, [resolveLanguageServiceOffset]);

  const handleGoToTypeScriptDefinitionAtOffset = useCallback(async (offset: number | null) => {
    const targetFilePath = absoluteFilePath ?? filePath;
    if (!targetFilePath || offset === null) {
      toast.error(t("workbench.definition.unavailable"));
      return;
    }

    try {
      let definition: { filePath: string; line: number; column: number } | null = null;
      if (vscodeCompatEnabled && vscodeHostStatus === "ready") {
        const version = vscodeDocumentVersionRef.current;
        const response = await requestVSCodeHostLanguageFeature({
          feature: "definition",
          filePath: targetFilePath,
          languageId: language,
          version,
          position: textOffsetToVSCodePosition(currentContentRef.current, offset),
        });
        definition = firstVSCodeDefinitionLocation(response, vscodeDocumentVersionRef.current);
      }

      const supportsNativeService =
        (isTypeScriptLanguageServiceSupported && canUseTypeScriptDesktopService()) ||
        (isPythonLanguageServiceSupported && canUsePythonDesktopService()) ||
        (isRustLanguageServiceSupported && canUseRustDesktopService());
      if (!definition && supportsNativeService) {
        definition = isTypeScriptLanguageServiceSupported
          ? await getTypeScriptDesktopDefinition({
            workspaceRootPath,
            filePath: targetFilePath,
            content: currentContentRef.current,
            offset,
          })
          : isPythonLanguageServiceSupported
            ? await getPythonDesktopDefinition({
              workspaceRootPath,
              pythonPath: runnerPreferences.defaultPythonPath,
              filePath: targetFilePath,
              content: currentContentRef.current,
              offset,
            })
            : await getRustDesktopDefinition({
              workspaceRootPath,
              filePath: targetFilePath,
              content: currentContentRef.current,
              offset,
            });
      }
      if (!definition) {
        toast(t("workbench.definition.none"));
        return;
      }

      const definitionPath = definition.filePath.replace(/\\/g, "/");
      const currentPath = targetFilePath.replace(/\\/g, "/");
      if (definitionPath === currentPath) {
        editorRef.current?.scrollToLine(definition.line);
        window.setTimeout(() => {
          editorRef.current?.flashLine(definition.line);
        }, 120);
        return;
      }

      const workspacePath = toWorkspaceNavigationPath(definitionPath);
      openFileInPane(activePaneId, createDesktopFileHandle(definition.filePath), workspacePath);
      setPendingNavigation(activePaneId, {
        filePath: workspacePath,
        target: {
          type: "code_line",
          path: workspacePath,
          line: definition.line,
        },
      });
    } catch (error) {
      toast.error(t("workbench.definition.failed"), {
        description: messageFromUnknownError(error),
      });
    }
  }, [absoluteFilePath, activePaneId, filePath, isPythonLanguageServiceSupported, isRustLanguageServiceSupported, isTypeScriptLanguageServiceSupported, language, openFileInPane, requestVSCodeHostLanguageFeature, runnerPreferences.defaultPythonPath, setPendingNavigation, t, toWorkspaceNavigationPath, vscodeCompatEnabled, vscodeHostStatus, workspaceRootPath]);

  const handleFindTypeScriptReferences = useCallback(async () => {
    const offset = resolveLanguageServiceOffset();
    await handleFindTypeScriptReferencesAtOffset(offset);
  }, [resolveLanguageServiceOffset]);

  const handleFindTypeScriptReferencesAtOffset = useCallback(async (offset: number | null) => {
    const targetFilePath = absoluteFilePath ?? filePath;
    if (!targetFilePath || offset === null) {
      toast.error(t("workbench.references.unavailable"));
      return;
    }

    try {
      let references: Array<TypeScriptReferenceSnapshot | PythonReferenceSnapshot | RustReferenceSnapshot> = [];
      const supportsNativeService =
        (isTypeScriptLanguageServiceSupported && canUseTypeScriptDesktopService()) ||
        (isPythonLanguageServiceSupported && canUsePythonDesktopService()) ||
        (isRustLanguageServiceSupported && canUseRustDesktopService());
      if (vscodeCompatEnabled && vscodeHostStatus === "ready") {
        try {
          const version = vscodeDocumentVersionRef.current;
          const response = await requestVSCodeHostLanguageFeature({
            feature: "references",
            filePath: targetFilePath,
            languageId: language,
            version,
            position: textOffsetToVSCodePosition(currentContentRef.current, offset),
          });
          references = mapVSCodeReferenceLocations(response, vscodeDocumentVersionRef.current);
        } catch (error) {
          if (!supportsNativeService) throw error;
        }
      }
      if (supportsNativeService) {
        const nativeReferences = isTypeScriptLanguageServiceSupported
          ? await getTypeScriptDesktopReferences({
            workspaceRootPath,
            filePath: targetFilePath,
            content: currentContentRef.current,
            offset,
          })
          : isPythonLanguageServiceSupported
            ? await getPythonDesktopReferences({
              workspaceRootPath,
              pythonPath: runnerPreferences.defaultPythonPath,
              filePath: targetFilePath,
              content: currentContentRef.current,
              offset,
            })
            : await getRustDesktopReferences({
              workspaceRootPath,
              filePath: targetFilePath,
              content: currentContentRef.current,
              offset,
            });
        const seen = new Set(references.map((reference) => `${reference.filePath}:${reference.line}:${reference.column}`));
        references.push(...nativeReferences.filter((reference) => {
          const key = `${reference.filePath}:${reference.line}:${reference.column}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }));
      }
      setReferenceResults(references);
      if (references.length === 0) {
        toast(t("workbench.references.empty"));
        return;
      }
      setActiveDockTab("references");
      setShowOutput(true);
    } catch (error) {
      toast.error(t("workbench.references.lookupFailed"), {
        description: messageFromUnknownError(error),
      });
    }
  }, [absoluteFilePath, filePath, isPythonLanguageServiceSupported, isRustLanguageServiceSupported, isTypeScriptLanguageServiceSupported, language, requestVSCodeHostLanguageFeature, runnerPreferences.defaultPythonPath, setActiveDockTab, setShowOutput, t, vscodeCompatEnabled, vscodeHostStatus, workspaceRootPath]);

  const navigateToReference = useCallback((reference: TypeScriptReferenceSnapshot | PythonReferenceSnapshot | RustReferenceSnapshot) => {
    const targetPath = reference.filePath.replace(/\\/g, "/");
    const currentPath = (absoluteFilePath ?? filePath).replace(/\\/g, "/");
    if (targetPath === currentPath) {
      editorRef.current?.scrollToLine(reference.line);
      window.setTimeout(() => {
        editorRef.current?.flashLine(reference.line);
      }, 120);
      return;
    }

    const workspacePath = toWorkspaceNavigationPath(targetPath);
    openFileInPane(activePaneId, createDesktopFileHandle(reference.filePath), workspacePath);
    setPendingNavigation(activePaneId, {
      filePath: workspacePath,
      target: {
        type: "code_line",
        path: workspacePath,
        line: reference.line,
      },
    });
  }, [absoluteFilePath, activePaneId, filePath, openFileInPane, setPendingNavigation, toWorkspaceNavigationPath]);

  const handleExtensionHostDiagnostics = useCallback((diagnostics: VSCodeLanguageDiagnostic[]) => {
    const targetPath = absoluteFilePath ?? filePath;
    setExtensionHostProblems(diagnostics.map((diagnostic, index): ExecutionProblem => ({
      id: `vscode-extension:${targetPath}:${diagnostic.line}:${diagnostic.from}:${index}`,
      source: "preflight",
      severity: diagnostic.severity === "error"
        ? "error"
        : diagnostic.severity === "warning"
          ? "warning"
          : "info",
      title: diagnostic.source ? `VS Code Extension: ${diagnostic.source}` : "VS Code Extension",
      message: diagnostic.message,
      context: {
        kind: "file",
        filePath: targetPath,
        line: diagnostic.line,
      },
    })));
  }, [absoluteFilePath, filePath]);

  const vscodeLanguageEditorExtensions = useMemo<Extension[]>(() => {
    const targetPath = absoluteFilePath ?? filePath;
    if (!vscodeCompatEnabled || vscodeHostStatus !== "ready" || !targetPath) {
      return [];
    }
    return buildVSCodeLanguageEditorExtensions({
      filePath: targetPath,
      languageId: language,
      getVersion: () => vscodeDocumentVersionRef.current,
      request: requestVSCodeHostLanguageFeature,
      onDiagnostics: handleExtensionHostDiagnostics,
    });
  }, [absoluteFilePath, filePath, handleExtensionHostDiagnostics, language, requestVSCodeHostLanguageFeature, vscodeCompatEnabled, vscodeHostStatus]);

  const handleRenameCurrentSymbol = useCallback(async () => {
    const hostLanguageEnabled = vscodeCompatEnabled && vscodeHostStatus === "ready";
    if (!isCodeIntelligenceSupported && !hostLanguageEnabled) {
      return;
    }
    const currentText = currentContentRef.current;
    const offset = resolveLanguageServiceOffset();
    const previousName = getIdentifierAtOffset(currentText, offset);
    if (!previousName) {
      toast.error(t("workbench.rename.unavailable"));
      return;
    }

    const nextName = window.prompt(t("workbench.rename.prompt"), previousName)?.trim();
    if (!nextName || nextName === previousName) {
      return;
    }

    const targetFilePath = absoluteFilePath ?? filePath;
    if (!targetFilePath) {
      toast.error(t("workbench.rename.unavailable"));
      return;
    }

    try {
      if (hostLanguageEnabled) {
        const version = vscodeDocumentVersionRef.current;
        const response = await requestVSCodeHostLanguageFeature({
          feature: "rename",
          filePath: targetFilePath,
          languageId: language,
          version,
          position: textOffsetToVSCodePosition(currentText, offset ?? 0),
          newName: nextName,
        });
        const applied = applyVSCodeRenameResponse(
          currentText,
          response,
          vscodeDocumentVersionRef.current,
          targetFilePath,
        );
        if (applied.supported) {
          handleChange(applied.content);
          setReferenceResults([]);
          toast.success(t("workbench.rename.success"), {
            description: `${previousName} -> ${nextName}`,
          });
          return;
        }
        if (applied.reason === "cross-file") {
          toast.error(t("workbench.rename.crossFileUnsupported"));
          return;
        }
      }

      if (!isCodeIntelligenceSupported) {
        toast.error(t("workbench.rename.unavailable"));
        return;
      }
      const references = isTypeScriptLanguageServiceSupported
        ? await getTypeScriptDesktopReferences({
            workspaceRootPath,
            filePath: targetFilePath,
            content: currentText,
            offset: offset ?? 0,
          })
        : isPythonLanguageServiceSupported
          ? await getPythonDesktopReferences({
              workspaceRootPath,
              pythonPath: runnerPreferences.defaultPythonPath,
              filePath: targetFilePath,
              content: currentText,
              offset: offset ?? 0,
            })
          : await getRustDesktopReferences({
              workspaceRootPath,
              filePath: targetFilePath,
              content: currentText,
              offset: offset ?? 0,
            });

      const normalizedTarget = targetFilePath.replace(/\\/g, "/");
      if (references.some((reference) => reference.filePath.replace(/\\/g, "/") !== normalizedTarget)) {
        toast.error(t("workbench.rename.crossFileUnsupported"));
        return;
      }
      if (references.length === 0) {
        toast(t("workbench.references.empty"));
        return;
      }

      const nextContent = applyLocalSymbolRename(currentText, references, previousName, nextName);
      handleChange(nextContent);
      setReferenceResults([]);
      toast.success(t("workbench.rename.success"), {
        description: `${previousName} -> ${nextName}`,
      });
    } catch (error) {
      toast.error(t("workbench.rename.failed"), {
        description: messageFromUnknownError(error),
      });
    }
  }, [
    absoluteFilePath,
    filePath,
    handleChange,
    isCodeIntelligenceSupported,
    isPythonLanguageServiceSupported,
    isTypeScriptLanguageServiceSupported,
    language,
    requestVSCodeHostLanguageFeature,
    runnerPreferences.defaultPythonPath,
    t,
    workspaceRootPath,
    resolveLanguageServiceOffset,
    vscodeCompatEnabled,
    vscodeHostStatus,
  ]);

  const typeScriptInteractionExtensions = useMemo<Extension[]>(() => {
    const hostLanguageEnabled = vscodeCompatEnabled && vscodeHostStatus === "ready";
    const nativeLanguageEnabled = isCodeIntelligenceSupported &&
      (!isTypeScriptLanguageServiceSupported || canUseTypeScriptDesktopService()) &&
      (!isPythonLanguageServiceSupported || canUsePythonDesktopService()) &&
      (!isRustLanguageServiceSupported || canUseRustDesktopService());
    if (!hostLanguageEnabled && !nativeLanguageEnabled) {
      return [];
    }

    return [
      keymap.of([
        {
          key: "F12",
          run: () => {
            void handleGoToTypeScriptDefinition();
            return true;
          },
        },
        {
          key: "Shift-F12",
          run: () => {
            void handleFindTypeScriptReferences();
            return true;
          },
        },
        {
          key: "F2",
          run: () => {
            void handleRenameCurrentSymbol();
            return true;
          },
        },
      ]),
      EditorView.domEventHandlers({
        click: (event, view) => {
          const mouseEvent = event as MouseEvent;
          if (!(mouseEvent.metaKey || mouseEvent.ctrlKey)) {
            return false;
          }
          const position = view.posAtCoords({ x: mouseEvent.clientX, y: mouseEvent.clientY });
          if (position === null) {
            return false;
          }
          void handleGoToTypeScriptDefinitionAtOffset(position);
          mouseEvent.preventDefault();
          return true;
        },
      }),
    ];
  }, [
    handleFindTypeScriptReferences,
    handleGoToTypeScriptDefinition,
    handleGoToTypeScriptDefinitionAtOffset,
    handleRenameCurrentSymbol,
    isCodeIntelligenceSupported,
    isPythonLanguageServiceSupported,
    isRustLanguageServiceSupported,
    isTypeScriptLanguageServiceSupported,
    vscodeCompatEnabled,
    vscodeHostStatus,
  ]);

  const debugEditorExtensions = useMemo<Extension[]>(() => {
    if (!absoluteFilePath || isReadOnly || !isTauriHost()) return [];
    const normalizedFilePath = normalizeDebugSourcePath(absoluteFilePath);
    return [createDebugEditorExtension({
      filePath: absoluteFilePath,
      getSnapshot: () => {
        const state = useVSCodeDebugStore.getState();
        const selectedFrame = state.stackFrames.find(
          (frame) => frame.id === state.selectedFrameId,
        );
        const activeSourcePath = selectedFrame?.source?.path;
        return {
          breakpoints: state.breakpoints[normalizedFilePath] ?? [],
          activeLine: activeSourcePath
            && normalizeDebugSourcePath(activeSourcePath) === normalizedFilePath
            ? selectedFrame.line
            : null,
        };
      },
      subscribe: (listener) => useVSCodeDebugStore.subscribe(() => listener()),
      onToggle: (path, line) => useVSCodeDebugStore.getState().toggleBreakpoint(path, line),
    })];
  }, [absoluteFilePath, isReadOnly]);

  const codeEditorExtensions = useMemo<Extension[]>(() => [
    ...vscodeLanguageEditorExtensions,
    ...typeScriptHoverExtension,
    ...typeScriptInteractionExtensions,
    ...debugEditorExtensions,
  ], [debugEditorExtensions, typeScriptHoverExtension, typeScriptInteractionExtensions, vscodeLanguageEditorExtensions]);

  const handleFormatWithVSCodeExtension = useCallback(async () => {
    const targetPath = absoluteFilePath ?? filePath;
    if (!targetPath || !vscodeCompatEnabled || vscodeHostStatus !== "ready") {
      toast.error(t("workbench.format.failed"));
      return;
    }
    try {
      const version = vscodeDocumentVersionRef.current;
      const response = await requestVSCodeHostLanguageFeature({
        feature: "formatting",
        filePath: targetPath,
        languageId: language,
        version,
        formattingOptions: {
          tabSize: vscodeCompatSettings.tabSize,
          insertSpaces: vscodeCompatSettings.insertSpaces,
        },
      });
      const formatted = applyVSCodeFormattingResponse(
        currentContentRef.current,
        response,
        vscodeDocumentVersionRef.current,
      );
      if (formatted === currentContentRef.current) {
        toast(t("workbench.format.noChanges"));
        return;
      }
      handleChange(formatted);
      toast.success(t("workbench.format.success"));
    } catch (error) {
      toast.error(t("workbench.format.failed"), {
        description: messageFromUnknownError(error),
      });
    }
  }, [absoluteFilePath, filePath, handleChange, language, requestVSCodeHostLanguageFeature, t, vscodeCompatEnabled, vscodeCompatSettings.insertSpaces, vscodeCompatSettings.tabSize, vscodeHostStatus]);

  const handleVSCodeQuickFix = useCallback(async () => {
    const targetPath = absoluteFilePath ?? filePath;
    const offset = editorRef.current?.getCursorOffset() ?? 0;
    if (!targetPath || !vscodeCompatEnabled || vscodeHostStatus !== "ready") {
      toast.error(t("workbench.codeAction.failed"));
      return;
    }
    try {
      const version = vscodeDocumentVersionRef.current;
      const position = textOffsetToVSCodePosition(currentContentRef.current, offset);
      const response = await requestVSCodeHostLanguageFeature({
        feature: "codeAction",
        filePath: targetPath,
        languageId: language,
        version,
        range: { start: position, end: position },
        context: { diagnostics: [], only: "quickfix", triggerKind: 1 },
      });
      const action = resolveVSCodeCodeActionResponse(
        currentContentRef.current,
        response,
        vscodeDocumentVersionRef.current,
        targetPath,
      );
      if (!action.supported) {
        if (action.reason === "cross-file") {
          toast.error(t("workbench.rename.crossFileUnsupported"));
        } else {
          toast(t("workbench.codeAction.none"));
        }
        return;
      }
      if (action.content !== currentContentRef.current) {
        handleChange(action.content);
      }
      if (action.command) {
        await runVSCodeHostCommand(action.command.command, action.command.arguments);
      }
      toast.success(action.title || t("workbench.codeAction.applied"));
    } catch (error) {
      toast.error(t("workbench.codeAction.failed"), {
        description: messageFromUnknownError(error),
      });
    }
  }, [absoluteFilePath, filePath, handleChange, language, requestVSCodeHostLanguageFeature, runVSCodeHostCommand, t, vscodeCompatEnabled, vscodeHostStatus]);

  const vscodeTaskActions = useMemo(
    () => (vscodeCompatEnabled ? buildVSCodeTaskActions(vscodeCompatTasks, { workspaceRootPath, onRunTask: handleRunVSCodeTask }) : []),
    [handleRunVSCodeTask, vscodeCompatEnabled, vscodeCompatTasks, workspaceRootPath],
  );
  const vscodeLaunchActions = useMemo(
    () => (vscodeCompatEnabled ? buildVSCodeLaunchActions(vscodeCompatLaunches, { workspaceRootPath, onRunLaunch: handleRunVSCodeLaunch }) : []),
    [handleRunVSCodeLaunch, vscodeCompatEnabled, vscodeCompatLaunches, workspaceRootPath],
  );

  const navigateToOutlineSymbol = useCallback((line: number) => {
    editorRef.current?.scrollToLine(line);
    window.setTimeout(() => {
      editorRef.current?.flashLine(line);
    }, 120);
  }, []);

  const commandBarState = useMemo<CommandBarState>(() => {
    const breadcrumbs = filePath.split("/").filter(Boolean).map((segment) => ({ label: segment }));
    return {
      breadcrumbs,
      actions: [
        {
          id: "save",
          label: t("common.save"),
          icon: "save",
          priority: 10,
          group: "primary",
          disabled: !onSave || isReadOnly,
          onTrigger: () => { void persistFileAndSyncHost(); },
        },
        {
          id: "search",
          label: t("workbench.commandBar.searchInFile"),
          icon: "search",
          tooltip: t("workbench.commandBar.searchInFile"),
          priority: 15,
          group: "secondary",
          onTrigger: () => editorRef.current?.openSearch(),
        },
        {
          id: "goto-line",
          label: t("workbench.commandBar.gotoLine"),
          icon: "scan-search",
          tooltip: t("workbench.commandBar.gotoLine"),
          priority: 16,
          group: "secondary",
          onTrigger: () => editorRef.current?.openGotoLine(),
        },
        ...(isCodeIntelligenceSupported ? [
          {
            id: "code-intelligence-quick-info",
            label: t("workbench.commandBar.quickInfo"),
            icon: "command",
            priority: 16.5,
            group: "secondary" as const,
            onTrigger: () => { void handleShowTypeScriptQuickInfo(); },
          },
          {
            id: "code-intelligence-definition",
            label: t("workbench.commandBar.goToDefinition"),
            icon: "external-link",
            priority: 16.6,
            group: "secondary" as const,
            onTrigger: () => { void handleGoToTypeScriptDefinition(); },
          },
          {
            id: "code-intelligence-references",
            label: t("workbench.commandBar.findReferences"),
            icon: "search",
            priority: 16.7,
            group: "secondary" as const,
            onTrigger: () => { void handleFindTypeScriptReferences(); },
          },
          {
            id: "rename-symbol",
            label: t("workbench.commandBar.renameSymbol"),
            icon: "type",
            priority: 16.8,
            group: "secondary" as const,
            onTrigger: () => { void handleRenameCurrentSymbol(); },
          },
        ] : []),
        ...(!isCodeIntelligenceSupported && vscodeCompatEnabled && vscodeHostStatus === "ready" ? [{
          id: "vscode-extension-definition",
          label: t("workbench.commandBar.goToDefinition"),
          icon: "external-link" as const,
          priority: 16.6,
          group: "secondary" as const,
          onTrigger: () => { void handleGoToTypeScriptDefinition(); },
        }, {
          id: "vscode-extension-references",
          label: t("workbench.commandBar.findReferences"),
          icon: "search" as const,
          priority: 16.7,
          group: "secondary" as const,
          onTrigger: () => { void handleFindTypeScriptReferences(); },
        }, {
          id: "vscode-extension-rename",
          label: t("workbench.commandBar.renameSymbol"),
          icon: "type" as const,
          priority: 16.8,
          group: "secondary" as const,
          onTrigger: () => { void handleRenameCurrentSymbol(); },
        }] : []),
        ...(vscodeCompatEnabled && vscodeHostStatus === "ready" && !isReadOnly ? [{
          id: "vscode-format-document",
          label: t("workbench.commandBar.formatDocument"),
          icon: "command" as const,
          priority: 16.9,
          group: "secondary" as const,
          onTrigger: () => { void handleFormatWithVSCodeExtension(); },
        }, {
          id: "vscode-quick-fix",
          label: t("workbench.commandBar.quickFix"),
          icon: "command" as const,
          priority: 16.95,
          group: "secondary" as const,
          onTrigger: () => { void handleVSCodeQuickFix(); },
        }] : []),
        {
          id: "outline",
          label: outlineOpen ? t("workbench.commandBar.hideOutline") : t("workbench.commandBar.showOutline"),
          icon: "list-tree",
          tooltip: outlineOpen ? t("workbench.commandBar.hideOutline") : t("workbench.commandBar.showOutline"),
          priority: 17,
          group: "secondary",
          active: outlineOpen,
          onTrigger: () => setOutlineOpen((value) => !value),
        },
        ...extraCommandActions,
        ...vscodeTaskActions,
        ...vscodeLaunchActions,
        {
          id: isRunning ? "stop" : "run",
          label: isRunning ? t("workbench.commandBar.stop") : t("workbench.commandBar.run"),
          icon: isRunning ? "square" : "play",
          priority: 20,
          group: "primary",
          disabled: !canRun || (isRunning ? !commandState.canStop : !commandState.canRun),
          onTrigger: isRunning ? () => { void terminate(); } : () => { void handleRun(); },
        },
        {
          id: "rerun",
          label: t("workbench.commandBar.rerun"),
          icon: "rotate-cw",
          priority: 21,
          group: "secondary",
          disabled: !commandState.canRerun,
          onTrigger: () => { void handleRerun(); },
        },
        {
          id: "show-run-output",
          label: t("workbench.commandBar.showRun"),
          icon: "file-output",
          priority: 30,
          group: "secondary",
          active: showOutput && activeDockTab === "run",
          onTrigger: () => {
            setActiveDockTab("run");
            setShowOutput(true);
          },
        },
        {
          id: "show-problems",
          label: t("workbench.commandBar.showProblems"),
          icon: "check-circle",
          priority: 31,
          group: "secondary",
          active: showOutput && activeDockTab === "problems",
          onTrigger: () => {
            setActiveDockTab("problems");
            setShowOutput(true);
          },
        },
        {
          id: "verify",
          label: t("workbench.commandBar.verify"),
          icon: "check-circle",
          priority: 40,
          group: "utility",
          disabled: !canRun,
          onTrigger: () => {
            void refreshRunnerHealth();
            setActiveDockTab("problems");
            setShowOutput(true);
          },
        },
      ],
    };
  }, [
    activeDockTab,
    canRun,
    filePath,
    handleRerun,
    handleRun,
    handleGoToTypeScriptDefinition,
    handleFindTypeScriptReferences,
    handleShowTypeScriptQuickInfo,
    handleRenameCurrentSymbol,
    handleFormatWithVSCodeExtension,
    handleVSCodeQuickFix,
    extraCommandActions,
    isReadOnly,
    isRunning,
    isCodeIntelligenceSupported,
    onSave,
    outlineOpen,
    persistFileAndSyncHost,
    refreshRunnerHealth,
    vscodeLaunchActions,
    vscodeCompatEnabled,
    vscodeHostStatus,
    vscodeTaskActions,
    setActiveDockTab,
    setShowOutput,
    showOutput,
    t,
    terminate,
    commandState.canRun,
    commandState.canRerun,
    commandState.canStop,
  ]);

  usePaneCommandBar({
    paneId,
    scopeId: executionScopeId,
    state: commandBarState,
  });

  const renderEditorSurface = useCallback(() => (
    <div className="flex h-full min-h-0 overflow-hidden">
      <CodeOutlinePanel
        symbols={outlineSymbols}
        isOpen={outlineOpen}
        onClose={() => setOutlineOpen(false)}
        onNavigate={navigateToOutlineSymbol}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <CodeEditor
          onReady={handleEditorReady}
          initialValue={content}
          language={language}
          onChange={handleChange}
          isReadOnly={isReadOnly || !onContentChange}
          autoHeight={false}
          fileId={fileName}
          className="h-full"
          editorRef={editorRef}
          basicCompletion={enableHeavyEditorFeatures}
          syntaxDiagnostics={enableHeavyEditorFeatures}
          extraExtensions={codeEditorExtensions}
          problemContext={executionContext}
          onProblemsChange={setSyntaxProblems}
        />
      </div>
    </div>
  ), [
    content,
    codeEditorExtensions,
    enableHeavyEditorFeatures,
    executionContext,
    fileName,
    handleChange,
    handleEditorReady,
    isReadOnly,
    language,
    navigateToOutlineSymbol,
    onContentChange,
    outlineOpen,
    outlineSymbols,
  ]);

  const renderDock = useCallback((expanded: boolean) => (
    <div className={expanded ? "code-workbench-elevated flex h-full min-h-0 flex-col border-t" : "code-workbench-elevated border-t"}>
      <HorizontalScrollStrip
        className="border-b border-border bg-[var(--code-surface-muted)]"
        viewportClassName="px-3 py-1.5"
        contentClassName="min-w-full w-max justify-between gap-3"
        ariaLabel={t("workbench.runner.managerCode")}
      >
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setShowOutput((value) => !value)}
            className="code-workbench-inline-button flex items-center gap-1 text-xs transition-colors"
          >
            {showOutput ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
            <span>{showOutput ? t("workbench.dock.hide") : t("workbench.dock.show")}</span>
          </button>
          <div className="code-workbench-panel flex items-center gap-1 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => {
                setActiveDockTab("run");
                setShowOutput(true);
              }}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${activeDockTab === "run" ? "code-workbench-status-info" : "code-workbench-inline-button"}`}
            >
              {t("workbench.dock.run")}
              {outputs.length > 0 ? (
                <span className="code-workbench-status-info ml-1 rounded px-1 py-0.5 text-[10px]">{outputs.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveDockTab("problems");
                setShowOutput(true);
              }}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${activeDockTab === "problems" ? "code-workbench-status-error" : "code-workbench-inline-button"}`}
            >
              {t("workbench.dock.problems")}
              {problems.length > 0 ? (
                <span className="code-workbench-status-error ml-1 rounded px-1 py-0.5 text-[10px]">{problems.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveDockTab("references");
                setShowOutput(true);
              }}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${activeDockTab === "references" ? "code-workbench-status-info" : "code-workbench-inline-button"}`}
            >
              {t("workbench.dock.references")}
              {referenceResults.length > 0 ? (
                <span className="code-workbench-status-info ml-1 rounded px-1 py-0.5 text-[10px]">{referenceResults.length}</span>
              ) : null}
            </button>
          </div>
        </div>

        <div className="code-workbench-soft-text flex shrink-0 items-center gap-2 text-[10px]">
          {summary.startedAt && <span>{t("workbench.runner.started")}</span>}
          {durationLabel && <span>{durationLabel}</span>}
          {summary.exitCode !== null && <span>{t("workbench.runner.exit", { code: summary.exitCode })}</span>}
          {runnerHealthSnapshot.issues.length > 0 && (
            <span className="code-workbench-status-warning inline-flex items-center gap-1 rounded px-2 py-1">
              <AlertTriangle className="h-3 w-3" />
              <span>{t("workbench.runner.health", { count: runnerHealthSnapshot.issues.length })}</span>
            </span>
          )}
          <WorkspaceRunnerManager
            cwd={runCwd}
            fileKey={filePath}
            commands={runnerCommand ? [runnerCommand] : []}
            title={t("workbench.runner.managerCode")}
            triggerLabel={t("workbench.runner.trigger")}
          />
          {expanded && (outputs.length > 0 || problems.length > 0 || referenceResults.length > 0) && (
            <button
              onClick={clearOutputs}
              className="code-workbench-inline-button rounded p-1 transition-colors"
              title={t("workbench.dock.clearFeedback")}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </HorizontalScrollStrip>

      {expanded ? (
          <div className="h-full min-h-0 overflow-auto p-3">
            <KernelStatus status={runnerStatus} error={runnerError} />
            {activeDockTab === "run" ? (
            <>
              <OutputArea
                outputs={outputs}
                meta={panelMeta}
                context={panelMeta.context ?? executionContext}
                showDiagnosticsInline={false}
                onSelectProblem={navigateToProblem}
              />
              {outputs.length === 0 && !runnerError && runnerStatus !== "loading" && runnerStatus !== "running" && (
                <p className="code-workbench-muted-text py-4 text-center text-xs">
                  {t("workbench.runner.noOutput")}
                </p>
              )}
            </>
          ) : activeDockTab === "references" ? (
            <div className="space-y-2">
              {referenceResults.length === 0 ? (
                <p className="code-workbench-muted-text py-4 text-center text-xs">
                  {t("workbench.references.empty")}
                </p>
              ) : referenceResults.map((reference, index) => (
                <button
                  key={`${reference.filePath}:${reference.line}:${reference.column}:${index}`}
                  type="button"
                  className="code-workbench-panel w-full rounded-md p-2 text-left"
                  onClick={() => navigateToReference(reference)}
                >
                  <div className="font-medium">{reference.filePath}</div>
                  <div className="code-workbench-soft-text mt-1 text-[11px]">
                    Line {reference.line}, Col {reference.column}
                  </div>
                  {reference.text ? (
                    <div className="code-workbench-soft-text mt-1 truncate text-[11px]">{reference.text}</div>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <>
              <ProblemsPanel problems={problems} onSelectProblem={navigateToProblem} />
              {problems.length === 0 ? (
                <p className="code-workbench-muted-text py-4 text-center text-xs">
                  {t("workbench.runner.noProblems")}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  ), [
    activeDockTab,
    clearOutputs,
    durationLabel,
    filePath,
    navigateToProblem,
    outputs,
    panelMeta,
    problems,
    referenceResults,
    runCwd,
    runnerCommand,
    runnerError,
    runnerHealthSnapshot.issues.length,
    runnerStatus,
    setActiveDockTab,
    setShowOutput,
    showOutput,
    summary.exitCode,
    summary.startedAt,
    t,
    navigateToReference,
  ]);

  return (
    <div
      ref={editorContainerRef}
      className="code-workbench-shell h-full flex flex-col overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      <SelectionContextMenu
        state={selectionMenuState}
        onClose={closeSelectionMenu}
        onOpenHub={(context, mode, returnFocusTo) => setSelectionHubState({ context, mode, returnFocusTo })}
        extraActions={runnerDefinition?.supportsInlineCode ? [{
          id: "run-selection",
          label: t("workbench.runner.runSelection"),
          onSelect: () => {
            void handleRunSelection();
          },
        }] : []}
      />

      <SelectionAiHub
        context={selectionHubState?.context ?? null}
        initialMode={selectionHubState?.mode ?? "chat"}
        returnFocusTo={selectionHubState?.returnFocusTo}
        onClose={() => setSelectionHubState(null)}
      />

      {canRun && shouldRenderDock && showOutput ? (
        <ResizablePanelGroup
          direction="vertical"
          className="flex-1 min-h-0"
          sizes={[100 - dockSize, dockSize]}
          onSizesChange={(sizes) => {
            if (sizes[1]) {
              setDockSize(sizes[1]);
            }
          }}
        >
          <ResizablePanel index={0} defaultSize={100 - dockSize} minSize={30} className="min-h-0 overflow-hidden">
            {renderEditorSurface()}
          </ResizablePanel>
          <ResizableHandle withHandle index={0} />
          <ResizablePanel index={1} defaultSize={dockSize} minSize={18} className="min-h-0 overflow-hidden">
            {renderDock(true)}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <>
          <div className="flex-1 min-h-0 overflow-hidden">
            {renderEditorSurface()}
          </div>
          {canRun && shouldRenderDock ? renderDock(false) : null}
        </>
      )}
    </div>
  );
}

export default CodeEditorViewer;
