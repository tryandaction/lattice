export interface CloudLibraryConnection {
  id: string;
  name: string;
  apiUrl: string;
  supabaseUrl: string;
  publicKey: string;
  maxFileBytes: number;
}

export interface ParsedCloudConnectionInput {
  libraryId?: string;
  inviteToken?: string;
  name: string;
  apiUrl: string;
  supabaseUrl: string;
  publicKey: string;
}

function publicUrl(value: string): string {
  const url = new URL(value.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
    throw new Error("连接必须使用 HTTPS；本机测试可用 HTTP，不得含凭据或查询参数。");
  }
  return url.toString().replace(/\/+$/, "");
}

export function validateCloudConnection(input: CloudLibraryConnection): CloudLibraryConnection {
  const key = input.publicKey.trim();
  if (!key || /sb_secret_|service.role|administrator/i.test(key)) throw new Error("这里只接受 Supabase 公开 publishable/anon key。");
  if (key.split(".").length === 3) {
    try {
      const payload = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string };
      if (payload.role !== "anon") throw new Error("secret");
    } catch { throw new Error("JWT 客户端 key 必须是 anon 角色，禁止 service-role。"); }
  }
  if (!input.id || !input.name.trim() || !Number.isSafeInteger(input.maxFileBytes) || input.maxFileBytes < 1 || input.maxFileBytes > 100 * 1024 * 1024) {
    throw new Error("连接名称必填；单文件限制须为 1–100 MiB。");
  }
  return { ...input, name: input.name.trim(), apiUrl: publicUrl(input.apiUrl), supabaseUrl: publicUrl(input.supabaseUrl), publicKey: key };
}

/** Parse the one value a normal user can paste into the cloud connection dialog. */
export function parseCloudConnectionInput(value: string): ParsedCloudConnectionInput | null {
  const raw = value.trim();
  if (!raw) return null;
  let candidate: Record<string, unknown> | null = null;
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) candidate = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  } else {
    try {
      const url = new URL(raw);
      const query = url.hash ? new URLSearchParams(url.hash.slice(1)) : url.searchParams;
      candidate = {
        libraryId: query.get("library"),
        inviteToken: query.get("invite"),
        name: query.get("name") ?? query.get("library") ?? "",
        apiUrl: query.get("api") ?? query.get("apiUrl") ?? "",
        supabaseUrl: query.get("supabase") ?? query.get("supabaseUrl") ?? "",
        publicKey: query.get("key") ?? query.get("publicKey") ?? "",
      };
    } catch {
      return null;
    }
  }
  if (!candidate) return null;
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const apiUrl = typeof candidate.apiUrl === "string" ? candidate.apiUrl : typeof candidate.api === "string" ? candidate.api : "";
  const supabaseUrl = typeof candidate.supabaseUrl === "string" ? candidate.supabaseUrl : typeof candidate.supabase === "string" ? candidate.supabase : "";
  const publicKey = typeof candidate.publicKey === "string" ? candidate.publicKey : typeof candidate.key === "string" ? candidate.key : "";
  if (!name.trim() || !apiUrl.trim() || !supabaseUrl.trim() || !publicKey.trim()) return null;
  const normalized = validateCloudConnection({ id: "pasted-connection", name, apiUrl, supabaseUrl, publicKey, maxFileBytes: 100 * 1024 * 1024 });
  const invitation = typeof candidate.inviteToken === "string" ? candidate.inviteToken : typeof candidate.invite === "string" ? candidate.invite : undefined;
  const libraryId = typeof candidate.libraryId === "string" ? candidate.libraryId : typeof candidate.library === "string" ? candidate.library : undefined;
  if ((invitation && (!libraryId || /[\u0000-\u0020]/.test(invitation))) || (libraryId && /[\u0000-\u0020]/.test(libraryId))) throw new Error("邀请链接中的库或邀请信息无效。");
  return { name: normalized.name, apiUrl: normalized.apiUrl, supabaseUrl: normalized.supabaseUrl, publicKey: normalized.publicKey, ...(invitation ? { inviteToken: invitation } : {}), ...(libraryId ? { libraryId } : {}) };
}

export function cloudScope(connection: CloudLibraryConnection, userId: string): string {
  // Endpoint identity is part of scope: editing a connection cannot reuse the old tenant's cache.
  return JSON.stringify([connection.id, connection.apiUrl, connection.supabaseUrl, userId]);
}

export function validateCloudPath(path: string): string {
  const normalized = path.normalize("NFC");
  if (!normalized || normalized.startsWith("/") || /[\\\u0000-\u001f]/.test(normalized) || /^[a-z]:/i.test(normalized) || normalized.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("文件路径不能越界、包含空段或使用反斜杠。");
  }
  return normalized;
}

/** Invitation credentials stay in the fragment so hosting servers never receive them. */
export function createCloudInviteUrl(baseUrl: string, connection: CloudLibraryConnection, libraryId: string, inviteToken: string): string {
  const publicConnection = validateCloudConnection(connection);
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = new URLSearchParams({ name: publicConnection.name, api: publicConnection.apiUrl, supabase: publicConnection.supabaseUrl, key: publicConnection.publicKey, library: libraryId, invite: inviteToken }).toString();
  if (!parseCloudConnectionInput(url.toString())?.inviteToken) throw new Error("邀请信息无效。");
  return url.toString();
}

export function resolveCloudConnection(input: ParsedCloudConnectionInput, connections: CloudLibraryConnection[]): CloudLibraryConnection {
  const existing = connections.find(connection => connection.apiUrl === input.apiUrl && connection.supabaseUrl === input.supabaseUrl && connection.publicKey === input.publicKey);
  return existing ?? validateCloudConnection({ id: crypto.randomUUID(), name: input.name, apiUrl: input.apiUrl, supabaseUrl: input.supabaseUrl, publicKey: input.publicKey, maxFileBytes: 100 * 1024 * 1024 });
}
