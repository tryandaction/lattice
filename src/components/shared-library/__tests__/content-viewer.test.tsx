import { render, screen } from "@testing-library/react";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type { ItemWorkspaceItem } from "@/lib/shared-library/item-workspace";

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="specialized-viewer" /> }));
vi.mock("@/components/main-area/universal-file-viewer", () => ({
  FileViewer: ({ rendererType, paneId, content }: { rendererType: string; paneId: string; content: { kind: string; text?: string } }) => <div data-testid="production-file-viewer" data-renderer={rendererType} data-pane={paneId}>{content.text}</div>,
}));
import { SharedLibraryContentViewer } from "../content-viewer";

function item(fileName: string, data: unknown, kind = "data"): ItemWorkspaceItem {
  return { id: "cloud-item", title: fileName, fileName, kind, filePath: "cloud://tenant-item", extras: { paneId: "cloud-pane-item", contentState: "ready", content: { kind: "binary", data, mimeType: "application/octet-stream", updatedAt: "2026-10-12" } } };
}

describe("cloud content uses production file readers", () => {
  it.each([
    ["report.html", "html"], ["notes.mdx", "markdown"], ["study.jl", "code"],
    ["table.csv", "code"], ["notebook.ipynb", "jupyter"], ["paper.docx", "word"],
    ["legacy.doc", "word"], ["slides.pptx", "powerpoint"], ["diagram.png", "image"],
    ["notes.ink", "handwriting"],
  ])("opens legacy data item %s with the same renderer as local files", (fileName, renderer) => {
    render(<SharedLibraryContentViewer item={item(fileName, new TextEncoder().encode("cloud content").buffer)} />);
    expect(screen.getByTestId("production-file-viewer").getAttribute("data-renderer")).toBe(renderer);
    expect(screen.getByTestId("production-file-viewer").getAttribute("data-pane")).toBe("cloud-pane-item");
  });

  it("retains a foreign-realm ArrayBuffer as available downloadable content", () => {
    const data: ArrayBuffer = runInNewContext("new Uint8Array([0, 255, 23]).buffer");
    expect(data instanceof ArrayBuffer).toBe(false);
    render(<SharedLibraryContentViewer item={item("unknown.custom", data)} />);
    expect(screen.getByRole("button", { name: "下载原文件" })).toBeTruthy();
  });

  it("preserves a typed-array byte window and refuses invalid binary disguised as text", () => {
    const data = new Uint8Array([50, 255, 0, 51]).subarray(1, 3);
    render(<SharedLibraryContentViewer item={item("notes.md", data, "markdown")} />);
    expect(screen.getByText(/2 bytes/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "下载原文件" })).toBeTruthy();
    expect(screen.queryByTestId("production-file-viewer")).toBeNull();
  });
});
