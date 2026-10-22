/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TreeView } from "../tree-view";
import type { ExplorerSourceAdapter } from "../explorer-source";

const localFs = vi.hoisted(() => vi.fn(() => { throw new Error("Cloud source must never use local filesystem hooks"); }));
vi.mock("@/hooks/use-file-system", () => ({ useFileSystem: localFs }));
vi.mock("@/hooks/use-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

function source(readOnly = false): ExplorerSourceAdapter {
  return {
    id: "cloud:library-one", label: "Cloud folder", selectedId: "note", loading: false, readOnly,
    root: { id: "root", name: "Research", kind: "directory", isExpanded: true, children: [
      { id: "folder", name: "Papers", kind: "directory", isExpanded: false, children: [] },
      { id: "note", name: "note.md", kind: "file", extension: "md" },
    ] },
    select: vi.fn(), toggle: vi.fn(), open: vi.fn(), refresh: vi.fn(),
    rename: vi.fn(), remove: vi.fn(), create: vi.fn(), upload: vi.fn(), move: vi.fn(),
  };
}

describe("shared Explorer source adapter", () => {
  it("opens files and toggles folders through the source, never local FS", () => {
    const adapter = source();
    render(<TreeView source={adapter} />);
    fireEvent.click(screen.getByText("note.md"));
    expect(adapter.open).toHaveBeenCalledWith(expect.objectContaining({ id: "note" }));
    fireEvent.click(screen.getByText("Papers"));
    expect(adapter.toggle).toHaveBeenCalledWith(expect.objectContaining({ id: "folder" }));
    expect(localFs).not.toHaveBeenCalled();
  });
  it("uses the shared arrow navigation and F2 rename without path conversion", async () => {
    const adapter = source();
    render(<TreeView source={adapter} />);
    const folder = screen.getByText("Papers").closest("button")!;
    folder.focus();
    fireEvent.keyDown(folder, { key: "ArrowDown" });
    const file = screen.getByText("note.md").closest("button")!;
    expect(document.activeElement).toBe(file);
    fireEvent.keyDown(file, { key: "F2" });
    const input = screen.getByDisplayValue("note.md");
    fireEvent.change(input, { target: { value: "renamed.md" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(adapter.rename).toHaveBeenCalledWith(expect.objectContaining({ id: "note" }), "renamed.md"));
    expect(localFs).not.toHaveBeenCalled();
  });
  it("blocks read-only mutations from keyboard and context menu", () => {
    const adapter = source(true);
    render(<TreeView source={adapter} />);
    const file = screen.getByText("note.md").closest("button")!;
    fireEvent.keyDown(file, { key: "F2" });
    fireEvent.keyDown(file, { key: "Delete" });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.contextMenu(file);
    expect(screen.getByText("explorer.context.rename").closest("button")?.disabled).toBe(true);
    expect(screen.getByText("common.delete").closest("button")?.disabled).toBe(true);
    expect(adapter.rename).not.toHaveBeenCalled();
    expect(adapter.remove).not.toHaveBeenCalled();
  });
  it("expands PDF children with a separate disclosure while keeping the PDF open action", () => {
    const adapter = source();
    adapter.root!.children!.push({ id: "pdf", name: "paper.pdf", kind: "file", extension: "pdf", isExpanded: true, children: [{ id: "child", name: "paper-notes.md", kind: "file", extension: "md" }] });
    render(<TreeView source={adapter} />);
    expect(screen.getByText("paper-notes.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "explorer.pdf.collapseChildren" }));
    expect(adapter.toggle).toHaveBeenCalledWith(expect.objectContaining({ id: "pdf" }));
    expect(adapter.open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("paper.pdf"));
    expect(adapter.open).toHaveBeenCalledWith(expect.objectContaining({ id: "pdf" }));
  });
  it("only dispatches moves from the same explicit source and supports uploads", async () => {
    const adapter = source();
    render(<TreeView source={adapter} />);
    const folder = screen.getByText("Papers").closest("button")!;
    const transfer = (sourceId: string) => ({ files: [], getData: () => JSON.stringify({ sourceId, nodeId: "note" }), types: ["application/x-lattice-source-entry"], dropEffect: "none" });
    fireEvent.drop(folder, { dataTransfer: transfer("cloud:other-library") });
    expect(adapter.move).not.toHaveBeenCalled();
    fireEvent.drop(folder, { dataTransfer: transfer(adapter.id) });
    await waitFor(() => expect(adapter.move).toHaveBeenCalledWith(expect.objectContaining({ id: "note" }), expect.objectContaining({ id: "folder" })));
    const file = new File(["new test document"], "uploaded.txt");
    fireEvent.drop(folder, { dataTransfer: { files: [file], types: ["Files"], getData: () => "" } });
    await waitFor(() => expect(adapter.upload).toHaveBeenCalledWith([file], expect.objectContaining({ id: "folder" })));
    expect(localFs).not.toHaveBeenCalled();
  });
  it("accepts the drag-over phase when browsers protect the source payload until drop", () => {
    render(<TreeView source={source()} />);
    const folder = screen.getByText("Papers").closest("button")!;
    const accepted = fireEvent.dragOver(folder, { dataTransfer: { files: [], getData: () => "", types: ["application/x-lattice-source-entry"], dropEffect: "none" } });
    expect(accepted).toBe(false);
  });
});
