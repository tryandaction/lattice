import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { Item } from "@/lib/shared-library/domain";
import { CloudFileTree } from "../cloud-file-tree";

const item = (id: string, title: string, kind: Item["kind"], parentItemId?: string): Item => ({ id, title, canonicalName: title, kind, libraryId: "library", status: "active", metadata: { parentItemId }, createdBy: "user", createdAt: "now", updatedAt: "now" });
const items = [item("root", "研究", "folder"), item("sub", "数据", "folder", "root"), item("file", "plot.csv", "data", "sub"), item("other", "readme.md", "markdown")];

describe("cloud folder tree", () => {
  it("expands nested folders without losing the root, then opens a file with one click", () => {
    const onOpenFile = vi.fn();
    render(<CloudFileTree items={items} onOpenFile={onOpenFile} onSelectFolder={vi.fn()} />);
    fireEvent.click(screen.getByRole("treeitem", { name: "研究" }));
    expect(screen.getByRole("treeitem", { name: "研究" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("treeitem", { name: "数据" }));
    const file = screen.getByRole("treeitem", { name: "plot.csv" });
    expect(file.getAttribute("aria-level")).toBe("3");
    fireEvent.click(file);
    expect(onOpenFile).toHaveBeenCalledWith(items[2]);
    expect(screen.getByRole("treeitem", { name: "readme.md" })).toBeTruthy();
    fireEvent.click(screen.getByRole("treeitem", { name: "研究" }));
    expect(screen.queryByRole("treeitem", { name: "plot.csv" })).toBeNull();
  });

  it("reveals the path to an opened file and filters nested filenames through their ancestors", () => {
    const { rerender } = render(<CloudFileTree items={items} activeItemId="file" currentFolderId="sub" onOpenFile={vi.fn()} onSelectFolder={vi.fn()} />);
    expect(screen.getByRole("treeitem", { name: "plot.csv" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("treeitem", { name: "研究" })).toBeTruthy();
    rerender(<CloudFileTree items={items} query="plot" onOpenFile={vi.fn()} onSelectFolder={vi.fn()} />);
    expect(screen.getByRole("treeitem", { name: "plot.csv" })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "readme.md" })).toBeNull();
  });

  it("keeps a collapsed ancestor closed when its selected folder changes and sync rerenders", () => {
    function ControlledTree() {
      const [folder, setFolder] = useState<string | undefined>("sub");
      return <CloudFileTree items={[...items]} currentFolderId={folder} onSelectFolder={setFolder} onOpenFile={vi.fn()} />;
    }
    const { rerender } = render(<ControlledTree />);
    fireEvent.click(screen.getByRole("treeitem", { name: "研究" }));
    expect(screen.queryByRole("treeitem", { name: "plot.csv" })).toBeNull();
    rerender(<ControlledTree />);
    expect(screen.getByRole("treeitem", { name: "研究" }).getAttribute("aria-expanded")).toBe("false");
  });
});
