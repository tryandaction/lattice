import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabBar } from "../tab-bar";
import { useWorkspaceStore } from "@/stores/workspace-store";
vi.mock("@dnd-kit/core", () => ({ useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }) }));
vi.mock("@dnd-kit/sortable", () => ({ SortableContext: ({ children }: { children: React.ReactNode }) => children, horizontalListSortingStrategy: {} }));
vi.mock("../tab", () => ({ Tab: ({ tab }: { tab: { id: string; fileName: string } }) => <span data-testid={`file-tab-${tab.id}`}>{tab.fileName}</span> }));
describe("compact web source entry", () => {
  beforeEach(() => useWorkspaceStore.setState({ layout: { activePaneId: "pane", root: { type: "pane", id: "pane", tabs: [], activeTabIndex: -1 } }, paneTabFilterRequests: {} }));
  it("opens an address from an empty tab strip without a file filter", () => {
    render(<TabBar paneId="pane" tabs={[]} activeTabIndex={-1} isPaneActive onTabClick={vi.fn()} onTabClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "网页" }));
    fireEvent.change(screen.getByRole("textbox", { name: "打开网页地址" }), { target: { value: "http://localhost:4123/first" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "打开网页地址" }).closest("form")!);
    const state = useWorkspaceStore.getState();
    expect(state.layout.root.type === "pane" && state.layout.root.tabs[0]).toMatchObject({ kind: "web", url: "http://localhost:4123/first" });
    expect(state.paneTabFilterRequests).toEqual({});
  });
  it("keeps pages out of the local file rail and closes them from their separate index", () => {
    const onClose = vi.fn();
    const tabs = [
      { id: "local", fileName: "local.html", filePath: "local.html", fileHandle: {} as FileSystemFileHandle, isDirty: false, scrollPosition: 0 },
      { id: "web", kind: "web" as const, fileName: "Local site", url: "http://localhost/page", filePath: "http://localhost/page", isDirty: false, scrollPosition: 0 },
    ];
    render(<TabBar paneId="pane" tabs={tabs} activeTabIndex={1} isPaneActive onTabClick={vi.fn()} onTabClose={onClose} />);
    expect(screen.getByTestId("file-tab-local")).toBeTruthy();
    expect(screen.queryByTestId("file-tab-web")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "网页" }));
    expect(screen.getByRole("button", { name: "关闭: Local site" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭: Local site" }));
    expect(onClose).toHaveBeenCalledWith(1);
  });
});
