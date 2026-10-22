/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VSCodeSourceControlPanel } from "../vscode-source-control-panel";
import { setLocale } from "@/lib/i18n";
import type { VSCodeSourceControlSnapshot } from "@/lib/vscode-compat/source-control";
import { useWorkspaceStore } from "@/stores/workspace-store";

const adapterMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getDiff: vi.fn(),
  stagePaths: vi.fn(),
  unstagePaths: vi.fn(),
  stageAll: vi.fn(),
  unstageAll: vi.fn(),
  commit: vi.fn(),
}));

const fileMocks = vi.hoisted(() => ({
  createDesktopFileHandle: vi.fn((path: string) => ({ name: path.split("/").pop(), path })),
}));

vi.mock("@/lib/vscode-compat/source-control", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vscode-compat/source-control")>()),
  getVSCodeSourceControlStatus: adapterMocks.getStatus,
  getVSCodeSourceControlDiff: adapterMocks.getDiff,
  stageVSCodeSourceControlPaths: adapterMocks.stagePaths,
  unstageVSCodeSourceControlPaths: adapterMocks.unstagePaths,
  stageAllVSCodeSourceControlChanges: adapterMocks.stageAll,
  unstageAllVSCodeSourceControlChanges: adapterMocks.unstageAll,
  commitVSCodeSourceControlChanges: adapterMocks.commit,
}));

vi.mock("@/lib/desktop-file-system", () => ({
  createDesktopFileHandle: fileMocks.createDesktopFileHandle,
}));

const SNAPSHOT: VSCodeSourceControlSnapshot = {
  available: true,
  repositoryRoot: "C:/repo",
  branch: "main",
  ahead: 2,
  behind: 1,
  changes: [
    { path: "src/staged.ts", originalPath: null, index: "M", worktree: " ", status: "M ", staged: true, unstaged: false, conflict: false, untracked: false },
    { path: "src/working.ts", originalPath: null, index: " ", worktree: "M", status: " M", staged: false, unstaged: true, conflict: false, untracked: false },
    { path: "src/new.ts", originalPath: null, index: "?", worktree: "?", status: "??", staged: false, unstaged: true, conflict: false, untracked: true },
    { path: "src/conflict.ts", originalPath: null, index: "U", worktree: "U", status: "UU", staged: true, unstaged: true, conflict: true, untracked: false },
  ],
  error: null,
};

describe("VSCodeSourceControlPanel", () => {
  beforeEach(() => {
    setLocale("en-US");
    vi.clearAllMocks();
    adapterMocks.getStatus.mockResolvedValue(SNAPSHOT);
    adapterMocks.getDiff.mockResolvedValue({
      path: "src/staged.ts",
      staged: true,
      content: "diff --git a/src/staged.ts b/src/staged.ts",
      binary: false,
      truncated: false,
      error: null,
    });
    adapterMocks.stagePaths.mockResolvedValue(SNAPSHOT);
    adapterMocks.unstagePaths.mockResolvedValue(SNAPSHOT);
    adapterMocks.stageAll.mockResolvedValue(SNAPSHOT);
    adapterMocks.unstageAll.mockResolvedValue(SNAPSHOT);
    adapterMocks.commit.mockResolvedValue({ ...SNAPSHOT, changes: [] });
    useWorkspaceStore.setState({
      workspaceRootPath: "C:/repo/project",
      openFileInActivePane: vi.fn(),
    });
  });

  it("groups repository changes and opens a changed file in Lattice", async () => {
    render(<VSCodeSourceControlPanel />);

    expect(await screen.findByText("main")).toBeTruthy();
    expect(screen.getByText("Ahead 2")).toBeTruthy();
    expect(screen.getByText("Behind 1")).toBeTruthy();
    expect(screen.getByText("Merge Changes")).toBeTruthy();
    expect(screen.getByText("Staged Changes")).toBeTruthy();
    expect(screen.getByText("Changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open src/working.ts" }));

    expect(fileMocks.createDesktopFileHandle).toHaveBeenCalledWith("C:/repo/src/working.ts");
    expect(useWorkspaceStore.getState().openFileInActivePane).toHaveBeenCalledWith(
      expect.objectContaining({ path: "C:/repo/src/working.ts" }),
      "src/working.ts",
    );
  });

  it("loads the correct staged diff inline", async () => {
    render(<VSCodeSourceControlPanel />);
    await screen.findByText("main");

    fireEvent.click(screen.getByRole("button", { name: "Show staged diff for src/staged.ts" }));

    expect(adapterMocks.getDiff).toHaveBeenCalledWith("C:/repo/project", "src/staged.ts", true);
    expect(await screen.findByText(/diff --git a\/src\/staged.ts/)).toBeTruthy();
  });

  it("stages and unstages individual paths and whole sections", async () => {
    render(<VSCodeSourceControlPanel />);
    await screen.findByText("main");

    fireEvent.click(screen.getByRole("button", { name: "Stage src/working.ts" }));
    await waitFor(() => expect(adapterMocks.stagePaths).toHaveBeenCalledWith("C:/repo/project", ["src/working.ts"]));

    fireEvent.click(screen.getByRole("button", { name: "Unstage src/staged.ts" }));
    await waitFor(() => expect(adapterMocks.unstagePaths).toHaveBeenCalledWith("C:/repo/project", ["src/staged.ts"]));

    fireEvent.click(screen.getByRole("button", { name: "Stage all changes" }));
    await waitFor(() => expect(adapterMocks.stageAll).toHaveBeenCalledWith("C:/repo/project"));

    fireEvent.click(screen.getByRole("button", { name: "Unstage all changes" }));
    await waitFor(() => expect(adapterMocks.unstageAll).toHaveBeenCalledWith("C:/repo/project"));
  });

  it("requires conflict resolution and confirmation before commit", async () => {
    const { rerender } = render(<VSCodeSourceControlPanel />);
    await screen.findByText("main");
    const message = screen.getByPlaceholderText("Commit message");
    fireEvent.change(message, { target: { value: "Finish source control" } });

    expect((screen.getByRole("button", { name: "Commit staged changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Resolve conflicts before committing.")).toBeTruthy();

    adapterMocks.getStatus.mockResolvedValue({
      ...SNAPSHOT,
      changes: SNAPSHOT.changes.filter((change) => !change.conflict),
    });
    rerender(<VSCodeSourceControlPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh source control" }));
    await waitFor(() => expect(screen.queryByText("Resolve conflicts before committing.")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Commit staged changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm commit" });
    expect(within(dialog).getByText("Finish source control")).toBeTruthy();
    expect(within(dialog).getByText("1 staged file")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Commit" }));

    await waitFor(() => expect(adapterMocks.commit).toHaveBeenCalledWith("C:/repo/project", "Finish source control"));
    expect((screen.getByPlaceholderText("Commit message") as HTMLTextAreaElement).value).toBe("");
  });
});
