/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CloudUploadToolbar } from "../cloud-upload-toolbar";

describe("CloudUploadToolbar", () => {
  it("exposes simple file and folder upload actions", () => {
    render(<CloudUploadToolbar disabled={false} onFiles={vi.fn()} progress={null} />);
    expect(screen.getByRole("button", { name: "上传文件" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "上传文件夹" })).toBeTruthy();
    expect(screen.getByText("拖拽文件到这里即可上传")).toBeTruthy();
  });

  it("forwards selected files and keeps a retry action for failed imports", () => {
    const onFiles = vi.fn();
    const onRetry = vi.fn();
    render(<CloudUploadToolbar disabled={false} onFiles={onFiles} progress={{ label: "上传失败 1 个", failed: 1, onRetry }} />);
    const input = screen.getByLabelText("选择要上传的文件") as HTMLInputElement;
    const file = new File(["content"], "paper.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
    fireEvent.click(screen.getByRole("button", { name: "重试失败项" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("rejects drops when the member cannot upload", async () => {
    const onFiles = vi.fn();
    render(<CloudUploadToolbar disabled onFiles={onFiles} progress={null} />);
    fireEvent.drop(screen.getByTestId("cloud-upload-toolbar"), { dataTransfer: { files: [new File(["content"], "paper.pdf")], items: [] } });
    await Promise.resolve();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("keeps dropped folder hierarchy through the same upload action", async () => {
    const file = new File(["content"], "note.md");
    const entry = { name: "note.md", isFile: true, file: (resolve: (file: File) => void) => resolve(file) };
    let read = false;
    const directory = { name: "研究", isDirectory: true, createReader: () => ({ readEntries: (resolve: (entries: unknown[]) => void) => { resolve(read ? [] : [entry]); read = true; } }) };
    const onFiles = vi.fn();
    render(<CloudUploadToolbar disabled={false} onFiles={onFiles} progress={null} />);
    fireEvent.drop(screen.getByTestId("cloud-upload-toolbar"), { dataTransfer: { files: [file], items: [{ kind: "file", webkitGetAsEntry: () => directory }] } });
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]));
    expect(file.webkitRelativePath).toBe("研究/note.md");
  });
});
