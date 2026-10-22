import { describe, expect, it } from "vitest";
import { createSharedLibraryRuntime } from "../runtime";

describe("shared library runtime", () => {
  it("composes repository, search and remote content over one transport", () => {
    const runtime = createSharedLibraryRuntime({ baseUrl: "https://api.example.com", getAccessToken: async () => "token" });
    expect(runtime.repository).toBeTruthy();
    expect(runtime.searchClient).toBeTruthy();
    expect(runtime.contentStore).toBeTruthy();
    expect(runtime.createBlobStore("lib-1")).toBeTruthy();
    expect(runtime.transport).toBeTruthy();
  });
});
