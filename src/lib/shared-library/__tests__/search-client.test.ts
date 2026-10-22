import { describe, expect, it, vi } from "vitest";
import {
  buildSearchSnippet,
  createSharedLibrarySearchClient,
  RemoteSharedLibrarySearchTransport,
  type SharedLibrarySearchResult,
  type SharedLibrarySearchTransport,
} from "../search-client";

const validResult: SharedLibrarySearchResult = {
  itemId: "item-1",
  childItemId: "child-1",
  sourceType: "child-item",
  snippet: "…entanglement…",
  locator: { locatorType: "offset", locator: { offset: 10 } },
  permissionSnapshot: { libraryId: "lib-1", itemId: "item-1", canRead: true, role: "editor" },
  updatedAt: "2026-08-20T00:00:00.000Z",
  score: 0.9,
};

describe("SharedLibrarySearchClient", () => {
  it("maps the shared API envelope through the common transport", async () => {
    const transport = {
      request: vi.fn(async () => ({
        status: 200,
        body: { data: { results: [validResult], nextCursor: "cursor-1", total: 1 } },
      })),
    };
    const client = createSharedLibrarySearchClient(new RemoteSharedLibrarySearchTransport(transport));

    await expect(client.search({ q: " Quantum ", libraryId: "lib/1", limit: 20 })).resolves.toEqual({
      results: [validResult],
      nextCursor: "cursor-1",
      total: 1,
    });
    expect(transport.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/v1/libraries/lib%2F1/search",
      query: { q: "quantum", limit: 20, cursor: undefined },
    }));
  });

  it("normalizes the query and returns results through the transport", async () => {
    const transport: SharedLibrarySearchTransport = {
      search: vi.fn(async () => ({ results: [validResult] })),
    };
    const client = createSharedLibrarySearchClient(transport);

    const response = await client.search({ q: "  Entanglement \n" });

    expect(transport.search).toHaveBeenCalledWith({ q: "entanglement" });
    expect(response.results[0]).toMatchObject(validResult);
  });

  it("returns an empty page without calling the transport for blank queries", async () => {
    const transport = { search: vi.fn() };
    const client = createSharedLibrarySearchClient(transport);

    const response = await client.search({ q: "   \n " });

    expect(response).toEqual({ results: [] });
    expect(transport.search).not.toHaveBeenCalled();
  });

  it("search results carry the full contract", () => {
    expect(validResult).toHaveProperty("itemId");
    expect(validResult).toHaveProperty("childItemId");
    expect(validResult).toHaveProperty("sourceType");
    expect(validResult).toHaveProperty("snippet");
    expect(validResult).toHaveProperty("locator");
    expect(validResult.permissionSnapshot).toHaveProperty("canRead");
    expect(validResult).toHaveProperty("updatedAt");
  });
});

describe("buildSearchSnippet", () => {
  it("returns an empty string for an empty query", () => {
    expect(buildSearchSnippet("some text", "")).toBe("");
  });

  it("finds a case-insensitive match and returns surrounding context", () => {
    const snippet = buildSearchSnippet(
      "The QUICK brown fox jumps over the lazy dog",
      "quick",
      6,
    );
    expect(snippet.toLowerCase()).toContain("quick");
    expect(snippet).toContain("…");
  });

  it("returns a trimmed head preview when there is no match", () => {
    const snippet = buildSearchSnippet("  alpha beta gamma delta  ", "zeta");
    expect(snippet).not.toContain("zeta");
    expect(snippet.trim()).toBe(snippet);
  });

  it("omits the leading ellipsis when the match starts at the beginning", () => {
    const snippet = buildSearchSnippet(
      "entanglement is a quantum resource",
      "entanglement",
      5,
    );
    expect(snippet.startsWith("…")).toBe(false);
    expect(snippet.toLowerCase()).toContain("entanglement");
  });
});
