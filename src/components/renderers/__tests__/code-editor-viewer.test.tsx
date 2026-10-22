/**
 * CodeEditorViewer Debounce Logic Tests
 * 
 * Feature: unified-codemirror-engine
 * Property 4: Debounced Save on Content Change
 * Validates: Requirements 4.5
 * 
 * Note: These tests verify the debounce behavior using a simplified mock
 * to avoid CodeMirror initialization complexity in the test environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CodeEditorViewer } from "../code-editor-viewer";
import type { ReactNode } from "react";
import type { CommandBarState } from "@/types/layout";
import type { RunnerExecutionRequest } from "@/lib/runner/types";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";

const paneCommandBarInputs = vi.hoisted(() => [] as Array<{
  paneId: string | null | undefined;
  scopeId?: string | null;
  state: CommandBarState | null;
}>);
const capturedCodeEditorProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

const stableRunnerState = vi.hoisted(() => ({
  status: "idle",
  outputs: [],
  panelMeta: { origin: null, diagnostics: [], context: null },
  error: null,
  summary: {
    startedAt: null,
    completedAt: null,
    durationMs: null,
    exitCode: null,
    terminated: false,
  },
  problems: [],
  run: vi.fn(async () => ({ success: true })),
  terminate: vi.fn(async () => undefined),
  clearOutputs: vi.fn(),
  setPanelMeta: vi.fn(),
  setExternalProblems: vi.fn(),
  isRunning: false,
  isLoading: false,
  lastRequest: null as RunnerExecutionRequest | null,
  commandState: {
    canRun: true,
    canRerun: false,
    canStop: false,
    canInterrupt: false,
    canRestart: false,
    canVerifyRuntime: false,
    canSelectRuntime: false,
  },
}));

const stableTranslate = vi.hoisted(() => vi.fn((key: string) => key));
const stableRefreshRunnerHealth = vi.hoisted(() => vi.fn(async () => undefined));
const stableEditorCommands = vi.hoisted(() => ({
  isReady: vi.fn(() => true),
  openSearch: vi.fn(),
  openGotoLine: vi.fn(),
  scrollToLine: vi.fn(),
  flashLine: vi.fn(),
  flashRange: vi.fn(() => true),
}));
const stableDockSetters = vi.hoisted(() => ({
  setDockSize: vi.fn(),
  setIsDockOpen: vi.fn(),
  setActiveDockTab: vi.fn(),
}));
const stableTypeScriptService = vi.hoisted(() => ({
  canUseTypeScriptDesktopService: vi.fn(() => true),
  getTypeScriptDesktopDiagnostics: vi.fn(async () => []),
  getTypeScriptDesktopQuickInfo: vi.fn(async () => null),
  getTypeScriptDesktopDefinition: vi.fn(async () => null),
  getTypeScriptDesktopReferences: vi.fn(async () => []),
}));
const stablePythonService = vi.hoisted(() => ({
  canUsePythonDesktopService: vi.fn(() => true),
  getPythonDesktopDiagnostics: vi.fn(async () => []),
  getPythonDesktopQuickInfo: vi.fn(async () => null),
  getPythonDesktopDefinition: vi.fn(async () => null),
  getPythonDesktopReferences: vi.fn(async () => []),
}));
const stableRustService = vi.hoisted(() => ({
  canUseRustDesktopService: vi.fn(() => true),
  getRustDesktopDiagnostics: vi.fn(async () => []),
  getRustDesktopQuickInfo: vi.fn(async () => null),
  getRustDesktopDefinition: vi.fn(async () => null),
  getRustDesktopReferences: vi.fn(async () => []),
}));
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  toast: vi.fn(),
}));
const debugEditorMocks = vi.hoisted(() => ({
  extension: { kind: "debug-editor-extension" },
  createDebugEditorExtension: vi.fn(),
}));

vi.mock("@/lib/storage-adapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage-adapter")>();
  return { ...actual, isTauriHost: () => true };
});

vi.mock("@/lib/vscode-debug/editor-extension", () => ({
  createDebugEditorExtension: debugEditorMocks.createDebugEditorExtension,
}));

vi.mock("@/components/editor/codemirror/code-editor", () => ({
  CodeEditor: (props: { editorRef?: React.RefObject<unknown>; initialValue: string }) => {
    capturedCodeEditorProps.push(props as unknown as Record<string, unknown>);
    const { editorRef } = props;
    if (editorRef && "current" in editorRef) {
      editorRef.current = {
        isReady: stableEditorCommands.isReady,
        focus: vi.fn(),
        scrollToLine: stableEditorCommands.scrollToLine,
        flashLine: stableEditorCommands.flashLine,
        flashRange: stableEditorCommands.flashRange,
        getContent: vi.fn(() => props.initialValue.replace(/\r\n?/g, "\n")),
        getSelection: vi.fn(() => ""),
        getSelectionDetails: vi.fn(() => null),
        hasSelection: vi.fn(() => false),
        getCursorOffset: vi.fn(() => 0),
        getEditorState: vi.fn(() => null),
        restoreEditorState: vi.fn(),
        openSearch: stableEditorCommands.openSearch,
        openGotoLine: stableEditorCommands.openGotoLine,
      };
    }
    return <div data-testid="mock-code-editor" />;
  },
}));

vi.mock("@/hooks/use-pane-command-bar", () => ({
  usePaneCommandBar: (input: {
    paneId: string | null | undefined;
    scopeId?: string | null;
    state: CommandBarState | null;
  }) => {
    paneCommandBarInputs.push(input);
  },
}));

vi.mock("@/hooks/use-execution-runner", () => ({
  useExecutionRunner: () => stableRunnerState,
}));

vi.mock("@/hooks/use-execution-dock-layout", () => ({
  useExecutionDockLayout: () => ({
    dockSize: 38,
    isDockOpen: false,
    activeDockTab: "run",
    setDockSize: stableDockSetters.setDockSize,
    setIsDockOpen: stableDockSetters.setIsDockOpen,
    setActiveDockTab: stableDockSetters.setActiveDockTab,
  }),
}));

vi.mock("@/hooks/use-runner-health", () => ({
  useRunnerHealth: () => ({
    runnerHealthSnapshot: { issues: [] },
    refresh: stableRefreshRunnerHealth,
  }),
}));

vi.mock("@/hooks/use-annotation-navigation", () => ({
  useAnnotationNavigation: () => undefined,
}));

vi.mock("@/hooks/use-text-selection", () => ({
  useTextSelection: () => ({ selection: null, dismiss: vi.fn() }),
}));

vi.mock("@/hooks/use-selection-context-menu", () => ({
  useSelectionContextMenu: () => ({
    menuState: null,
    closeMenu: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({ t: stableTranslate }),
}));

vi.mock("@/components/ai/ai-inline-menu", () => ({
  AiInlineMenu: () => null,
}));

vi.mock("@/components/ai/selection-context-menu", () => ({
  SelectionContextMenu: () => null,
}));

vi.mock("@/components/ai/selection-ai-hub", () => ({
  SelectionAiHub: () => null,
}));

vi.mock("@/components/notebook/output-area", () => ({
  OutputArea: () => null,
}));

vi.mock("@/components/notebook/kernel-status", () => ({
  KernelStatus: () => null,
}));

vi.mock("@/components/runner/problems-panel", () => ({
  ProblemsPanel: () => null,
}));

vi.mock("@/components/runner/workspace-runner-manager", () => ({
  WorkspaceRunnerManager: () => null,
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizableHandle: () => null,
  ResizablePanel: ({ children }: { children: ReactNode }) => <>{children}</>,
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/horizontal-scroll-strip", () => ({
  HorizontalScrollStrip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/typescript-service/desktop", () => ({
  canUseTypeScriptDesktopService: stableTypeScriptService.canUseTypeScriptDesktopService,
  getTypeScriptDesktopDiagnostics: stableTypeScriptService.getTypeScriptDesktopDiagnostics,
  getTypeScriptDesktopQuickInfo: stableTypeScriptService.getTypeScriptDesktopQuickInfo,
  getTypeScriptDesktopDefinition: stableTypeScriptService.getTypeScriptDesktopDefinition,
  getTypeScriptDesktopReferences: stableTypeScriptService.getTypeScriptDesktopReferences,
}));

vi.mock("@/lib/python-service/desktop", () => ({
  canUsePythonDesktopService: stablePythonService.canUsePythonDesktopService,
  getPythonDesktopDiagnostics: stablePythonService.getPythonDesktopDiagnostics,
  getPythonDesktopQuickInfo: stablePythonService.getPythonDesktopQuickInfo,
  getPythonDesktopDefinition: stablePythonService.getPythonDesktopDefinition,
  getPythonDesktopReferences: stablePythonService.getPythonDesktopReferences,
}));

vi.mock("@/lib/rust-service/desktop", () => ({
  canUseRustDesktopService: stableRustService.canUseRustDesktopService,
  getRustDesktopDiagnostics: stableRustService.getRustDesktopDiagnostics,
  getRustDesktopQuickInfo: stableRustService.getRustDesktopQuickInfo,
  getRustDesktopDefinition: stableRustService.getRustDesktopDefinition,
  getRustDesktopReferences: stableRustService.getRustDesktopReferences,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(toastMocks.toast, {
    success: toastMocks.success,
    error: toastMocks.error,
  }),
}));

describe("CodeEditorViewer command bar stability", () => {
  beforeEach(() => {
    paneCommandBarInputs.length = 0;
    capturedCodeEditorProps.length = 0;
    vi.clearAllMocks();
    stableEditorCommands.openSearch.mockClear();
    stableEditorCommands.openGotoLine.mockClear();
    stableEditorCommands.scrollToLine.mockClear();
    stableEditorCommands.flashLine.mockClear();
    stableRunnerState.lastRequest = null;
    stableRunnerState.commandState.canRerun = false;
    stableRunnerState.commandState.canRun = true;
    stableTypeScriptService.getTypeScriptDesktopDiagnostics.mockReset();
    stableTypeScriptService.getTypeScriptDesktopDiagnostics.mockResolvedValue([]);
    stableTypeScriptService.getTypeScriptDesktopQuickInfo.mockReset();
    stableTypeScriptService.getTypeScriptDesktopQuickInfo.mockResolvedValue(null);
    stableTypeScriptService.getTypeScriptDesktopDefinition.mockReset();
    stableTypeScriptService.getTypeScriptDesktopDefinition.mockResolvedValue(null);
    stableTypeScriptService.getTypeScriptDesktopReferences.mockReset();
    stableTypeScriptService.getTypeScriptDesktopReferences.mockResolvedValue([]);
    stablePythonService.getPythonDesktopDiagnostics.mockReset();
    stablePythonService.getPythonDesktopDiagnostics.mockResolvedValue([]);
    stablePythonService.getPythonDesktopQuickInfo.mockReset();
    stablePythonService.getPythonDesktopQuickInfo.mockResolvedValue(null);
    stablePythonService.getPythonDesktopDefinition.mockReset();
    stablePythonService.getPythonDesktopDefinition.mockResolvedValue(null);
    stablePythonService.getPythonDesktopReferences.mockReset();
    stablePythonService.getPythonDesktopReferences.mockResolvedValue([]);
    stableRustService.getRustDesktopDiagnostics.mockReset();
    stableRustService.getRustDesktopDiagnostics.mockResolvedValue([]);
    stableRustService.getRustDesktopQuickInfo.mockReset();
    stableRustService.getRustDesktopQuickInfo.mockResolvedValue(null);
    stableRustService.getRustDesktopDefinition.mockReset();
    stableRustService.getRustDesktopDefinition.mockResolvedValue(null);
    stableRustService.getRustDesktopReferences.mockReset();
    stableRustService.getRustDesktopReferences.mockResolvedValue([]);
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
    toastMocks.toast.mockReset();
    debugEditorMocks.createDebugEditorExtension.mockReset();
    debugEditorMocks.createDebugEditorExtension.mockReturnValue(debugEditorMocks.extension);
  });

  it("keeps command bar state stable when optional extra actions are omitted", () => {
    const props = {
      content: "print('hello')",
      fileName: "script.py",
      onContentChange: vi.fn(),
      onSave: vi.fn(async () => undefined),
      paneId: "pane-code",
      tabId: "tab-script",
      filePath: "workspace/script.py",
      executionScopeId: "pane-code::tab-script",
    };

    const { rerender } = render(<CodeEditorViewer {...props} />);
    const initialState = paneCommandBarInputs.at(-1)?.state;

    rerender(<CodeEditorViewer {...props} />);

    expect(paneCommandBarInputs.at(-1)?.state).toBe(initialState);
  });

  it("keeps editor completion and diagnostics enabled for non-runnable JSON files", () => {
    render(
      <CodeEditorViewer
        content={'{"enabled": true}'}
        fileName="settings.json"
        onContentChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        paneId="pane-code"
        tabId="tab-settings"
        filePath="workspace/settings.json"
        executionScopeId="pane-code::tab-settings"
      />,
    );

    expect(capturedCodeEditorProps.at(-1)).toMatchObject({
      language: "json",
      basicCompletion: true,
      syntaxDiagnostics: true,
    });
    const runAction = paneCommandBarInputs.at(-1)?.state?.actions.find((action) => action.id === "run");
    expect(runAction?.disabled).toBe(true);
  });

  it("registers editor workflow actions in the command bar", async () => {
    const props = {
      content: "print('hello')",
      fileName: "script.py",
      onContentChange: vi.fn(),
      onSave: vi.fn(async () => undefined),
      paneId: "pane-code",
      tabId: "tab-script",
      filePath: "workspace/script.py",
      executionScopeId: "pane-code::tab-script",
    };

    render(<CodeEditorViewer {...props} />);

    const actions = paneCommandBarInputs.at(-1)?.state?.actions ?? [];
    const actionById = new Map(actions.map((action) => [action.id, action]));

    expect(actionById.has("search")).toBe(true);
    expect(actionById.has("goto-line")).toBe(true);
    expect(actionById.has("show-run-output")).toBe(true);
    expect(actionById.has("show-problems")).toBe(true);
    expect(actionById.has("verify")).toBe(true);

    actionById.get("search")?.onTrigger?.();
    expect(stableEditorCommands.openSearch).toHaveBeenCalledTimes(1);

    actionById.get("goto-line")?.onTrigger?.();
    expect(stableEditorCommands.openGotoLine).toHaveBeenCalledTimes(1);

    actionById.get("show-run-output")?.onTrigger?.();
    expect(stableDockSetters.setActiveDockTab).toHaveBeenCalledWith("run");
    expect(stableDockSetters.setIsDockOpen).toHaveBeenCalledWith(true);

    actionById.get("show-problems")?.onTrigger?.();
    expect(stableDockSetters.setActiveDockTab).toHaveBeenCalledWith("problems");
    expect(stableDockSetters.setIsDockOpen).toHaveBeenCalledWith(true);

    await act(async () => {
      await actionById.get("verify")?.onTrigger?.();
    });
    expect(stableRefreshRunnerHealth).toHaveBeenCalledTimes(1);
    expect(stableDockSetters.setActiveDockTab).toHaveBeenCalledWith("problems");
  });

  it("merges TypeScript desktop diagnostics into external problems for ts/js files", async () => {
    vi.useFakeTimers();
    try {
      (
        stableTypeScriptService.getTypeScriptDesktopDiagnostics as unknown as {
          mockResolvedValue: (value: Array<{
            filePath: string;
            line: number;
            column: number;
            severity: "info" | "warning" | "error";
            code?: string | null;
            message: string;
          }>) => void;
        }
      ).mockResolvedValue([
        {
          filePath: "workspace/script.ts",
          line: 3,
          column: 7,
          severity: "error",
          code: "2322",
          message: "Type 'string' is not assignable to type 'number'.",
        },
      ] as Array<{
        filePath: string;
        line: number;
        column: number;
          severity: "info" | "warning" | "error";
          code?: string | null;
          message: string;
        }>);

      render(
        <CodeEditorViewer
          content={"const value: number = 'oops';"}
          fileName="script.ts"
          onContentChange={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          paneId="pane-code"
          tabId="tab-script"
          filePath="workspace/script.ts"
          executionScopeId="pane-code::tab-script"
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(stableTypeScriptService.getTypeScriptDesktopDiagnostics).toHaveBeenCalled();
      expect(stableRunnerState.setExternalProblems).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            title: "TypeScript 2322",
            code: "2322",
            source: "preflight",
          }),
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("merges Python desktop diagnostics into external problems for python files", async () => {
    vi.useFakeTimers();
    try {
      (
        stablePythonService.getPythonDesktopDiagnostics as unknown as {
          mockResolvedValue: (value: Array<{
            filePath: string;
            line: number;
            column: number;
            severity: "info" | "warning" | "error";
            code?: string | null;
            message: string;
          }>) => void;
        }
      ).mockResolvedValue([
        {
          filePath: "workspace/script.py",
          line: 2,
          column: 5,
          severity: "error",
          code: "syntax",
          message: "invalid syntax",
        },
      ]);

      render(
        <CodeEditorViewer
          content={"def broken(:\n    pass"}
          fileName="script.py"
          onContentChange={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          paneId="pane-code"
          tabId="tab-script"
          filePath="workspace/script.py"
          executionScopeId="pane-code::tab-script"
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(stablePythonService.getPythonDesktopDiagnostics).toHaveBeenCalled();
      expect(stableRunnerState.setExternalProblems).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            title: "Python syntax",
            code: "syntax",
            source: "preflight",
          }),
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds TypeScript quick info and definition actions for ts/js files", async () => {
    (
      stableTypeScriptService.getTypeScriptDesktopQuickInfo as unknown as {
        mockResolvedValue: (value: { display: string; documentation?: string | null } | null) => void;
      }
    ).mockResolvedValue({
      display: "const value: number",
      documentation: "demo doc",
    });
    (
      stableTypeScriptService.getTypeScriptDesktopDefinition as unknown as {
        mockResolvedValue: (value: { filePath: string; line: number; column: number } | null) => void;
      }
    ).mockResolvedValue({
      filePath: "workspace/script.ts",
      line: 2,
      column: 1,
    });

    render(
      <CodeEditorViewer
        content={"const value: number = 42;"}
        fileName="script.ts"
        onContentChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        paneId="pane-code"
        tabId="tab-script"
        filePath="workspace/script.ts"
        executionScopeId="pane-code::tab-script"
      />,
    );

    const actions = paneCommandBarInputs.at(-1)?.state?.actions ?? [];
    const actionById = new Map(actions.map((action) => [action.id, action]));
    expect(actionById.has("code-intelligence-quick-info")).toBe(true);
    expect(actionById.has("code-intelligence-definition")).toBe(true);

    await act(async () => {
      await actionById.get("code-intelligence-quick-info")?.onTrigger?.();
    });
    expect(stableTypeScriptService.getTypeScriptDesktopQuickInfo).toHaveBeenCalled();
    expect(toastMocks.success).toHaveBeenCalled();

    await act(async () => {
      await actionById.get("code-intelligence-definition")?.onTrigger?.();
    });
    expect(stableTypeScriptService.getTypeScriptDesktopDefinition).toHaveBeenCalled();
    expect(stableEditorCommands.scrollToLine).toHaveBeenCalledWith(2);
  });

  it("adds TypeScript references action and opens references panel results", async () => {
    (
      stableTypeScriptService.getTypeScriptDesktopReferences as unknown as {
        mockResolvedValue: (value: Array<{ filePath: string; line: number; column: number; text?: string | null }>) => void;
      }
    ).mockResolvedValue([
      {
        filePath: "workspace/script.ts",
        line: 4,
        column: 3,
        text: "value = value + 1",
      },
    ]);

    render(
      <CodeEditorViewer
        content={"const value: number = 42;"}
        fileName="script.ts"
        onContentChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        paneId="pane-code"
        tabId="tab-script"
        filePath="workspace/script.ts"
        executionScopeId="pane-code::tab-script"
      />,
    );

    const actions = paneCommandBarInputs.at(-1)?.state?.actions ?? [];
    const actionById = new Map(actions.map((action) => [action.id, action]));
    expect(actionById.has("code-intelligence-references")).toBe(true);

    await act(async () => {
      await actionById.get("code-intelligence-references")?.onTrigger?.();
    });

    expect(stableTypeScriptService.getTypeScriptDesktopReferences).toHaveBeenCalled();
    expect(stableDockSetters.setActiveDockTab).toHaveBeenCalledWith("references");
    expect(stableDockSetters.setIsDockOpen).toHaveBeenCalledWith(true);
  });

  it("adds rename action for code intelligence files", () => {
    render(
      <CodeEditorViewer
        content={"const value: number = 42;"}
        fileName="script.ts"
        onContentChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        paneId="pane-code"
        tabId="tab-script"
        filePath="workspace/script.ts"
        executionScopeId="pane-code::tab-script"
      />,
    );

    const actions = paneCommandBarInputs.at(-1)?.state?.actions ?? [];
    const actionById = new Map(actions.map((action) => [action.id, action]));
    expect(actionById.has("rename-symbol")).toBe(true);
  });

  it("adds Python quick info and definition actions for python files", async () => {
    (
      stablePythonService.getPythonDesktopQuickInfo as unknown as {
        mockResolvedValue: (value: { display: string; documentation?: string | null } | null) => void;
      }
    ).mockResolvedValue({
      display: "def simulate(system, steps)",
      documentation: "Run the simulation loop.",
    });
    (
      stablePythonService.getPythonDesktopDefinition as unknown as {
        mockResolvedValue: (value: { filePath: string; line: number; column: number } | null) => void;
      }
    ).mockResolvedValue({
      filePath: "workspace/script.py",
      line: 2,
      column: 1,
    });

    render(
      <CodeEditorViewer
        content={"def simulate(system, steps):\n    return steps\nsimulate(obj, 3)"}
        fileName="script.py"
        onContentChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        paneId="pane-code"
        tabId="tab-script"
        filePath="workspace/script.py"
        executionScopeId="pane-code::tab-script"
      />,
    );

    const actions = paneCommandBarInputs.at(-1)?.state?.actions ?? [];
    const actionById = new Map(actions.map((action) => [action.id, action]));
    expect(actionById.has("code-intelligence-quick-info")).toBe(true);
    expect(actionById.has("code-intelligence-definition")).toBe(true);

    await act(async () => {
      await actionById.get("code-intelligence-quick-info")?.onTrigger?.();
    });
    expect(stablePythonService.getPythonDesktopQuickInfo).toHaveBeenCalled();

    await act(async () => {
      await actionById.get("code-intelligence-definition")?.onTrigger?.();
    });
    expect(stablePythonService.getPythonDesktopDefinition).toHaveBeenCalled();
    expect(stableEditorCommands.scrollToLine).toHaveBeenCalledWith(2);
  });

  it("adds Rust quick info and definition actions for rust files", async () => {
    (
      stableRustService.getRustDesktopQuickInfo as unknown as {
        mockResolvedValue: (value: { display: string; documentation?: string | null } | null) => void;
      }
    ).mockResolvedValue({
      display: "fn compute(value: i32) -> i32",
      documentation: "Compute the transformed value.",
    });
    (
      stableRustService.getRustDesktopDefinition as unknown as {
        mockResolvedValue: (value: { filePath: string; line: number; column: number } | null) => void;
      }
    ).mockResolvedValue({
      filePath: "workspace/script.rs",
      line: 2,
      column: 1,
    });

    render(
      <CodeEditorViewer
        content={"fn compute(value: i32) -> i32 { value + 1 }\nfn main() { let x = compute(1); }"}
        fileName="script.rs"
        onContentChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        paneId="pane-code"
        tabId="tab-script"
        filePath="workspace/script.rs"
        executionScopeId="pane-code::tab-script"
      />,
    );

    const actions = paneCommandBarInputs.at(-1)?.state?.actions ?? [];
    const actionById = new Map(actions.map((action) => [action.id, action]));
    expect(actionById.has("code-intelligence-quick-info")).toBe(true);
    expect(actionById.has("code-intelligence-definition")).toBe(true);

    await act(async () => {
      await actionById.get("code-intelligence-quick-info")?.onTrigger?.();
    });
    expect(stableRustService.getRustDesktopQuickInfo).toHaveBeenCalled();

    await act(async () => {
      await actionById.get("code-intelligence-definition")?.onTrigger?.();
    });
    expect(stableRustService.getRustDesktopDefinition).toHaveBeenCalled();
    expect(stableEditorCommands.scrollToLine).toHaveBeenCalledWith(2);
  });

  it("passes TypeScript hover and interaction extensions into the code editor", () => {
    render(
      <CodeEditorViewer
        content={"const value: number = 42;"}
        fileName="script.ts"
        onContentChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        paneId="pane-code"
        tabId="tab-script"
        filePath="workspace/script.ts"
        executionScopeId="pane-code::tab-script"
      />,
    );

    const latestProps = capturedCodeEditorProps.at(-1);
    expect(Array.isArray(latestProps?.extraExtensions)).toBe(true);
    expect((latestProps?.extraExtensions as unknown[]).length).toBeGreaterThan(0);
  });

  it("installs the native debug extension with the canonical workspace file path", () => {
    useWorkspaceStore.getState().setWorkspaceRootPath("C:/workspace");

    render(
      <CodeEditorViewer
        content={"value = 42\nprint(value)"}
        fileName="script.py"
        onContentChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        paneId="pane-code"
        tabId="tab-script"
        filePath="script.py"
        executionScopeId="pane-code::tab-script"
      />,
    );

    expect(debugEditorMocks.createDebugEditorExtension).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "C:/workspace/script.py" }),
    );
    expect(capturedCodeEditorProps.at(-1)?.extraExtensions).toEqual(
      expect.arrayContaining([debugEditorMocks.extension]),
    );
  });

  it("shows outline symbols and navigates to the selected line", async () => {
    const props = {
      content: [
        "class App:",
        "    def run(self):",
        "        pass",
      ].join("\n"),
      fileName: "script.py",
      onContentChange: vi.fn(),
      onSave: vi.fn(async () => undefined),
      paneId: "pane-code",
      tabId: "tab-script",
      filePath: "workspace/script.py",
      executionScopeId: "pane-code::tab-script",
    };

    render(<CodeEditorViewer {...props} />);

    const outlineAction = paneCommandBarInputs.at(-1)?.state?.actions.find((action) => action.id === "outline");
    expect(outlineAction).toBeTruthy();

    await act(async () => {
      outlineAction?.onTrigger?.();
    });

    expect(screen.getByText("App")).toBeTruthy();
    expect(screen.getByText("run")).toBeTruthy();

    fireEvent.click(screen.getByText("run"));
    expect(stableEditorCommands.scrollToLine).toHaveBeenCalledWith(2);
  });

  it("blocks file run when saving fails", async () => {
    const saveError = new Error("disk is full");
    const props = {
      content: "print('hello')",
      fileName: "script.py",
      onContentChange: vi.fn(),
      onSave: vi.fn(async () => {
        throw saveError;
      }),
      paneId: "pane-code",
      tabId: "tab-script",
      filePath: "workspace/script.py",
      executionScopeId: "pane-code::tab-script",
    };

    render(<CodeEditorViewer {...props} />);

    const runAction = paneCommandBarInputs.at(-1)?.state?.actions.find((action) => action.id === "run");
    expect(runAction).toBeTruthy();

    await act(async () => {
      await runAction?.onTrigger?.();
    });

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(stableRunnerState.run).not.toHaveBeenCalled();
    expect(stableRunnerState.setPanelMeta).toHaveBeenCalledWith(expect.objectContaining({
      origin: null,
      diagnostics: [
        expect.objectContaining({
          severity: "error",
          title: "保存失败，已阻止运行",
          message: "disk is full",
          stage: "request-build",
        }),
      ],
    }));
    expect(stableDockSetters.setIsDockOpen).toHaveBeenCalledWith(true);
    expect(stableDockSetters.setActiveDockTab).toHaveBeenCalledWith("problems");
  });

  it("blocks file rerun when saving fails", async () => {
    stableRunnerState.lastRequest = {
      runnerType: "python-local",
      command: "python",
      filePath: "C:/workspace/script.py",
      cwd: "C:/workspace",
      mode: "file",
    };
    stableRunnerState.commandState.canRerun = true;

    const props = {
      content: "print('hello')",
      fileName: "script.py",
      onContentChange: vi.fn(),
      onSave: vi.fn(async () => {
        throw new Error("permission denied");
      }),
      paneId: "pane-code",
      tabId: "tab-script",
      filePath: "workspace/script.py",
      executionScopeId: "pane-code::tab-script",
    };

    render(<CodeEditorViewer {...props} />);

    const rerunAction = paneCommandBarInputs.at(-1)?.state?.actions.find((action) => action.id === "rerun");
    expect(rerunAction).toBeTruthy();
    expect(rerunAction?.disabled).toBe(false);

    await act(async () => {
      await rerunAction?.onTrigger?.();
    });

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(stableRunnerState.run).not.toHaveBeenCalled();
    expect(stableRunnerState.setPanelMeta).toHaveBeenCalledWith(expect.objectContaining({
      origin: null,
      diagnostics: [
        expect.objectContaining({
          severity: "error",
          title: "保存失败，已阻止重新运行",
          message: "permission denied",
          stage: "request-build",
        }),
      ],
    }));
    expect(stableDockSetters.setIsDockOpen).toHaveBeenCalledWith(true);
    expect(stableDockSetters.setActiveDockTab).toHaveBeenCalledWith("problems");
  });
});

describe("CodeEditorViewer quoted source navigation", () => {
  const props = { content: "Intro\r\nreturn x - y\r\nsecond quote", fileName: "sample.txt",
    filePath: "sample.txt", paneId: "pane-quote", tabId: "sample", executionScopeId: "pane-quote::sample", onContentChange: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers();
    stableEditorCommands.isReady.mockReturnValue(true);
    stableEditorCommands.flashRange.mockReset().mockReturnValue(true);
    stableEditorCommands.flashLine.mockClear();
    useLinkNavigationStore.setState({ pendingByPane: {}, outcomesByRequestId: {} });
  });
  afterEach(() => vi.useRealTimers());
  const navigate = (requestId: string, snippet: string) => act(() => {
    useLinkNavigationStore.getState().setPendingNavigation(props.paneId, {
      requestId, filePath: props.filePath, target: { type: "workspace_text", path: props.filePath, snippet },
    });
  });

  it("frames the exact quote with normalized editor offsets before reporting success", () => {
    render(<CodeEditorViewer {...props} />);
    navigate("exact", "return x - y");
    expect(useLinkNavigationStore.getState().outcomesByRequestId.exact).toBeUndefined();
    act(() => vi.advanceTimersByTime(120));
    expect(stableEditorCommands.flashRange).toHaveBeenCalledWith({ from: 6, to: 18 });
    expect(stableEditorCommands.flashLine).not.toHaveBeenCalled();
    expect(useLinkNavigationStore.getState().outcomesByRequestId.exact?.status).toBe("success");
  });

  it("waits for the asynchronously loaded editor before navigating", () => {
    stableEditorCommands.isReady.mockReturnValue(false);
    render(<CodeEditorViewer {...props} />);
    navigate("loading", "return x - y");
    act(() => vi.advanceTimersByTime(500));
    expect(useLinkNavigationStore.getState().outcomesByRequestId.loading).toBeUndefined();
    expect(stableEditorCommands.flashRange).not.toHaveBeenCalled();
    stableEditorCommands.isReady.mockReturnValue(true);
    act(() => (capturedCodeEditorProps.at(-1)?.onReady as () => void)());
    act(() => vi.advanceTimersByTime(120));
    expect(useLinkNavigationStore.getState().outcomesByRequestId.loading?.status).toBe("success");
  });

  it("does not report success if the source or rendered range cannot be located", () => {
    render(<CodeEditorViewer {...props} />);
    navigate("missing", "return x + y");
    expect(useLinkNavigationStore.getState().outcomesByRequestId.missing?.status).toBe("quote_not_found");
    stableEditorCommands.flashRange.mockReturnValue(false);
    navigate("unrendered", "return x - y");
    act(() => vi.advanceTimersByTime(120));
    expect(useLinkNavigationStore.getState().outcomesByRequestId.unrendered?.status).toBe("quote_not_found");
  });

  it("cancels stale delayed highlights when another citation or file is opened", () => {
    const { unmount } = render(<CodeEditorViewer {...props} />);
    navigate("old", "return x - y");
    act(() => vi.advanceTimersByTime(60));
    navigate("new", "second quote");
    act(() => vi.advanceTimersByTime(120));
    expect(stableEditorCommands.flashRange).toHaveBeenCalledTimes(1);
    expect(stableEditorCommands.flashRange).toHaveBeenCalledWith({ from: 19, to: 31 });
    navigate("unmounted", "return x - y");
    unmount();
    act(() => vi.advanceTimersByTime(120));
    expect(stableEditorCommands.flashRange).toHaveBeenCalledTimes(1);
  });
});

/**
 * Simplified debounce implementation matching CodeEditorViewer
 */
