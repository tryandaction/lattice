import { describe, expect, it, vi } from "vitest";
import { createWorkspaceChangePump, reconcileVisibleDirectory, resolveWorkspaceRenamedPath, shouldRefreshWorkspaceSnapshot } from "@/lib/workspace-live-sync";
import type { DirectoryNode, TreeNode } from "@/types/file-system";

function directory(path: string, children: TreeNode[] = [], expanded = true): DirectoryNode {
  return { kind: "directory", name: path.split("/").pop()!, path, handle: {} as FileSystemDirectoryHandle, children, isExpanded: expanded, childrenState: "ready" };
}
const file = (path: string): TreeNode => ({ kind: "file", name: path.split("/").pop()!, path, extension: "txt", handle: {} as FileSystemFileHandle });

describe("incremental workspace reconciliation", () => {
  it('follows consecutive ancestor renames to the final directory without changing similarly named siblings', () => {
    const moves = [{ from: 'root/old', to: 'root/middle' }, { from: 'root/middle', to: 'root/final' }];
    expect(resolveWorkspaceRenamedPath('root/old/nested/paper.pdf', moves)).toBe('root/final/nested/paper.pdf');
    expect(resolveWorkspaceRenamedPath('root/older/paper.pdf', moves)).toBe('root/older/paper.pdf');
  });
  it('does not reopen a PDF just to establish its initial metadata baseline', () => {
    expect(shouldRefreshWorkspaceSnapshot(undefined, '100:1', false, true)).toBe(false);
    expect(shouldRefreshWorkspaceSnapshot(undefined, '100:1', true, true)).toBe(true);
    expect(shouldRefreshWorkspaceSnapshot('100:1', '100:2', false, true)).toBe(true);
    expect(shouldRefreshWorkspaceSnapshot('100:1', '100:1', true, true)).toBe(false);
    expect(shouldRefreshWorkspaceSnapshot(undefined, '100:1', false, false)).toBe(true);
  });
  it("only reads the changed expanded branch and preserves unrelated identities", async () => {
    const existing = file("root/docs/a.txt");
    const archive = directory("root/archive", [file("root/archive/closed.txt")], false);
    const docs = directory("root/docs", [existing]);
    const root = directory("root", [archive, docs]);
    const calls: string[] = [];
    const result = await reconcileVisibleDirectory(root, async node => {
      calls.push(node.path);
      return node.path === docs.path ? [file(existing.path), file("root/docs/new.txt")] : node.children;
    }, ["root/docs/new.txt"]);
    expect(calls).toEqual(["root/docs"]);
    expect(result.children[0]).toBe(archive);
    const refreshed = result.children[1] as DirectoryNode;
    expect(refreshed.children[0]).toBe(existing);
    expect(refreshed.children.map(node => node.name)).toEqual(["a.txt", "new.txt"]);
    expect(refreshed.isExpanded).toBe(true);
  });

  it("keeps the same tree for unchanged snapshots and never scans collapsed descendants", async () => {
    const archived = directory("root/archive", [file("root/archive/a.txt")], false);
    archived.childrenState = "idle";
    const root = directory("root", [archived, file("root/note.txt")]);
    const calls: string[] = [];
    const result = await reconcileVisibleDirectory(root, async node => { calls.push(node.path); return node.children.map(child => ({ ...child })); });
    expect(result).toBe(root);
    expect(calls).toEqual(["root"]);
  });

  it("preserves a readable tree when one expanded branch temporarily fails", async () => {
    const docs = directory("root/docs", [file("root/docs/a.txt")]);
    const root = directory("root", [docs]);
    const result = await reconcileVisibleDirectory(root, async node => {
      if (node.path === docs.path) throw new Error("locked");
      return node.children;
    });
    expect(result).toBe(root);
  });

  it("retries a branch once after a transient read error so the native change is not lost", async () => {
    const existing = file("root/docs/a.txt");
    const docs = directory("root/docs", [existing]);
    const root = directory("root", [docs]);
    let attempts = 0;
    const result = await reconcileVisibleDirectory(root, async node => {
      if (node.path !== docs.path) return node.children;
      attempts += 1;
      if (attempts === 1) throw new Error("transient directory read error");
      return [existing, file("root/docs/external.txt")];
    }, ["root/docs/external.txt"]);

    expect(attempts).toBe(2);
    expect((result.children[0] as DirectoryNode).children.map(child => child.name))
      .toContain("external.txt");
  });

  it("marks an affected collapsed branch stale without scanning it", async () => {
    const archive = directory("root/archive", [], false);
    const read = vi.fn();
    const result = await reconcileVisibleDirectory(archive, read, ["root/archive/new.txt"]);
    expect(result.childrenState).toBe("idle");
    expect(read).not.toHaveBeenCalled();
  });

  it("marks closed browser branches stale during a fallback check so reopening reads new entries", async () => {
    const closed = directory("root/closed", [file("root/closed/old.txt")], false);
    const read = vi.fn(async (node: DirectoryNode) => node.children);
    const result = await reconcileVisibleDirectory(directory("root", [closed]), read);
    expect((result.children[0] as DirectoryNode).childrenState).toBe("idle");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0].path).toBe("root");
  });

  it("coalesces bursts, serializes refreshes and stops after disposal", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => {});
    const pump = createWorkspaceChangePump(refresh, 20);
    pump.request(["root/a"]); pump.request(["root/b"]); pump.request(["root/a"]);
    await vi.advanceTimersByTimeAsync(20);
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(["root/a", "root/b"], []);
    pump.request(["root/c"]); pump.dispose();
    await vi.advanceTimersByTimeAsync(30);
    expect(refresh).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
