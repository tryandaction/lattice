import type { CloudLibraryConnection } from "./connection";

export interface CloudAccountProgress {
  email: string;
  stage: "register" | "otp";
  confirmation: "sent" | "unconfirmed" | "unknown" | null;
  resendAt: number;
  expiresAt: number;
}

function storageKey(connection: CloudLibraryConnection): string {
  return `lattice-cloud-account-progress-v1:${JSON.stringify([connection.id, connection.apiUrl, connection.supabaseUrl])}`;
}

/** Tab-scoped recovery contains only non-secret progress. Passwords and OTPs never enter storage. */
export function readCloudAccountProgress(connection?: CloudLibraryConnection): CloudAccountProgress | null {
  if (!connection || typeof sessionStorage === "undefined") return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(connection)) ?? "null") as CloudAccountProgress | null;
    if (!value || typeof value.email !== "string" || value.email.length > 320 ||
      !["register", "otp"].includes(value.stage) || ![null, "sent", "unconfirmed", "unknown"].includes(value.confirmation) ||
      !Number.isFinite(value.resendAt) || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return null;
    return { email: value.email, stage: value.stage, confirmation: value.confirmation, resendAt: value.resendAt, expiresAt: value.expiresAt };
  } catch { return null; }
}

export function saveCloudAccountProgress(connection: CloudLibraryConnection | undefined, value: CloudAccountProgress | null): void {
  if (!connection || typeof sessionStorage === "undefined") return;
  try {
    if (!value) sessionStorage.removeItem(storageKey(connection));
    else sessionStorage.setItem(storageKey(connection), JSON.stringify({
      email: value.email, stage: value.stage, confirmation: value.confirmation, resendAt: value.resendAt, expiresAt: value.expiresAt,
    }));
  } catch { /* Disabled storage must not interrupt account access. */ }
}
