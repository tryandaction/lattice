import { describe, expect, it } from "vitest";
import { collectCloudDropFiles } from "../cloud-drop-import";

describe("directory drop capability traversal", () => {
  it("reads directory batches and preserves nested Chinese names without a format whitelist", async () => {
    const first = new File([new Uint8Array([0, 255])], "未知.custom", { type: "application/x-custom" });
    const second = new File(["# child"], "中文 空格.md", { type: "text/markdown" });
    const entry = (file: File) => ({ name: file.name, isFile: true, isDirectory: false, file: (success: (value: File) => void) => success(file) });
    const batches = [[entry(first)], [entry(second)], []];
    const directory = { name: "共享 目录", isFile: false, isDirectory: true, createReader: () => ({ readEntries: (success: (values: unknown[]) => void) => success(batches.shift() ?? []) }) };
    const transfer = { items: [{ kind: "file", webkitGetAsEntry: () => directory }], files: [] } as unknown as DataTransfer;
    const files = await collectCloudDropFiles(transfer);
    expect(files.map(file => file.webkitRelativePath)).toEqual(["共享 目录/未知.custom", "共享 目录/中文 空格.md"]);
    expect(files[0].type).toBe("application/x-custom");
  });
  it("rejects traversal before invoking an entry's file reader", async () => {
    let read = false;
    const entry = { name: "..", isFile: true, isDirectory: false, file: () => { read = true; } };
    const transfer = { items: [{ kind: "file", webkitGetAsEntry: () => entry }], files: [] } as unknown as DataTransfer;
    await expect(collectCloudDropFiles(transfer)).rejects.toThrow("文件路径不能越界"); expect(read).toBe(false);
  });
});
