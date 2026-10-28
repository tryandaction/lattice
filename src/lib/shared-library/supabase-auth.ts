import type { AuthRepository, AuthSession, AuthSessionStore } from "./auth";
import { shouldRefreshSession } from "./auth";
import type { CloudLibraryConnection } from "./connection";
import { createDesktopSyncBridge } from "./desktop-bridge";
import { findEmailCallbackConnection, getCloudAuthRedirectUrl, type EmailConfirmationTokens } from "./email-confirmation";

export class SupabaseAuthRepository implements AuthRepository {
  constructor(private readonly connection: CloudLibraryConnection, private readonly fetchImpl: typeof fetch = fetch) {}

  private emailEndpoint(path: string, redirectTo?: string): string {
    const endpoint = `${this.connection.supabaseUrl}/auth/v1/${path}`;
    const redirect = redirectTo ? getCloudAuthRedirectUrl(redirectTo) : undefined;
    return redirect ? `${endpoint}?redirect_to=${encodeURIComponent(redirect)}` : endpoint;
  }

  private async token(grant: string, body: Record<string, string>, deviceId: string): Promise<AuthSession> {
    const response = await this.fetchImpl.call(globalThis, `${this.connection.supabaseUrl}/auth/v1/token?grant_type=${grant}`, {
      method: "POST", headers: { apikey: this.connection.publicKey, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { code?: string; error_code?: string } | null;
      const code = result?.code ?? result?.error_code;
      const message = response.status >= 500 ? "云端账号服务暂不可用，请稍后重试；本地文件仍可正常使用。" : response.status === 429 ? "登录请求较多，请稍后再试。" : code === "email_not_confirmed" ? "邮箱尚未确认，请打开注册邮件中的链接后再登录。" : "登录未完成，请检查邮箱和密码，或使用忘记密码。";
      throw Object.assign(new Error(message), { status: response.status, code });
    }
    const result = await response.json() as { access_token: string; refresh_token: string; expires_in: number; user: { id: string } };
    if (!result.access_token || !result.refresh_token || !result.user?.id || !Number.isFinite(result.expires_in)) throw new Error("身份服务返回无效会话。");
    return { accessToken: result.access_token, refreshToken: result.refresh_token, userId: result.user.id, deviceId, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString() };
  }

  signIn(input: { email: string; password: string; deviceId: string }) { return this.token("password", { email: input.email, password: input.password }, input.deviceId); }
  async signUp(email: string, password: string, redirectTo?: string): Promise<{ confirmationRequired: boolean }> {
    const response = await this.fetchImpl.call(globalThis, this.emailEndpoint("signup", redirectTo), {
      method: "POST", headers: { apikey: this.connection.publicKey, "content-type": "application/json" },
      body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => null) as { id?: string; access_token?: string; user?: { id?: string }; code?: string; error_code?: string } | null;
    if (!response.ok) {
      const code = result?.code ?? result?.error_code;
      const message = response.status === 429 ? "注册请求较多，请稍后再试。" : response.status >= 500 || code === "email_address_not_authorized" || code === "unexpected_failure" ? "注册邮件暂时无法发送，请稍后重试；本地文件仍可正常使用。" : "注册未完成，请检查邮箱和密码（至少 8 个字符）。";
      throw Object.assign(new Error(message), { status: response.status });
    }
    if (!result?.id && !result?.user?.id) throw new Error("身份服务返回无效注册结果。");
    return { confirmationRequired: !result.access_token };
  }
  refresh(input: { refreshToken: string; deviceId: string }) { return this.token("refresh_token", { refresh_token: input.refreshToken }, input.deviceId); }
  async confirmEmail(tokens: EmailConfirmationTokens, deviceId: string): Promise<AuthSession> {
    if (!findEmailCallbackConnection(tokens, [this.connection])) throw new Error("此确认链接不属于当前云服务，请返回原云库登录。");
    const response = await this.fetchImpl.call(globalThis, `${this.connection.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: this.connection.publicKey, authorization: `Bearer ${tokens.accessToken}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("确认会话已失效，请尝试登录或重新发送确认邮件。");
    const user = await response.json() as { id?: string; email_confirmed_at?: string };
    if (!user.id || !user.email_confirmed_at) throw new Error("邮箱尚未确认，请打开最新注册邮件中的链接。");
    // Rotate with the server to obtain authoritative expiry and a fresh durable session.
    const session = await this.refresh({ refreshToken: tokens.refreshToken, deviceId });
    if (session.userId !== user.id) throw new Error("确认链接的会话身份不一致，请重新登录。");
    return session;
  }
  async resendConfirmation(email: string, redirectTo?: string): Promise<void> {
    const response = await this.fetchImpl.call(globalThis, this.emailEndpoint("resend", redirectTo), {
      method: "POST", headers: { apikey: this.connection.publicKey, "content-type": "application/json" },
      body: JSON.stringify({ type: "signup", email }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(response.status === 429 ? "发送较频繁，请稍后再试。" : "确认邮件暂时无法发送，请稍后重试。");
  }
  async requestPasswordReset(email: string, redirectTo?: string): Promise<void> {
    const response = await this.fetchImpl.call(globalThis, this.emailEndpoint("recover", redirectTo), {
      method: "POST", headers: { apikey: this.connection.publicKey, "content-type": "application/json" },
      body: JSON.stringify({ email }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(response.status === 429 ? "发送较频繁，请稍后再试。" : "重置邮件暂时无法发送，请稍后重试。");
  }
  /** Recovery credentials stay separate from the account already open in this app. */
  async resetPassword(tokens: EmailConfirmationTokens, password: string): Promise<void> {
    if (!findEmailCallbackConnection(tokens, [this.connection])) throw new Error("此重置链接不属于当前云服务，请重新申请重置邮件。");
    if (password.length < 8) throw new Error("新密码至少需要 8 个字符。");
    const headers = { apikey: this.connection.publicKey, authorization: `Bearer ${tokens.accessToken}`, "content-type": "application/json" };
    const verified = await this.fetchImpl.call(globalThis, `${this.connection.supabaseUrl}/auth/v1/user`, { headers, signal: AbortSignal.timeout(15000) });
    if (!verified.ok) throw new Error("重置链接已失效，请重新申请重置邮件。");
    const user = await verified.json() as { id?: string };
    if (!user.id) throw new Error("重置链接无法验证，请重新申请重置邮件。");
    const response = await this.fetchImpl.call(globalThis, `${this.connection.supabaseUrl}/auth/v1/user`, {
      method: "PUT", headers, body: JSON.stringify({ password }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "重置链接已失效，请重新申请重置邮件。" : response.status === 429 ? "操作较频繁，请稍后再试。" : "密码未能更新，请换一个至少 8 位的新密码后重试。");
    const updated = await response.json() as { id?: string };
    if (updated.id !== user.id) throw new Error("重置链接的账号不一致，请重新申请重置邮件。");
  }
  async signOut(input: { session: AuthSession }) {
    const response = await this.fetchImpl.call(globalThis, `${this.connection.supabaseUrl}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: this.connection.publicKey, authorization: `Bearer ${input.session.accessToken}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok && response.status !== 401) throw new Error("本机已退出，远端会话撤销暂未完成。");
  }
}

export function createCloudSessionStore(key: string): AuthSessionStore {
  const bridge = createDesktopSyncBridge({ secureStore: {
    async get(name) { return localStorage.getItem(name); },
    async set(name, value) { localStorage.setItem(name, value); },
    async remove(name) { localStorage.removeItem(name); },
  } });
  return {
    async getSession() {
      const raw = await bridge.getSecureValue(key);
      if (!raw) return null;
      const candidate = JSON.parse(raw) as AuthSession;
      if (!candidate.accessToken || !candidate.refreshToken || !candidate.userId || !candidate.deviceId || !Number.isFinite(Date.parse(candidate.expiresAt))) throw new Error("存储的会话无效，请重新登录。");
      return candidate;
    },
    saveSession: session => bridge.setSecureValue(key, JSON.stringify(session)),
    clearSession: () => bridge.removeSecureValue(key),
  };
}

/** One in-flight refresh per connection. Network failures never erase refresh tokens. */
export class CloudAuthSession {
  private refreshing: Promise<AuthSession | null> | null = null;
  private mutation: Promise<void> = Promise.resolve();
  private generation = 0;
  private userId: string | null = null;
  constructor(private readonly store: AuthSessionStore, private readonly repository: AuthRepository & { confirmEmail?: (tokens: EmailConfirmationTokens, deviceId: string) => Promise<AuthSession> }, private readonly deviceId: string) {}
  /** Serialize durable changes so a delayed save cannot finish after logout. */
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(operation);
    this.mutation = next.then(() => {}, () => {});
    return next;
  }
  private async saveIdentity(session: AuthSession, epoch: number) {
    await this.mutate(async () => {
      if (epoch !== this.generation) throw new Error("身份操作已取消。");
      await this.store.saveSession(session);
      this.userId = session.userId;
    });
    if (epoch !== this.generation) throw new Error("身份操作已取消。");
    return session;
  }
  async confirmEmail(tokens: EmailConfirmationTokens) {
    const epoch = ++this.generation;
    if (!this.repository.confirmEmail) throw new Error("当前云服务不支持确认链接登录，请使用邮箱和密码登录。");
    const session = await this.repository.confirmEmail(tokens, this.deviceId);
    return this.saveIdentity(session, epoch);
  }
  async signIn(email: string, password: string) {
    const epoch = ++this.generation;
    const session = await this.repository.signIn({ email, password, deviceId: this.deviceId });
    return this.saveIdentity(session, epoch);
  }
  async load(): Promise<AuthSession | null> {
    const epoch = this.generation;
    await this.mutation;
    const session = await this.store.getSession();
    if (epoch !== this.generation) return null;
    if (!session || session.deviceId !== this.deviceId) return null;
    if (this.userId && session.userId !== this.userId) throw Object.assign(new Error("账号已在另一窗口切换，请重新连接。"), { status: 401 });
    this.userId = session.userId;
    if (!shouldRefreshSession(session)) return session;
    if (!this.refreshing) {
      this.refreshing = this.repository.refresh({ refreshToken: session.refreshToken, deviceId: this.deviceId }).then(async next => {
        const saved = await this.mutate(async () => {
          if (epoch !== this.generation) return false;
          const current = await this.store.getSession();
          if (epoch !== this.generation) return false;
          if (current?.refreshToken !== session.refreshToken || current.userId !== session.userId) return false;
          await this.store.saveSession(next);
          return true;
        });
        return saved && epoch === this.generation ? next : null;
      }).catch(async error => {
        const status = (error as { status?: number }).status;
        if (epoch === this.generation && (status === 400 || status === 401 || status === 403)) {
          await this.mutate(async () => {
            const current = await this.store.getSession();
            if (epoch === this.generation && current?.userId === session.userId && current.refreshToken === session.refreshToken) await this.store.clearSession();
          });
        }
        throw error;
      }).finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
  async accessToken() { return (await this.load())?.accessToken ?? null; }
  invalidate() { ++this.generation; }
  async signOut() {
    const epoch = ++this.generation;
    const session = await this.mutate(async () => {
      const current = await this.store.getSession();
      if (current && this.userId && current.userId !== this.userId) throw Object.assign(new Error("账号已切换；不会退出另一账号的会话。"), { status: 401 });
      await this.store.clearSession();
      if (epoch === this.generation) this.userId = null;
      return current;
    });
    if (session) await this.repository.signOut({ session });
  }
}
