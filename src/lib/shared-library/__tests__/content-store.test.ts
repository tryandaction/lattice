import { describe, expect, it } from "vitest";
import {
  InMemorySharedLibraryContentStore,
  type SharedLibraryItemContent,
} from "../content-store";

describe("shared library content store", () => {
  it("round-trips text content by stable item id", async () => {
    const store = new InMemorySharedLibraryContentStore();
    const content: SharedLibraryItemContent = {
      kind: "text",
      mimeType: "text/markdown",
      text: "# Notes",
      updatedAt: "2026-08-30T00:00:00.000Z",
    };

    await store.put("item-1", content);

    await expect(store.get("item-1")).resolves.toEqual(content);
  });

  it("copies binary data on write and read so callers cannot mutate storage", async () => {
    const store = new InMemorySharedLibraryContentStore();
    const source = new Uint8Array([1, 2, 3]).buffer;
    await store.put("item-1", {
      kind: "binary",
      mimeType: "application/pdf",
      data: source,
      updatedAt: "2026-08-30T00:00:00.000Z",
    });

    new Uint8Array(source)[0] = 9;
    const loaded = await store.get("item-1");
    expect(loaded?.kind).toBe("binary");
    expect(new Uint8Array((loaded as Extract<SharedLibraryItemContent, { kind: "binary" }>).data)[0]).toBe(1);
  });
});