function createDebouncedSave(
  onContentChange: (content: string) => void,
  onSave: (() => Promise<void>) | undefined,
  debounceDelay: number
) {
  let debounceTimer: NodeJS.Timeout | null = null;
  let hasChanged = false;
  let currentContent = "";

  return {
    handleChange: (newContent: string) => {
      // Notify parent immediately
      onContentChange(newContent);
      currentContent = newContent;
      hasChanged = true;

      // Clear existing timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // Set new debounce timer
      if (onSave) {
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          if (!hasChanged) return;
          const contentAtSave = currentContent;
          void onSave()
            .then(() => {
              if (currentContent === contentAtSave) hasChanged = false;
            })
            .catch((error) => {
              hasChanged = true;
              console.error(error);
            });
        }, debounceDelay);
      }
    },
    cleanup: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    },
  };
}

describe("CodeEditorViewer Debounce Logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Feature: unified-codemirror-engine
   * Property 4: Debounced Save on Content Change
   * Validates: Requirements 4.5
   * 
   * For any content change in the CodeEditor within File_Viewer, the save
   * function SHALL be called exactly once after the debounce period, with
   * the final content value.
   */
  describe("Property 4: Debounced Save on Content Change", () => {
    const DEBOUNCE_DELAY = 500;

    it("should call onContentChange immediately on change", () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { handleChange } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      handleChange("new content");

      // onContentChange should be called immediately
      expect(onContentChange).toHaveBeenCalledTimes(1);
      expect(onContentChange).toHaveBeenCalledWith("new content");
    });

    it("should debounce save calls", () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { handleChange } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      // Make multiple rapid changes
      handleChange("change 1");
      handleChange("change 2");
      handleChange("change 3");

      // Save should not be called yet (within debounce period)
      expect(onSave).not.toHaveBeenCalled();

      // Advance timers past debounce period
      vi.advanceTimersByTime(DEBOUNCE_DELAY + 100);

      // Save should be called exactly once
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("should call onContentChange for each change but save only once", () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { handleChange } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      // Make multiple rapid changes
      handleChange("change 1");
      handleChange("change 2");
      handleChange("change 3");

      // onContentChange should be called for each change
      expect(onContentChange).toHaveBeenCalledTimes(3);
      expect(onContentChange).toHaveBeenNthCalledWith(1, "change 1");
      expect(onContentChange).toHaveBeenNthCalledWith(2, "change 2");
      expect(onContentChange).toHaveBeenNthCalledWith(3, "change 3");

      // Advance timers
      vi.advanceTimersByTime(DEBOUNCE_DELAY + 100);

      // Save should be called only once
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple debounced saves correctly", () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { handleChange } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      // First batch of changes
      handleChange("batch 1");

      // Wait for debounce
      vi.advanceTimersByTime(DEBOUNCE_DELAY + 100);

      expect(onSave).toHaveBeenCalledTimes(1);

      // Second batch of changes
      handleChange("batch 2");

      // Wait for debounce
      vi.advanceTimersByTime(DEBOUNCE_DELAY + 100);

      // Save should be called twice total (once per batch)
      expect(onSave).toHaveBeenCalledTimes(2);
    });

    it("should not call save if no onSave provided", () => {
      const onContentChange = vi.fn();

      const { handleChange } = createDebouncedSave(onContentChange, undefined, DEBOUNCE_DELAY);

      handleChange("new content");

      // Advance timers
      vi.advanceTimersByTime(DEBOUNCE_DELAY + 100);

      // Should not throw or cause issues
      expect(onContentChange).toHaveBeenCalledWith("new content");
    });

    it("should reset debounce timer on each change", () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { handleChange } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      // First change
      handleChange("change 1");

      // Advance halfway through debounce
      vi.advanceTimersByTime(DEBOUNCE_DELAY / 2);

      // Second change (should reset timer)
      handleChange("change 2");

      // Advance halfway again (total: DEBOUNCE_DELAY from first change)
      vi.advanceTimersByTime(DEBOUNCE_DELAY / 2);

      // Save should NOT be called yet (timer was reset)
      expect(onSave).not.toHaveBeenCalled();

      // Advance remaining time
      vi.advanceTimersByTime(DEBOUNCE_DELAY / 2 + 100);

      // Now save should be called
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("should cleanup timer on cleanup call", () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { handleChange, cleanup } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      handleChange("change");

      // Cleanup before debounce completes
      cleanup();

      // Advance timers
      vi.advanceTimersByTime(DEBOUNCE_DELAY + 100);

      // Save should NOT be called (timer was cleared)
      expect(onSave).not.toHaveBeenCalled();
    });

    it("should retain dirty state after a failed save and retry on the next change", async () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn()
        .mockRejectedValueOnce(new Error("disk unavailable"))
        .mockResolvedValueOnce(undefined);
      const { handleChange } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      handleChange("first");
      await vi.advanceTimersByTimeAsync(DEBOUNCE_DELAY + 10);
      await Promise.resolve();
      handleChange("retry");
      await vi.advanceTimersByTimeAsync(DEBOUNCE_DELAY + 10);

      expect(onSave).toHaveBeenCalledTimes(2);
    });
  });
});
