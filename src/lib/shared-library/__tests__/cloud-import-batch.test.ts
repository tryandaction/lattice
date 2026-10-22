/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { persistCloudImportBatch, validateCloudImportBatch } from "../cloud-import-batch";

describe("cloud local import batch", () => {
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
