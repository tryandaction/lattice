import type { CloudLibraryConnection } from "./connection";
import { currentProductWebUrl, LATTICE_WEB_URL } from "@/lib/product-links";

export interface EmailConfirmationTokens { accessToken: string; refreshToken: string }
export type CloudEmailCallback = ({ kind: "session" | "recovery" } & EmailConfirmationTokens) | { kind: "error"; message: string; messageKey: "cloud.email.expired" | "cloud.email.invalid" };

const callbackKeys = ["access_token", "refresh_token", "expires_at", "expires_in", "token_type", "type", "provider_token", "provider_refresh_token", "error", "error_code", "error_description", "code", "sb"];
const expiryMessage = "确认链接已过期或已使用。请先尝试登录；邮箱仍未确认时，可重新发送确认邮件。";
const invalidMessage = "无法完成邮箱确认。请尝试登录，或重新发送确认邮件后打开最新链接。";

/** Auth credentials never remain in browser history; unrelated invitation fields survive. */
export function readCloudEmailCallback(input: string): { callback: CloudEmailCallback | null; cleanUrl: string } {
  const url = new URL(input);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const isCallback = (values: URLSearchParams) => ["access_token", "refresh_token", "error_code", "error", "code"].some(key => values.has(key));
  const fragmentCallback = isCallback(fragment);
  const values = fragmentCallback ? fragment : isCallback(url.searchParams) ? url.searchParams : null;
  if (!values) return { callback: null, cleanUrl: input };
  const accessToken = values.get("access_token"); const refreshToken = values.get("refresh_token"); const type = values.get("type");
  const error = values.get("error"); const errorCode = values.get("error_code");
  let callback: CloudEmailCallback;
  if (error || errorCode) callback = { kind: "error", message: errorCode === "otp_expired" ? expiryMessage : invalidMessage, messageKey: errorCode === "otp_expired" ? "cloud.email.expired" : "cloud.email.invalid" };
  else if (!accessToken || !refreshToken || [accessToken, refreshToken].some(value => value.length > 16384 || /[\u0000-\u0020]/u.test(value)) || (type && !["signup", "email", "invite", "recovery"].includes(type))) callback = { kind: "error", message: invalidMessage, messageKey: "cloud.email.invalid" };
  else callback = { kind: type === "recovery" ? "recovery" : "session", accessToken, refreshToken };
  for (const key of callbackKeys) { fragment.delete(key); url.searchParams.delete(key); }
  if (fragmentCallback) url.hash = fragment.toString();
  return { callback, cleanUrl: url.toString() };
}

/** Mail returns to the app without copying invitation secrets or shell-only URLs. */
export function getCloudAuthRedirectUrl(input: string): string | undefined {
  try {
    const url = new URL(currentProductWebUrl(input));
    if (url.username || url.password) return undefined;
    if (url.protocol === "tauri:" || ["tauri.localhost", "localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return LATTICE_WEB_URL;
    if (url.protocol !== "https:") return undefined;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return undefined; }
}

/** The unverified issuer selects only an existing trusted endpoint; the server verifies identity. */
export function findEmailCallbackConnection(tokens: EmailConfirmationTokens, connections: readonly CloudLibraryConnection[]): CloudLibraryConnection | null {
  try {
    const segments = tokens.accessToken.split(".");
    if (segments.length !== 3) return null;
    const payload: unknown = JSON.parse(atob(segments[1].replace(/-/g, "+").replace(/_/g, "/")));
    const issuer = payload && typeof payload === "object" && "iss" in payload ? payload.iss : null;
    return connections.find(connection => issuer === `${connection.supabaseUrl.replace(/\/+$/u, "")}/auth/v1`) ?? null;
  } catch { return null; }
}
