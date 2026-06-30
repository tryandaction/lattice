/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportFile } from "../export-adapter";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

const originalCreateElement = document.createElement.bind(document);
type SavePickerTestWindow = Omit<Window, "showSaveFilePicker"> & {
  showSaveFilePicker?: ReturnType<typeof vi.fn>;
};

function testWindow(): SavePickerTestWindow {
  return window as unknown as SavePickerTestWindow;
}

describe("export adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete testWindow().showSaveFilePicker;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("../storage-adapter");
    vi.doUnmock("@/lib/storage-adapter");
    vi.doUnmock("@/lib/desktop-openers");
    delete testWindow().showSaveFilePicker;
  });

  it("uses explicit image MIME types with the File System Access save picker", async () => {
    const write = vi.fn();
    const close = vi.fn();
    const createWritable = vi.fn(async () => ({ write, close }));
    const showSaveFilePicker = vi.fn(async () => ({
      name: "figure-edited.png",
      createWritable,
    }));
    testWindow().showSaveFilePicker = showSaveFilePicker;

    const result = await exportFile(new Blob(["image"], { type: "image/png" }), {
      defaultFileName: "figure-edited.png",
      filters: [{ name: "PNG image", extensions: ["png"], mimeType: "image/png" }],
    });

    expect(result).toEqual({ success: true, filePath: "figure-edited.png" });
    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "figure-edited.png",
      types: [
        {
          description: "PNG image",
          accept: { "image/png": [".png"] },
        },
      ],
    });
    expect(write).toHaveBeenCalledWith(expect.any(Blob));
    expect(close).toHaveBeenCalled();
  });

  it("infers common MIME types from legacy extension-only filters", async () => {
    const createWritable = vi.fn(async () => ({ write: vi.fn(), close: vi.fn() }));
    const showSaveFilePicker = vi.fn(async () => ({
      name: "paper.pdf",
      createWritable,
    }));
    testWindow().showSaveFilePicker = showSaveFilePicker;

    await exportFile(new Uint8Array([1, 2, 3]), {
      defaultFileName: "paper.pdf",
      filters: [{ name: "PDF Files", extensions: ["pdf"] }],
    });

    expect(showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({
      types: [
        {
          description: "PDF Files",
          accept: { "application/pdf": [".pdf"] },
        },
      ],
    }));
  });

  it("falls back to a download link when the save picker is unavailable", async () => {
    const anchorClick = vi.fn();
    const createObjectURL = vi.fn(() => "blob:export");
    const revokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;
    vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === "a") {
        Object.defineProperty(element, "click", {
          configurable: true,
          value: anchorClick,
        });
      }
      return element;
    });

    const result = await exportFile(new Blob(["fallback"], { type: "text/plain" }), {
      defaultFileName: "notes.txt",
      filters: [{ name: "Text", extensions: ["txt"] }],
    });

    expect(result).toEqual({ success: true, filePath: "notes.txt" });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });

  it("returns cancelled when the save picker is cancelled", async () => {
    const abortError = new Error("cancelled");
    abortError.name = "AbortError";
    testWindow().showSaveFilePicker = vi.fn(async () => {
      throw abortError;
    });

    await expect(exportFile(new Blob(["image"]), {
      defaultFileName: "figure.png",
      filters: [{ name: "PNG image", extensions: ["png"], mimeType: "image/png" }],
    })).resolves.toEqual({ success: false, cancelled: true });
  });

  it("uses the Tauri save dialog and desktop byte writer on desktop", async () => {
    vi.resetModules();
    const save = vi.fn(async () => "C:/exports/paper.docx");
    const invokeTauriCommand = vi.fn(async () => undefined);
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ save }));
    vi.doMock("../storage-adapter", () => ({
      isTauri: () => true,
      invokeTauriCommand,
    }));

    const { exportFile: desktopExportFile } = await import("../export-adapter");
    const result = await desktopExportFile(new Uint8Array([1, 2, 3]), {
      defaultFileName: "paper.docx",
      filters: [{ name: "Word Document", extensions: ["docx"] }],
    });

    expect(result).toEqual({ success: true, filePath: "C:/exports/paper.docx" });
    expect(save).toHaveBeenCalledWith({
      defaultPath: "paper.docx",
      filters: [{ name: "Word Document", extensions: ["docx"] }],
    });
    expect(invokeTauriCommand).toHaveBeenCalledWith("desktop_write_file_bytes", {
      path: "C:/exports/paper.docx",
      data: [1, 2, 3],
    });
  });

  it("returns cancelled when the Tauri save dialog is cancelled", async () => {
    vi.resetModules();
    const save = vi.fn(async () => null);
    const invokeTauriCommand = vi.fn();
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ save }));
    vi.doMock("../storage-adapter", () => ({
      isTauri: () => true,
      invokeTauriCommand,
    }));

    const { exportFile: desktopExportFile } = await import("../export-adapter");

    await expect(desktopExportFile(new Uint8Array([1]), {
      defaultFileName: "paper.pdf",
      filters: [{ name: "PDF Document", extensions: [".pdf"] }],
    })).resolves.toEqual({ success: false, cancelled: true });
    expect(invokeTauriCommand).not.toHaveBeenCalled();
  });
});
