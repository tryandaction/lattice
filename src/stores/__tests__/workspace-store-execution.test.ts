import { afterEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { buildExecutionScopeId } from "@/lib/runner/execution-scope";
import { destroyExecutionScope, ensureExecutionSession, getExecutionSession } from "@/stores/execution-session-store";
import { isFileTabState } from "@/types/layout";
import type { DirectoryNode } from "@/types/file-system";

function createFileHandle(name: string): FileSystemFileHandle {
  return {
    kind: "file",
    name,
  } as FileSystemFileHandle;
}

describe("workspace-store execution scope cleanup", () => {
  afterEach(async () => {
    const sessions = Object.keys((await import("@/stores/execution-session-store")).useExecutionSessionStore.getState().sessions);
    for (const scopeId of sessions) {
      await destroyExecutionScope(scopeId);
    }
    useWorkspaceStore.getState().resetWorkbenchState();
  });

  it("关闭标签时会销毁对应 execution scope", async () => {
    const store = useWorkspaceStore.getState();
    const paneId = store.layout.activePaneId;
    store.openFileInPane(paneId, createFileHandle("script.py"), "workspace/script.py");

    const pane = useWorkspaceStore.getState().getActivePane();
    expect(pane?.tabs.length).toBe(1);
    const tab = pane!.tabs[0];
    const scopeId = buildExecutionScopeId({
      paneId,
      tabId: tab.id,
    });

    ensureExecutionSession({
      scopeId,
      kind: "code",
      paneId,
      tabId: tab.id,
      filePath: tab.filePath,
      fileName: tab.fileName,
    });

    expect(getExecutionSession(scopeId)).not.toBeNull();

    store.closeTab(paneId, 0);

    await waitFor(() => {
      expect(getExecutionSession(scopeId)).toBeNull();
    });
  });

  it("updates the tab file handle when a renamed file changes extension", () => {
    const store = useWorkspaceStore.getState();
    const paneId = store.layout.activePaneId;
    const oldHandle = createFileHandle("untitled.txt");
    const newHandle = createFileHandle("note.md");

    store.openFileInPane(paneId, oldHandle, "workspace/untitled.txt");
    store.updateTabFile("workspace/untitled.txt", "workspace/note.md", newHandle);

    const pane = useWorkspaceStore.getState().getActivePane();
    const tab = pane?.tabs[0];
    expect(tab && isFileTabState(tab)).toBe(true);
    if (!tab || !isFileTabState(tab)) {
      throw new Error("Expected file tab");
    }
    expect(tab?.fileName).toBe("note.md");
    expect(tab?.filePath).toBe("workspace/note.md");
    expect(tab.fileHandle).toBe(newHandle);
    expect(tab.fileHandle.name).toBe("note.md");
  });

  it("expands directories nested under a hydrated PDF item node", () => {
    const pdfItemDirectoryPath = ".lattice/items/workspace-paper.pdf/assets";
    const root: DirectoryNode = {
      name: "workspace",
      kind: "directory",
      handle: { kind: "directory", name: "workspace" } as FileSystemDirectoryHandle,
      path: "workspace",
      isExpanded: true,
      children: [
        {
          name: "paper.pdf",
          kind: "file",
          handle: createFileHandle("paper.pdf"),
          extension: "pdf",
          path: "workspace/paper.pdf",
          canExpandVirtualChildren: true,
          isExpanded: true,
          virtualChildrenState: "ready",
          children: [
            {
              name: "assets",
              kind: "directory",
              handle: { kind: "directory", name: "assets" } as FileSystemDirectoryHandle,
              path: pdfItemDirectoryPath,
              isExpanded: false,
              children: [
                {
                  name: "plot.png",
                  kind: "file",
                  handle: createFileHandle("plot.png"),
                  extension: "png",
                  path: `${pdfItemDirectoryPath}/plot.png`,
                  isVirtual: true,
                  parentPdfPath: "workspace/paper.pdf",
                },
              ],
            },
          ],
        },
      ],
    };

    useWorkspaceStore.getState().setFileTree({ root });
    useWorkspaceStore.getState().toggleDirectory(pdfItemDirectoryPath);

    const pdfNode = useWorkspaceStore.getState().fileTree.root?.children[0];
    if (!pdfNode || pdfNode.kind !== "file") {
      throw new Error("Expected hydrated PDF node");
    }
    const itemDirectory = pdfNode.children?.[0];
    expect(itemDirectory?.kind).toBe("directory");
    expect(itemDirectory?.isExpanded).toBe(true);
  });
});
