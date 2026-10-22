import { createCloudInviteUrl, validateCloudConnection, type CloudLibraryConnection } from "./connection";
import { currentProductWebUrl } from "@/lib/product-links";

export interface PendingCloudInvitation {
  token: string;
  libraryId: string;
  connectionId: string;
  accepted?: boolean;
  acceptedUserId?: string;
}

export function retainCloudInvitation(next: PendingCloudInvitation, saved: PendingCloudInvitation | null): PendingCloudInvitation {
  return saved?.token === next.token && saved.libraryId === next.libraryId && saved.connectionId === next.connectionId ? saved : next;
}

export function cloudUploadLabel(input: { adding: boolean; completed: boolean; failed: number; localLabel: string; pending: number; offline: boolean; paused: boolean; syncFailed: boolean }): string {
  if (input.adding) return "正在添加文件…";
  if (input.failed) return input.localLabel;
  if (input.syncFailed) return "同步遇到问题，请重试";
  if (input.paused) return "同步已暂停";
  if (input.offline) return "离线 · 联网后同步";
  if (input.pending) return `${input.pending} 项正在同步`;
  return input.completed ? "文件已同步" : "文件尚未添加";
}

/** Desktop origins are shell addresses, so export a portable pasteable payload. */
export function createCloudInviteShare(baseUrl: string, connection: CloudLibraryConnection, libraryId: string, inviteToken: string): string {
  const origin = new URL(baseUrl);
  if (["tauri.localhost", "localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || !["http:", "https:"].includes(origin.protocol)) {
    const normalized = validateCloudConnection(connection);
    return JSON.stringify({ name: normalized.name, apiUrl: normalized.apiUrl, supabaseUrl: normalized.supabaseUrl, publicKey: normalized.publicKey, libraryId, inviteToken });
  }
  return createCloudInviteUrl(currentProductWebUrl(baseUrl), connection, libraryId, inviteToken);
}
