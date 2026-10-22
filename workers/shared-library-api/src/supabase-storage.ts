/** Private Storage REST adapter. Every request carries the current user JWT. */
export const SUPABASE_LIBRARY_BUCKET = "lattice-shared-library";
// Supabase persists one immutable object. The API negotiates that whole-object
// part size; transport retries verify persisted size and hash before accepting.
export const SUPABASE_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export class StorageRequestError extends Error {
  constructor(public status: number) { super("Private object storage request failed"); }
}

export class SupabaseBlobStore {
  constructor(private env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string }, private accessToken: string) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("apikey", this.env.SUPABASE_ANON_KEY);
    headers.set("authorization", `Bearer ${this.accessToken}`);
    return fetch(new URL(`/storage/v1/${path}`, this.env.SUPABASE_URL.replace(/\/+$/, "")), { ...init, headers });
  }

  private path(key: string): string { return `${SUPABASE_LIBRARY_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`; }

  async upload(key: string, data: ArrayBuffer, mimeType: string): Promise<boolean> {
    const response = await this.request(`object/${this.path(key)}`, {
      method: "POST", headers: { "content-type": mimeType, "x-upsert": "false", "cache-control": "no-store" }, body: data,
    });
    if (response.ok) return true;
    const error = await response.json().catch(() => null) as { statusCode?: string; error?: string } | null;
    if (response.status === 409 || error?.statusCode === "409" || error?.error === "Duplicate") return false;
    throw new StorageRequestError(response.status);
  }

  async get(key: string): Promise<{ body: ReadableStream<Uint8Array> | null; httpMetadata: { contentType?: string; contentLength?: number } } | null> {
    const response = await this.request(`object/authenticated/${this.path(key)}`);
    if (response.status === 404 || (response.status === 400 && (await response.clone().json().catch(() => null))?.statusCode === "404")) return null;
    if (!response.ok) throw new StorageRequestError(response.status);
    const length = response.headers.get("content-length");
    return { body: response.body, httpMetadata: {
      contentType: response.headers.get("content-type") ?? undefined,
      ...(length !== null && Number.isSafeInteger(Number(length)) ? { contentLength: Number(length) } : {}),
    } };
  }

  async remove(key: string): Promise<void> {
    // Delete through Storage API, never SQL: SQL deletes leave physical bytes.
    const response = await this.request(`object/${SUPABASE_LIBRARY_BUCKET}`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefixes: [key] }),
    });
    if (!response.ok) throw new StorageRequestError(response.status);
    // Storage may omit objects denied by RLS from its successful delete result.
    // The database abort guard independently requires physical metadata absent.
  }
}
