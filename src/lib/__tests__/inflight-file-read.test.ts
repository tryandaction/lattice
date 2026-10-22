import { describe, expect, it, vi } from "vitest";
import { readFileOnce } from "../inflight-file-read";

describe("readFileOnce", () => {
  it("shares concurrent reads but reads the latest disk content after settlement", async () => {
    const handle = {} as FileSystemFileHandle;
    let resolve!: (text: string) => void;
    const read = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const first = readFileOnce(handle, "text", read);
    const second = readFileOnce(handle, "text", read);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    resolve("original");
    expect(await first).toBe("original");
    expect(await second).toBe("original");
    expect(await readFileOnce(handle, "text", async () => "external edit")).toBe("external edit");
  });

  it("does not share unrelated handles or retain a failed read", async () => {
    const a = {} as FileSystemFileHandle;
    const b = {} as FileSystemFileHandle;
    const failure = readFileOnce(a, "text", async () => { throw new Error("read failed"); });
    expect(await readFileOnce(b, "text", async () => "other file")).toBe("other file");
    await expect(failure).rejects.toThrow("read failed");
    expect(await readFileOnce(a, "text", async () => "retry")).toBe("retry");
  });
});
