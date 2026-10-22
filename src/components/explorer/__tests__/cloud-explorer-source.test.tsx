/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudWorkbenchState } from "@/stores/cloud-workbench-store";
import { useCloudExplorerSource } from "../use-cloud-explorer-source";
import { findSourceNode } from "../explorer-source";
import type { Item } from "@/lib/shared-library/domain";

const holder = vi.hoisted(() => ({ store: null as unknown }));
const infoToast = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { info: infoToast } }));
vi.mock("@/stores/cloud-workbench-store", () => ({ get useCloudWorkbenchStore() { return holder.store; } }));
const item = (id: string, kind: Item["kind"], parent?: string): Item => ({ id, libraryId: "lib", kind, canonicalName: `${id}${kind === "pdf" ? ".pdf" : kind === "markdown" ? ".md" : ""}`, title: id, metadata: parent ? { parentItemId: parent } : {}, status: "active", createdBy: "user", createdAt: "2026-10-12", updatedAt: "2026-10-12" });

let store: UseBoundStore<StoreApi<CloudWorkbenchState>>;
beforeEach(() => {
  infoToast.mockReset();
  store = create<CloudWorkbenchState>(() => ({
    active: true, scope: "account-a", libraryId: "lib", role: "editor", items: [item("folder", "folder"), item("paper", "pdf", "folder"), item("notes", "markdown", "paper")], libraries: [{ id: "lib", name: "Library A" }],
    selectedFolderId: "folder", loading: false, uploading: false, error: null,
    setSelectedFolderId: vi.fn(), refresh: vi.fn(), openItem: vi.fn(), createFolder: vi.fn().mockResolvedValue(item("created", "folder")), createNote: vi.fn().mockResolvedValue(item("created", "markdown")), createFile: vi.fn().mockResolvedValue(item("created", "data")),
    renameItem: vi.fn(), moveItem: vi.fn(), trashItem: vi.fn(), uploadFiles: vi.fn(), downloadItem: vi.fn(),
  } as unknown as CloudWorkbenchState));
  holder.store = store;
});

describe("cloud Explorer source projection", () => {
  it("keeps folder and PDF child identity without local file handles", () => {
    const { result } = renderHook(useCloudExplorerSource);
    const paper = findSourceNode(result.current!.root, "paper")!;
    expect(paper.kind).toBe("file");
    expect(paper.children?.map(node => node.id)).toEqual(["notes"]);
    expect(paper).not.toHaveProperty("path");
    expect(paper).not.toHaveProperty("handle");
    act(() => result.current!.toggle(paper));
    expect(findSourceNode(result.current!.root, "paper")?.isExpanded).toBe(true);
  });
  it("passes explicit root target despite a selected nested folder", async () => {
    const { result } = renderHook(useCloudExplorerSource);
    await act(async () => { await result.current!.create!("note", result.current!.root!); });
    expect(store.getState().createNote).toHaveBeenCalledWith("Untitled.md", null);
    expect(store.getState().openItem).toHaveBeenCalledWith("created");
    const file = new File(["text"], "test.txt");
    await act(async () => { await result.current!.upload!([file], result.current!.root!); });
    expect(store.getState().uploadFiles).toHaveBeenCalledWith([file], null);
  });
  it("does not reuse another account's expanded folders or mutation capabilities", () => {
    const { result } = renderHook(useCloudExplorerSource);
    act(() => result.current!.toggle(findSourceNode(result.current!.root, "folder")!));
    expect(findSourceNode(result.current!.root, "folder")?.isExpanded).toBe(true);
    act(() => store.setState({ scope: "account-b", role: "viewer" }));
    expect(findSourceNode(result.current!.root, "folder")?.isExpanded).toBe(false);
    expect(result.current!.readOnly).toBe(true);
    expect(result.current!.create).toBeUndefined();
    expect(result.current!.rename).toBeUndefined();
    expect(result.current!.move).toBeUndefined();
    expect(result.current!.remove).toBeUndefined();
  });
  it("rejects stale menu callbacks after switching account or library", async () => {
    const { result } = renderHook(useCloudExplorerSource);
    const stale = result.current!;
    act(() => store.setState({ scope: "account-b" }));
    await expect(stale.create!("note", stale.root!)).rejects.toThrow("已切换");
    expect(store.getState().createNote).not.toHaveBeenCalled();
  });
  it("explains how to migrate PDF sidecars when the generic picker lacks workspace identity", async () => {
    const { result } = renderHook(useCloudExplorerSource);
    await act(async () => { await result.current!.upload!([new File(["%PDF-synthetic"], "paper.pdf")], result.current!.root!); });
    expect(infoToast).toHaveBeenCalledWith("要同时上传批注与子文件，请从本地 PDF 右键上传到云端库。");
    expect(store.getState().uploadFiles).toHaveBeenCalledOnce();
  });
});
