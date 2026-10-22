/**
 * Auth session boundary.
 *
 * Sessions are device-bound and expiring. A session whose token expires is
 * refreshable — it is never silently treated as "signed out"; only a failed
 * refresh clears it. The concrete sign-in/refresh transport (Supabase Auth or
 * the Worker) lives behind `AuthRepository`, so this module stays
 * environment-agnostic and testable.
 */

import type { DeviceId } from "./domain";

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  deviceId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface SessionToken {
  value: string;
  expiresAt: string;
}

export interface AuthSessionStore {
  getSession(): Promise<AuthSession | null>;
  saveSession(session: AuthSession): Promise<void>;
  clearSession(): Promise<void>;
}

export interface AuthRepository {
  signIn(input: { email: string; password: string; deviceId: DeviceId }): Promise<AuthSession>;
  refresh(input: { refreshToken: string; deviceId: DeviceId }): Promise<AuthSession>;
  signOut(input: { session: AuthSession }): Promise<void>;
}

export const DEFAULT_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

export function isSessionExpired(session: AuthSession, now?: string): boolean {
  return Date.parse(session.expiresAt) <= Date.parse(now ?? new Date().toISOString());
}

export function validateSessionForDevice(session: AuthSession, deviceId: DeviceId): boolean {
  return session.deviceId === deviceId;
}

export function isSessionUsable(session: AuthSession, deviceId: DeviceId, now?: string): boolean {
  return validateSessionForDevice(session, deviceId) && !isSessionExpired(session, now);
}

export function shouldRefreshSession(
  session: AuthSession,
  now?: string,
  thresholdMs: number = DEFAULT_REFRESH_THRESHOLD_MS,
): boolean {
  return Date.parse(session.expiresAt) - Date.parse(now ?? new Date().toISOString()) <= thresholdMs;
}

export class AuthSessionManager {
  private readonly store: AuthSessionStore;
  private readonly repository: AuthRepository;

  constructor(options: { store: AuthSessionStore; repository: AuthRepository }) {
    this.store = options.store;
    this.repository = options.repository;
  }

  /**
   * Returns a usable session for `deviceId`, refreshing transparently when the
   * stored session is expired or close to expiry. Returns null only when there
   * is no session, the session belongs to another device, or a refresh fails.
   */
  async loadValidSession(deviceId: DeviceId, now?: string): Promise<AuthSession | null> {
    const session = await this.store.getSession();
    if (!session) {
      return null;
    }

    if (!validateSessionForDevice(session, deviceId)) {
      await this.store.clearSession();
      return null;
    }

    if (!isSessionExpired(session, now) && !shouldRefreshSession(session, now)) {
      return session;
    }

    try {
      const refreshed = await this.repository.refresh({
        refreshToken: session.refreshToken,
        deviceId,
      });
      await this.store.saveSession(refreshed);
      return refreshed;
    } catch {
      await this.store.clearSession();
      return null;
    }
  }
}
