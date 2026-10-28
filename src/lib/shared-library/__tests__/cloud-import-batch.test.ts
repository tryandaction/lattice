/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { createCloudImportBatch, persistCloudImportBatch, validateCloudImportBatch } from "../cloud-import-batch";

describe("cloud local import batch", () => {
  it("keeps valid files available when another file exceeds the limit", () => {
    const files = [new File(["a"], "small.md"), new File(["large"], "large.md")];
    const batch = createCloudImportBatch(files, 2);
    expect(batch.map(entry => [entry.path, entry.state])).toEqual([["small.md", "pending"], ["large.md", "failed"]]);
    expect(batch[1].error).toContain("单文件限额");
  });
  it("preserves folder paths and rejects only repeated paths without renaming or overwriting", () => {
    const first = new File(["a"], "note.md");
    const nested = new File(["b"], "note.md");
    Object.defineProperty(nested, "webkitRelativePath", { value: "folder/note.md" });
    const batch = createCloudImportBatch([first, nested, first], 10);
    expect(batch.map(entry => [entry.path, entry.state])).toEqual([["note.md", "pending"], ["folder/note.md", "pending"], ["note.md", "failed"]]);
    expect(new Set(batch.map(entry => entry.id)).size).toBe(3);
  });
  it("rejects the eligible batch before reading when its total exceeds remaining storage", () => {
    const batch = createCloudImportBatch([new File(["aa"], "a.md"), new File(["bb"], "b.md")], 10, 3);
    expect(batch.every(entry => entry.state === "failed")).toBe(true);
    expect(batch.every(entry => entry.error?.includes("剩余额度"))).toBe(true);
  });
  it("validates every path and byte limit before persisting", () => {
    const a = new File(["a"], "good.md");
    const b = new File(["bb"], "../bad.md");
    expect(() => validateCloudImportBatch([a, b], 10)).toThrow();
    expect(() => validateCloudImportBatch([a], 0)).toThrow();
    expect(() => validateCloudImportBatch([a], 10, 0)).toThrow();
    expect(() => validateCloudImportBatch([a, a], 10)).toThrow();
  });
  it("continues after an individual failure and retries only failed files", async () => {
    const files = [new File(["a"], "a.md"), new File(["b"], "b.md"), new File(["c"], "c.md")];
    const persist = vi.fn(async (file: File) => { if (file.name === "b.md") throw new Error("read failed"); });
    const result = await persistCloudImportBatch(files, files.map(file => file.name), persist, () => false);
    expect(result.completed).toBe(2);
    expect(result.failures.map(failure => failure.path)).toEqual(["b.md"]);
    const retry = vi.fn(async () => {});
    await persistCloudImportBatch(result.failures.map(failure => failure.file), result.failures.map(failure => failure.path), retry, () => false);
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it("preserves every unprocessed file for resume after pause", async () => {
    const files = [new File(["a"], "a.md"), new File(["b"], "b.md")];
    const result = await persistCloudImportBatch(files, ["a.md", "b.md"], async () => {}, () => true);
    expect(result.completed).toBe(0);
    expect(result.failures).toHaveLength(2);
  });
});
