import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "../workspace-store";

describe("web navigation identity", () => {
  beforeEach(() => useWorkspaceStore.setState({ layout: { activePaneId: "web-pane", root: { type: "pane", id: "web-pane", tabs: [], activeTabIndex: -1 } }, paneTabFilterRequests: {} }));
  it("opens a URL without requesting a file-extension filter", () => {
    useWorkspaceStore.getState().openWebUrlInPane("web-pane", "http://localhost:4123/page");
    expect(useWorkspaceStore.getState().paneTabFilterRequests).toEqual({});
    const pane = useWorkspaceStore.getState().layout.root;
    expect(pane.type === "pane" && pane.tabs[0]).toMatchObject({ kind: "web", url: "http://localhost:4123/page" });
  });
  it("does not replace layout identity for identical URL/title polling snapshots", () => {
    useWorkspaceStore.getState().openWebUrlInPane("web-pane", "http://localhost:4123/page", { pageTitle: "Page" });
    const before = useWorkspaceStore.getState().layout;
    const pane = before.root;
    if (pane.type !== "pane") throw Error("expected pane");
    const tab = pane.tabs[0];
    useWorkspaceStore.getState().updateWebTab("web-pane", tab.id, { url: "http://localhost:4123/page", fileName: tab.fileName, pageTitle: "pageTitle" in tab ? tab.pageTitle : null });
    expect(useWorkspaceStore.getState().layout).toBe(before);
  });
});
