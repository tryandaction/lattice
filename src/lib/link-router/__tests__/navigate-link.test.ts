import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigateLink, navigateLinkDetailed } from "../navigate-link";

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

function createSelectiveRootHandle(name: string, files: Record<string, FileSystemFileHandle>): FileSystemDirectoryHandle {
  return {
    name,
    kind: "directory",
    getDirectoryHandle: vi.fn(async () => {
      throw new DOMException("Not found", "NotFoundError");
    }),
    getFileHandle: vi.fn(async (fileName: string) => {
      const file = files[fileName];
      if (!file) {
        throw new DOMException("Not found", "NotFoundError");
      }
      return file;
    }),
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

  it("tries alternate workspace roots when the active root does not contain evidence", async () => {
    const activeRoot = createSelectiveRootHandle("active-folder", {});
    const workspaceRoot = createSelectiveRootHandle("workspace", {
      "paper.pdf": { name: "paper.pdf", kind: "file" } as FileSystemFileHandle,
    });

    const success = await navigateLink("paper.pdf#page=3", {
      paneId: "pane-2",
      rootHandle: activeRoot,
      rootHandles: [workspaceRoot],
    });

    expect(success).toBe(true);
    expect(openFileInPaneMock).toHaveBeenCalledWith(
      "pane-2",
      expect.objectContaining({ name: "paper.pdf" }),
      "paper.pdf",
    );
  });

  it("resolves a target relative to the registered path of a nested workspace root", async () => {
    const activeRoot = createSelectiveRootHandle("workspace", {});
    const paperHandle = { name: "paper.pdf", kind: "file" } as FileSystemFileHandle;
    const essayRoot = createSelectiveRootHandle("essay", { "paper.pdf": paperHandle });
    const canonicalPath = "atom/Theoretical Research/taiyi/essay/paper.pdf";

    const success = await navigateLink(`${canonicalPath}#page=3`, {
      paneId: "pane-2",
      rootHandle: activeRoot,
      rootCandidates: [{
        handle: essayRoot,
        pathPrefix: "atom/Theoretical Research/taiyi/essay",
      }],
    });

    expect(success).toBe(true);
    expect(essayRoot.getFileHandle).toHaveBeenCalledWith("paper.pdf");
    expect(openFileInPaneMock).toHaveBeenCalledWith("pane-2", paperHandle, canonicalPath);
    expect(setPendingNavigationMock).toHaveBeenCalledWith(
      "pane-2",
      expect.objectContaining({
        filePath: canonicalPath,
        target: expect.objectContaining({ type: "pdf_page", page: 3, path: canonicalPath }),
      }),
    );
  });

  it("preserves an AI evidence anchor while opening a PDF page", async () => {
    const paperHandle = { name: "paper.pdf", kind: "file" } as FileSystemFileHandle;
    const rootHandle = createSelectiveRootHandle("workspace", { "paper.pdf": paperHandle });

    const success = await navigateLink("paper.pdf#page=3", {
      paneId: "pane-3",
      rootHandle,
      evidenceAnchor: {
        page: 3,
        snippet: "coherent tunneling",
        rects: [{ left: 0.2, top: 0.3, width: 0.25, height: 0.02 }],
      },
    });

    expect(success).toBe(true);
    expect(setPendingNavigationMock).toHaveBeenCalledWith(
      "pane-3",
      expect.objectContaining({
        target: expect.objectContaining({
          type: "pdf_page",
          page: 3,
          snippet: "coherent tunneling",
          rects: [{ left: 0.2, top: 0.3, width: 0.25, height: 0.02 }],
        }),
      }),
    );
  });

  it("uses the already-open matching file when an evidence locator omits its workspace prefix", async () => {
    const paperHandle = { name: "paper.pdf", kind: "file" } as FileSystemFileHandle;
    const result = await navigateLinkDetailed("paper.pdf#page=4", {
      paneId: "pane-open-file",
      currentFilePath: "workspace/papers/paper.pdf",
      currentFileHandle: paperHandle,
      evidenceAnchor: { page: 4, snippet: "known evidence" },
    });

    expect(result).toMatchObject({ ok: true, status: "pending", filePath: "workspace/papers/paper.pdf" });
    expect(setPendingNavigationMock).toHaveBeenCalledWith(
      "pane-open-file",
      expect.objectContaining({
        filePath: "workspace/papers/paper.pdf",
        target: expect.objectContaining({ type: "pdf_page", page: 4, path: "workspace/papers/paper.pdf" }),
      }),
    );
    expect(openFileInPaneMock).not.toHaveBeenCalled();
  });

  it("resolves a workspace-root citation locator for the already-open file", async () => {
    const targetHandle = { name: "target.md", kind: "file" } as FileSystemFileHandle;

    const result = await navigateLinkDetailed("notes/target.md#Methods", {
      paneId: "pane-same-file-heading",
      currentFilePath: "notes/target.md",
      currentFileHandle: targetHandle,
      pathMode: "workspace",
    });

    expect(result).toMatchObject({ ok: true, status: "pending", filePath: "notes/target.md" });
    expect(setPendingNavigationMock).toHaveBeenCalledWith(
      "pane-same-file-heading",
      expect.objectContaining({
        filePath: "notes/target.md",
        target: expect.objectContaining({ type: "workspace_heading", path: "notes/target.md", heading: "Methods" }),
      }),
    );
  });

  it("promotes a current file evidence snippet to a pending text target", async () => {
    const result = await navigateLinkDetailed("notes/target.md", {
      paneId: "pane-file-snippet",
      currentFilePath: "notes/target.md",
      currentFileHandle: { name: "target.md", kind: "file" } as FileSystemFileHandle,
      pathMode: "workspace",
      evidenceAnchor: { snippet: "quoted evidence" },
    });

    expect(result).toMatchObject({ ok: true, status: "pending" });
    expect(setPendingNavigationMock).toHaveBeenCalledWith(
      "pane-file-snippet",
      expect.objectContaining({
        target: { type: "workspace_text", path: "notes/target.md", snippet: "quoted evidence" },
      }),
    );
  });

  it("strips a workspace root prefix before resolving a file handle", async () => {
    const paperHandle = { name: "paper.pdf", kind: "file" } as FileSystemFileHandle;
    const rootHandle = createSelectiveRootHandle("workspace", { "paper.pdf": paperHandle });

    const result = await navigateLinkDetailed("workspace/paper.pdf#page=2", {
      paneId: "pane-root-prefix",
      rootHandle,
    });

    expect(result).toMatchObject({ ok: true, status: "pending", filePath: "workspace/paper.pdf" });
    expect(rootHandle.getFileHandle).toHaveBeenCalledWith("paper.pdf");
  });

  it("does not use the open-file fallback for a same-named file in another directory", async () => {
    const paperHandle = { name: "paper.pdf", kind: "file" } as FileSystemFileHandle;

    const result = await navigateLinkDetailed("other/paper.pdf#page=2", {
      paneId: "pane-same-name",
      currentFilePath: "workspace/papers/paper.pdf",
      currentFileHandle: paperHandle,
    });

    expect(result).toMatchObject({ ok: false, status: "root_not_found" });
    expect(setPendingNavigationMock).not.toHaveBeenCalled();
  });

  it("returns a structured root-not-found result", async () => {
    const result = await navigateLinkDetailed("paper.pdf#page=3", { paneId: "pane-4" });

    expect(result).toMatchObject({
      ok: false,
      status: "root_not_found",
      requestId: expect.stringMatching(/^nav-/),
    });
  });

  it("does not confuse a decoded hash in a filename with a locator fragment", async () => {
    const result = await navigateLinkDetailed("papers/paper%23final.pdf#page=2", {
      paneId: "pane-hash-path", pathMode: "workspace",
      currentFilePath: "papers/paper#draft.pdf",
      currentFileHandle: { name: "paper#draft.pdf", kind: "file" } as FileSystemFileHandle,
    });
    expect(result).toMatchObject({ status: "root_not_found" });
    expect(setPendingNavigationMock).not.toHaveBeenCalled();
  });

  it("does not let a slow earlier file lookup replace a newer citation click", async () => {
    let resolveSlow!: (handle: FileSystemFileHandle) => void;
    const rootHandle = createRootHandle();
    vi.mocked(rootHandle.getFileHandle).mockImplementation((name) => name === "slow.pdf"
      ? new Promise((resolve) => { resolveSlow = resolve; })
      : Promise.resolve({ name, kind: "file" } as FileSystemFileHandle));
    const slow = navigateLinkDetailed("slow.pdf#page=2", { paneId: "pane-race", rootHandle });
    await navigateLinkDetailed("fast.md#text=Exact%20sentence", { paneId: "pane-race", rootHandle });
    resolveSlow({ name: "slow.pdf", kind: "file" } as FileSystemFileHandle);
    expect(await slow).toMatchObject({ status: "superseded" });
    expect(openFileInPaneMock).toHaveBeenCalledTimes(1);
    expect(openFileInPaneMock).toHaveBeenCalledWith("pane-race", expect.objectContaining({ name: "fast.md" }), "fast.md");
    expect(setPendingNavigationMock).toHaveBeenCalledTimes(1);
  });

  it("lets a same-document click supersede an in-flight cross-file lookup", async () => {
    let resolveSlow!: (handle: FileSystemFileHandle) => void;
    const rootHandle = createRootHandle();
    vi.mocked(rootHandle.getFileHandle).mockImplementation(() => new Promise((resolve) => { resolveSlow = resolve; }));
    const slow = navigateLinkDetailed("slow.pdf#page=2", { paneId: "pane-race-current", rootHandle });
    await navigateLinkDetailed("current.pdf#page=7", { paneId: "pane-race-current", currentFilePath: "current.pdf" });
    resolveSlow({ name: "slow.pdf", kind: "file" } as FileSystemFileHandle);
    expect(await slow).toMatchObject({ status: "superseded" });
    expect(openFileInPaneMock).not.toHaveBeenCalled();
    expect(setPendingNavigationMock).toHaveBeenCalledTimes(1);
    expect(setPendingNavigationMock).toHaveBeenCalledWith("pane-race-current", expect.objectContaining({ target: expect.objectContaining({ page: 7 }) }));
  });

  it("does not cancel an independent pane's file lookup", async () => {
    let resolveSlow!: (handle: FileSystemFileHandle) => void;
    const rootHandle = createRootHandle();
    vi.mocked(rootHandle.getFileHandle).mockImplementation(() => new Promise((resolve) => { resolveSlow = resolve; }));
    const slow = navigateLinkDetailed("slow.pdf#page=2", { paneId: "pane-independent-left", rootHandle });
    await navigateLinkDetailed("current.pdf#page=7", { paneId: "pane-independent-right", currentFilePath: "current.pdf" });
    resolveSlow({ name: "slow.pdf", kind: "file" } as FileSystemFileHandle);
    expect(await slow).toMatchObject({ status: "pending" });
    expect(openFileInPaneMock).toHaveBeenCalledTimes(1);
    expect(setPendingNavigationMock).toHaveBeenCalledTimes(2);
  });

  it("distinguishes a missing file from a missing root", async () => {
    const rootHandle = createSelectiveRootHandle("workspace", {});
    const result = await navigateLinkDetailed("missing.pdf#page=3", {
      paneId: "pane-5",
      rootHandle,
    });

    expect(result).toMatchObject({ ok: false, status: "file_not_found" });
  });

  it("rejects an unparseable target without touching navigation", async () => {
    const result = await navigateLinkDetailed("", { paneId: "pane-6" });

    expect(result).toMatchObject({ ok: false, status: "unsupported_target" });
    expect(openFileInPaneMock).not.toHaveBeenCalled();
    expect(setPendingNavigationMock).not.toHaveBeenCalled();
  });
});
