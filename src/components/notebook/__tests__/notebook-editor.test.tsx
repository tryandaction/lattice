import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotebookEditor } from "../notebook-editor";

const mocks = vi.hoisted(() => {
  const activateCell = vi.fn();
  const noop = vi.fn();
  return {
    activateCell,
    noop,
    editorState: {
      cells: [
        { id: "intro", cell_type: "markdown", source: "# Analysis", metadata: {} },
        { id: "code-1", cell_type: "code", source: "print('ready')", metadata: {}, outputs: [], execution_count: null },
      ],
      metadata: { kernelspec: { language: "python", name: "python3", display_name: "Python 3" } },
      activeCellId: "intro",
    },
  };
});

vi.mock("@/hooks/use-notebook-editor", () => ({
  useNotebookEditor: () => ({
    state: mocks.editorState,
    isDirty: false,
    addCellAbove: mocks.noop,
    addCellBelow: mocks.noop,
    removeCell: mocks.noop,
    updateSource: mocks.noop,
    activateCell: mocks.activateCell,
    changeType: mocks.noop,
    activateNextCell: mocks.noop,
    activatePrevCell: mocks.noop,
    addCellAboveActive: mocks.noop,
    addCellBelowActive: mocks.noop,
    deleteActiveCell: mocks.noop,
    serialize: () => "{}",
    markClean: mocks.noop,
    resetState: mocks.noop,
    syncExecutionState: mocks.noop,
  }),
}));

vi.mock("@/hooks/use-notebook-executor", () => ({
  useNotebookExecutor: () => ({
    executionState: "idle",
    currentCellId: null,
    runtimeStatus: "idle",
    runtimeAvailability: "idle",
    runtimeError: null,
    runtimeProblems: [],
    hasValidatedRuntime: false,
    prepareRuntime: mocks.noop,
    runAll: mocks.noop,
    interrupt: mocks.noop,
    restartKernel: mocks.noop,
    switchKernel: mocks.noop,
    executeCell: mocks.noop,
    kernel: null,
    cellStates: {},
    commandState: {
      canRun: false,
      canInterrupt: false,
      canRestart: false,
      canVerifyRuntime: true,
    },
  }),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    rootHandle: null,
    fileTree: { root: null },
    workspaceRootPath: "C:/workspace",
    workspaceIdentity: { workspaceKey: "desktop:C:/workspace" },
    runnerPreferences: { recentRunByFile: {}, defaultPythonPath: null },
  }),
}));

vi.mock("@/stores/link-navigation-store", () => ({
  useLinkNavigationStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    pendingByPane: {},
    consumePendingNavigation: mocks.noop,
  }),
}));

vi.mock("@/hooks/use-selection-context-menu", () => ({
  useSelectionContextMenu: () => ({ menuState: null, closeMenu: mocks.noop }),
}));
vi.mock("@/hooks/use-runner-health", () => ({
  useRunnerHealth: () => ({
    runnerHealthSnapshot: { issues: [] },
    isRefreshing: false,
    refresh: mocks.noop,
  }),
}));
vi.mock("@/hooks/use-persisted-view-state", () => ({ usePersistedViewState: mocks.noop }));
vi.mock("@/hooks/use-pane-command-bar", () => ({ usePaneCommandBar: mocks.noop }));
vi.mock("@/lib/storage-adapter", () => ({ isTauriHost: () => false }));
vi.mock("@/lib/link-router/navigate-link", () => ({ navigateLink: mocks.noop }));
vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "workbench.notebook.jumpToFirstCode") return "Jump to first code cell";
      if (key === "workbench.notebook.codeCells") return `${values?.count ?? 0} code cell`;
      return key;
    },
  }),
}));

vi.mock("../notebook-cell", () => ({
  NotebookCellComponent: ({ cell }: { cell: { id: string; cell_type: string } }) => (
    <div data-testid={`cell-${cell.id}`}>{cell.cell_type}</div>
  ),
}));
vi.mock("../kernel-selector", () => ({ KernelSelector: () => null }));
vi.mock("../kernel-status", () => ({ KernelStatus: () => null }));
vi.mock("@/components/runner/workspace-runner-manager", () => ({ WorkspaceRunnerManager: () => null }));
vi.mock("@/components/runner/problems-panel", () => ({ ProblemsPanel: () => null }));
vi.mock("@/components/ai/selection-context-menu", () => ({ SelectionContextMenu: () => null }));
vi.mock("@/components/ai/selection-ai-hub", () => ({ SelectionAiHub: () => null }));

describe("NotebookEditor code navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("exposes and jumps to the first code cell when markdown fills the first viewport", () => {
    render(
      <NotebookEditor
        content="{}"
        fileName="analysis.ipynb"
        paneId="pane-1"
        tabId="tab-1"
        filePath="analysis.ipynb"
        executionScopeId="scope-1"
      />,
    );

    const jumpButton = screen.getByRole("button", { name: "Jump to first code cell" });
    expect(jumpButton.textContent).toContain("1 code cell");

    fireEvent.click(jumpButton);

    expect(mocks.activateCell).toHaveBeenCalledWith("code-1");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });
});
