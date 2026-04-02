import { afterEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { buildExecutionScopeId } from "@/lib/runner/execution-scope";
import { destroyExecutionScope, ensureExecutionSession, getExecutionSession } from "@/stores/execution-session-store";

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
});

