import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigateLink } from "../navigate-link";

const openExternalUrlMock = vi.hoisted(() => vi.fn(async () => undefined));
const openSystemPathMock = vi.hoisted(() => vi.fn(async () => true));
const openWebUrlInPaneMock = vi.hoisted(() => vi.fn());
const openFileInPaneMock = vi.hoisted(() => vi.fn());
const setPendingNavigationMock = vi.hoisted(() => vi.fn());
const clearPendingNavigationMock = vi.hoisted(() => vi.fn());

vi.mock("../open-external", () => ({
  openExternalUrl: openExternalUrlMock,
  openSystemPath: openSystemPathMock,
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: {
    getState: () => ({
      layout: { activePaneId: "pane-active" },
      openWebUrlInPane: openWebUrlInPaneMock,
      openFileInPane: openFileInPaneMock,
    }),
  },
}));

vi.mock("@/stores/link-navigation-store", () => ({
  useLinkNavigationStore: {
    getState: () => ({
      setPendingNavigation: setPendingNavigationMock,
      clearPendingNavigation: clearPendingNavigationMock,
    }),
  },
}));

function createRootHandle(): FileSystemDirectoryHandle {
  return {
    name: "workspace",
    kind: "directory",
    getDirectoryHandle: vi.fn(async (_name: string) => createRootHandle()),
    getFileHandle: vi.fn(async (name: string) => ({ name, kind: "file" } as FileSystemFileHandle)),
  } as unknown as FileSystemDirectoryHandle;
}

describe("navigateLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens http links inside Lattice by default", async () => {
    const success = await navigateLink("https://example.com/docs", {
      paneId: "pane-1",
    });

    expect(success).toBe(true);
    expect(openWebUrlInPaneMock).toHaveBeenCalledWith(
      "pane-1",
      "https://example.com/docs",
      expect.objectContaining({ fileName: "docs" }),
    );
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it("opens http links externally when external mode is requested", async () => {
    const success = await navigateLink("https://example.com/docs", {
      paneId: "pane-1",
      externalUrlMode: "external",
    });

    expect(success).toBe(true);
    expect(openExternalUrlMock).toHaveBeenCalledWith("https://example.com/docs");
    expect(openWebUrlInPaneMock).not.toHaveBeenCalled();
  });

  it("still resolves workspace links to file tabs", async () => {
    const rootHandle = createRootHandle();
    const success = await navigateLink("notes/today.md#line=10", {
      paneId: "pane-2",
      rootHandle,
      currentFilePath: "workspace/index.md",
    });

    expect(success).toBe(true);
    expect(openFileInPaneMock).toHaveBeenCalledWith(
      "pane-2",
      expect.objectContaining({ name: "today.md" }),
      "workspace/notes/today.md",
    );
    expect(setPendingNavigationMock).toHaveBeenCalledWith(
      "pane-2",
      expect.objectContaining({
        filePath: "workspace/notes/today.md",
        target: expect.objectContaining({ type: "code_line", line: 10 }),
      }),
    );
  });
});
