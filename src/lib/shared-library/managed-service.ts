import { validateCloudConnection, type CloudLibraryConnection } from "./connection";

export const MANAGED_CLOUD_CONNECTION_ID = "lattice-managed";

/** Public release configuration supplied by the operator, never by an ordinary user. */
export function managedCloudConnection(serialized: string | undefined): CloudLibraryConnection | null {
  if (!serialized?.trim()) return null;
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("云服务发布配置无效。");
  const config = parsed as Record<string, unknown>;
  const allowed = new Set(["name", "apiUrl", "supabaseUrl", "publicKey", "maxFileBytes"]);
  if (Object.keys(config).some(key => !allowed.has(key))) throw new Error("云服务发布配置只能包含公开连接信息，禁止包含管理凭据。");
  if (typeof config.apiUrl !== "string" || typeof config.supabaseUrl !== "string" || typeof config.publicKey !== "string") throw new Error("云服务发布配置缺少公开地址。");
  // Reject operator tokens even if accidentally pasted into the publicKey field.
  // validateCloudConnection checks the anon role of legacy JWTs below.
  const publicKey = config.publicKey.trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/u.test(publicKey) && publicKey.split(".").length !== 3) {
    throw new Error("正式云服务只能发布 Supabase publishable/anon key，不能发布管理令牌。");
  }
  if (new URL(config.apiUrl).protocol !== "https:" || new URL(config.supabaseUrl).protocol !== "https:") throw new Error("正式云服务必须使用 HTTPS。");
  return validateCloudConnection({
    id: MANAGED_CLOUD_CONNECTION_ID,
    name: typeof config.name === "string" ? config.name : "Lattice 云库",
    apiUrl: config.apiUrl, supabaseUrl: config.supabaseUrl, publicKey,
    maxFileBytes: typeof config.maxFileBytes === "number" ? config.maxFileBytes : 20 * 1024 * 1024,
  });
}

export function getManagedCloudConnection(): CloudLibraryConnection | null {
  // Direct access is required for Next's build-time substitution. All fields
  // are public; database passwords, operator tokens and service-role keys are rejected.
  return managedCloudConnection(process.env.NEXT_PUBLIC_LATTICE_CLOUD_SERVICE);
}

export function cloudStartupConnections(saved: readonly CloudLibraryConnection[], managed: CloudLibraryConnection | null, selectedId: string | null): { connections: CloudLibraryConnection[]; activeId: string } {
  const connections = managed ? [...saved.filter(connection => connection.id !== managed.id), managed] : [...saved];
  const activeId = connections.find(connection => connection.id === selectedId)?.id ?? managed?.id ?? (connections.length === 1 ? connections[0].id : "");
  return { connections, activeId };
}
