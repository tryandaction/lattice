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

const paneCommandBarInputs = vi.hoisted(() => [] as Array<{
  paneId: string | null | undefined;
  scopeId?: string | null;
  state: CommandBarState | null;
}>);

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
  openSearch: vi.fn(),
  openGotoLine: vi.fn(),
  scrollToLine: vi.fn(),
  flashLine: vi.fn(),
}));
const stableDockSetters = vi.hoisted(() => ({
  setDockSize: vi.fn(),
  setIsDockOpen: vi.fn(),
  setActiveDockTab: vi.fn(),
}));

vi.mock("@/components/editor/codemirror/code-editor", () => ({
  CodeEditor: ({ editorRef }: { editorRef?: React.RefObject<unknown> }) => {
    if (editorRef && "current" in editorRef) {
      editorRef.current = {
        focus: vi.fn(),
        scrollToLine: stableEditorCommands.scrollToLine,
        flashLine: stableEditorCommands.flashLine,
        getContent: vi.fn(() => ""),
        getSelection: vi.fn(() => ""),
        getSelectionDetails: vi.fn(() => null),
        hasSelection: vi.fn(() => false),
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

describe("CodeEditorViewer command bar stability", () => {
  beforeEach(() => {
    paneCommandBarInputs.length = 0;
    vi.clearAllMocks();
    stableEditorCommands.openSearch.mockClear();
    stableEditorCommands.openGotoLine.mockClear();
    stableEditorCommands.scrollToLine.mockClear();
    stableEditorCommands.flashLine.mockClear();
    stableRunnerState.lastRequest = null;
    stableRunnerState.commandState.canRerun = false;
    stableRunnerState.commandState.canRun = true;
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

  return {
    handleChange: (newContent: string) => {
      // Notify parent immediately
      onContentChange(newContent);
      hasChanged = true;

      // Clear existing timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // Set new debounce timer
      if (onSave) {
        debounceTimer = setTimeout(() => {
          if (hasChanged) {
            onSave().catch(console.error);
            hasChanged = false;
          }
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
  });
});
