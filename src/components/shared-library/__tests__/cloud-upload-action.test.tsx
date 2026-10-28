import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CloudUploadAction } from "../cloud-upload-action";

describe("CloudUploadAction", () => {
  it("lets a signed-out user select files before login and can select the same file again", () => {
    const onFiles = vi.fn(); render(<CloudUploadAction onFiles={onFiles} />);
    const input = screen.getByLabelText("选择要上传的文件") as HTMLInputElement;
    const file = new File(["text"], "note.md");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles.mock.calls).toEqual([[[file]], [[file]]]);
    expect(input.value).toBe("");
    expect((screen.getByLabelText("选择要上传的文件夹") as HTMLInputElement).hasAttribute("webkitdirectory")).toBe(true);
  });

  it("keeps dropped folder hierarchy and exposes a readable drop error", async () => {
    const onFiles = vi.fn(); render(<CloudUploadAction onFiles={onFiles} />);
    const file = new File(["a"], "note.md"); let read = false;
    const directory = { name: "notes", isDirectory: true, createReader: () => ({ readEntries: (resolve: (value: unknown[]) => void) => { resolve(read ? [] : [{ name: "note.md", isFile: true, file: (resolveFile: (value: File) => void) => resolveFile(file) }]); read = true; } }) };
    fireEvent.drop(screen.getByTestId("cloud-upload-action"), { dataTransfer: { files: [file], items: [{ kind: "file", webkitGetAsEntry: () => directory }] } });
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file])); expect(file.webkitRelativePath).toBe("notes/note.md");
    fireEvent.drop(screen.getByTestId("cloud-upload-action"), { dataTransfer: { files: [], items: [{ kind: "file", webkitGetAsEntry: () => ({ name: "../bad", isDirectory: true }) }] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBeTruthy());
  });
});
