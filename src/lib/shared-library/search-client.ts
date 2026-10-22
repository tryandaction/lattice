/**
 * Shared-library search client.
 *
 * Wraps a search transport (Cloud API on Web, Tauri IPC on Desktop, a fake in
 * tests) behind one query contract. Queries are normalized with the shared
 * `normalizeSearchText` utility so local and remote indexes compare identical
 * tokens. Results must always carry the full contract below so the UI can
 * render, navigate, and permission-gate every hit.
 */

import { normalizeSearchText } from "@/lib/searchable-text";
import type { SharedLibraryTransport } from "./remote-repository";
import type { LibraryRole } from "./domain";

export type SearchResultSourceType = "item" | "child-item" | "annotation" | "url" | "file";

export interface SharedLibrarySearchPermissionSnapshot {
  libraryId: string;
  itemId: string;
  canRead: boolean;
  role?: LibraryRole;
}

export interface SharedLibrarySearchLocator {
  locatorType: string;
  locator: Record<string, string | number | readonly number[]>;
}

export interface SharedLibrarySearchResult {
  itemId: string;
  childItemId?: string;
  sourceType: SearchResultSourceType;
  snippet: string;
  locator?: SharedLibrarySearchLocator;
  permissionSnapshot: SharedLibrarySearchPermissionSnapshot;
  updatedAt: string;
  score?: number;
}

export interface SharedLibrarySearchQuery {
  q: string;
  libraryId?: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface SharedLibrarySearchResponse {
  results: SharedLibrarySearchResult[];
  nextCursor?: string;
  total?: number;
}

export interface SharedLibrarySearchTransport {
  search(query: SharedLibrarySearchQuery): Promise<SharedLibrarySearchResponse>;
}

export interface SharedLibrarySearchClient {
  search(query: SharedLibrarySearchQuery): Promise<SharedLibrarySearchResponse>;
}

/** HTTP-backed search transport. The API remains behind the same transport
 * boundary as the repository, so auth, timeout and structured errors are
 * handled consistently by `ApiTransport`. */
export class RemoteSharedLibrarySearchTransport implements SharedLibrarySearchTransport {
  constructor(private readonly transport: SharedLibraryTransport) {}

  async search(query: SharedLibrarySearchQuery): Promise<SharedLibrarySearchResponse> {
    const response = await this.transport.request({
      method: "GET",
      path: query.libraryId
        ? `/v1/libraries/${encodeURIComponent(query.libraryId)}/search`
        : "/v1/search",
      query: {
        q: query.q,
        limit: query.limit,
        cursor: query.cursor,
      },
      signal: query.signal,
    });
    const body = response.body;
    const data = typeof body === "object" && body !== null && "data" in body
      ? (body as { data: unknown }).data
      : body;
    if (typeof data !== "object" || data === null) {
      return { results: [] };
    }
    const result = data as { results?: unknown; nextCursor?: unknown; total?: unknown };
    return {
      results: Array.isArray(result.results) ? result.results as SharedLibrarySearchResult[] : [],
      ...(typeof result.nextCursor === "string" && result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      ...(typeof result.total === "number" ? { total: result.total } : {}),
    };
  }
}

export function createSharedLibrarySearchClient(
  transport: SharedLibrarySearchTransport,
): SharedLibrarySearchClient {
  return {
    async search(query) {
      const q = normalizeSearchText(query.q);
      if (!q) {
        return { results: [] };
      }
      return transport.search({ ...query, q });
    },
  };
}

/**
 * Builds a local snippet around the first case-insensitive match of `query`.
 * Server results already carry snippets; this is the local fallback for
 * indexes without server-side highlighting.
 */
export function buildSearchSnippet(text: string, query: string, contextChars = 40): string {
  const needle = normalizeSearchText(query);
  if (!needle || !text) {
    return "";
  }

  let index = text.toLowerCase().indexOf(needle);
  if (index === -1) {
    // Whitespace may have collapsed between the raw text and the normalized
    // needle; fall back to the normalized offset as an approximation.
    const normalizedIndex = normalizeSearchText(text).indexOf(needle);
    if (normalizedIndex === -1) {
      const preview = text.replace(/\s+/g, " ").trim();
      return preview.length > contextChars * 2
        ? `${preview.slice(0, contextChars * 2)}…`
        : preview;
    }
    index = normalizedIndex;
  }

  const start = Math.max(0, index - contextChars);
  const end = Math.min(text.length, index + needle.length + contextChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}
