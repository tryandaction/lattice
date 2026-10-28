// workers/shared-library-api/src/server-secret-crypto.ts
function encodeBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function decodeBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
async function importSecretKey(encoded) {
  let bytes;
  try {
    bytes = decodeBase64(encoded);
  } catch {
    throw new Error("Invalid server encryption key");
  }
  if (bytes.byteLength !== 32) throw new Error("Server encryption key must contain exactly 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptServerSecret(secret, encodedKey, recordIdentity) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(recordIdentity) }, await importSecretKey(encodedKey), new TextEncoder().encode(secret));
  return `v1.${encodeBase64(iv)}.${encodeBase64(new Uint8Array(ciphertext))}`;
}
async function decryptServerSecret(ciphertext, encodedKey, recordIdentity) {
  const [version, encodedIv, encodedCiphertext, extra] = ciphertext.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext || extra) throw new Error("Invalid encrypted secret");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(encodedIv), additionalData: new TextEncoder().encode(recordIdentity) }, await importSecretKey(encodedKey), decodeBase64(encodedCiphertext));
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}

// workers/shared-library-api/src/github.ts
var GitHubError = class extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
};
var fail = (code, message, status) => {
  throw new GitHubError(code, message, status);
};
var object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var rows = (value) => Array.isArray(value) ? value.map(object) : [];
var first = (value) => rows(value)[0];
var numericId = (value) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) fail("INVALID_INPUT", "A positive numeric GitHub ID is required", 400);
  return value;
};
function text(value, max = 1e3) {
  if (typeof value !== "string" || !value || value.length > max) fail("INVALID_INPUT", "Invalid GitHub request value", 400);
  return value;
}
async function encryptGitHubSecret(secret, key, identity) {
  try {
    return await encryptServerSecret(secret, key, identity);
  } catch {
    return fail("GITHUB_NOT_CONFIGURED", "Invalid GitHub encryption key", 503);
  }
}
async function decryptGitHubSecret(ciphertext, key, identity) {
  return decryptServerSecret(ciphertext, key, identity);
}
function configuration(context) {
  const env = context.env;
  for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_TOKEN_ENCRYPTION_KEY", "GITHUB_OAUTH_REDIRECT_URI"]) {
    if (!env[key]) fail("GITHUB_NOT_CONFIGURED", "GitHub App integration is not configured", 503);
  }
  return env;
}
async function database(context, table, init = {}, query = {}) {
  const env = configuration(context);
  const url = new URL(`/rest/v1/${table}`, context.env.SUPABASE_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const headers = new Headers({ "content-type": "application/json", prefer: "return=representation", ...Object.fromEntries(new Headers(init.headers)) });
  headers.set("apikey", env.SUPABASE_SERVICE_ROLE_KEY);
  if (env.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_secret_")) headers.delete("authorization");
  else headers.set("authorization", `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  const response = await fetch(url, { ...init, headers, redirect: "error" });
  if (!response.ok) {
    if (response.status === 409) fail("SYNC_CONFLICT", "GitHub identity or repository is already connected", 409);
    if (response.status === 403) fail("FORBIDDEN", "GitHub integration database permission denied", 403);
    fail("GITHUB_DATABASE_ERROR", "GitHub integration storage request failed", 502);
  }
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}
var rpc = (context, name, body) => database(context, `rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
async function github(path, token, init = {}, allowMissing = false) {
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "user-agent": "Lattice-GitHub-App", ...init.body ? { "content-type": "application/json" } : {} }, redirect: "error" });
  if (allowMissing && response.status === 404) return { body: null, response };
  if (!response.ok) {
    if (response.status === 401) fail("GITHUB_REAUTH_REQUIRED", "Reconnect your GitHub account", 401);
    if (response.status === 409 || response.status === 422) fail("SYNC_CONFLICT", "GitHub file changed; pull before publishing again", 409);
    if (response.status === 403 || response.status === 404) fail("FORBIDDEN", "GitHub App or user lacks repository access", 403);
    fail("GITHUB_UPSTREAM_ERROR", "GitHub API request failed", 502);
  }
  return { body: await response.json(), response };
}
async function githubPages(path, token, field) {
  const result = [];
  for (let page = 1; page <= 100; page++) {
    const { body: value, response } = await github(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`, token);
    const entries = field ? object(value)[field] : value;
    if (!Array.isArray(entries)) fail("GITHUB_UPSTREAM_ERROR", "GitHub returned an invalid paginated response", 502);
    const pageRows = rows(entries);
    result.push(...pageRows);
    const hasNext = /rel="next"/.test(response.headers.get("link") ?? "");
    if (!hasNext && pageRows.length < 100) return result;
    if (!hasNext && field && typeof object(value).total_count === "number" && result.length >= Number(object(value).total_count)) return result;
  }
  return fail("GITHUB_RESULT_LIMIT", "Repository listing is too large to synchronize safely", 422);
}
function expiration(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail("GITHUB_EXPIRING_TOKENS_REQUIRED", "Enable expiring GitHub App user tokens before connecting", 503);
  return new Date(Date.now() + Number(value) * 1e3).toISOString();
}
async function tokenExchange(context, input) {
  const env = configuration(context);
  const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, ...input }), redirect: "error" });
  if (!response.ok) fail("GITHUB_REAUTH_REQUIRED", "GitHub authorization could not be exchanged", 401);
  const token = object(await response.json());
  if (token.error || typeof token.access_token !== "string" || typeof token.refresh_token !== "string") fail("GITHUB_REAUTH_REQUIRED", "GitHub authorization expired; connect again", 401);
  return token;
}
async function encryptedTokens(context, token) {
  const key = configuration(context).GITHUB_TOKEN_ENCRYPTION_KEY;
  const user = context.actor.userId;
  return { access_cipher: await encryptGitHubSecret(text(token.access_token, 5e3), key, `${user}:access`), refresh_cipher: await encryptGitHubSecret(text(token.refresh_token, 5e3), key, `${user}:refresh`), expires_at: expiration(token.expires_in), refresh_expires_at: expiration(token.refresh_token_expires_in), refresh_locked_until: null };
}
async function accessToken(context) {
  const user = context.actor.userId;
  const key = configuration(context).GITHUB_TOKEN_ENCRYPTION_KEY;
  let token = first(await database(context, "cloud_github_tokens", {}, { user_id: `eq.${user}`, select: "*" }));
  if (!token || !Number.isFinite(Date.parse(String(token.refresh_expires_at))) || Date.parse(String(token.refresh_expires_at)) <= Date.now() || !Number.isFinite(Date.parse(String(token.expires_at)))) fail("GITHUB_REAUTH_REQUIRED", "Connect your GitHub account again", 401);
  if (Date.parse(String(token.expires_at)) <= Date.now() + 6e4) {
    const claimed = first(await rpc(context, "cloud_github_claim_refresh", { p_user_id: user }));
    if (!claimed) fail("GITHUB_REFRESH_IN_PROGRESS", "GitHub authentication is refreshing; try again shortly", 409);
    try {
      const refresh = await decryptGitHubSecret(String(claimed.refresh_cipher), key, `${user}:refresh`);
      const renewed = await tokenExchange(context, { grant_type: "refresh_token", refresh_token: refresh });
      const encrypted = await encryptedTokens(context, renewed);
      await database(context, "cloud_github_tokens", { method: "PATCH", body: JSON.stringify(encrypted) }, { user_id: `eq.${user}` });
      token = { ...token, ...encrypted };
    } catch (error) {
      throw error;
    }
  }
  return decryptGitHubSecret(String(token.access_cipher), key, `${user}:access`);
}
var writable = (repository) => repository.permissions.push || repository.permissions.maintain || repository.permissions.admin;
async function installationRepositories(token, installationId) {
  return (await githubPages(`/user/installations/${installationId}/repositories`, token, "repositories")).map((repository) => {
    const permissions = object(repository.permissions);
    return { id: numericId(repository.id), installationId, owner: text(object(repository.owner).login, 100), name: text(repository.name, 100), fullName: text(repository.full_name, 250), private: repository.private === true, defaultBranch: text(repository.default_branch, 250), permissions: { push: permissions.push === true, maintain: permissions.maintain === true, admin: permissions.admin === true } };
  });
}
var repoPath = (repository) => `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
function serviceContext(env, userId = "") {
  return {
    env,
    actor: { userId, accessToken: "" },
    segments: [],
    url: new URL("https://internal.invalid"),
    db: async () => {
      throw new Error("Background jobs cannot impersonate a user database session");
    },
    json: (value, status = 200) => Response.json(value, { status }),
    error: (code, message, status) => Response.json({ error: { code, message } }, { status })
  };
}
async function webhookConnections(context, delivery) {
  const payload = object(delivery.payload);
  const repository = object(payload.repository);
  const installation = object(payload.installation);
  const organization = object(payload.organization);
  let match;
  if (typeof repository.id === "number") match = { repository_id: `eq.${numericId(repository.id)}` };
  else if (typeof installation.id === "number" && (delivery.event === "installation" || delivery.event === "installation_repositories")) match = { installation_id: `eq.${numericId(installation.id)}` };
  else if (typeof organization.login === "string" && ["membership", "team", "organization"].includes(String(delivery.event))) match = { owner: `eq.${text(organization.login, 100)}` };
  else return [];
  const result = [];
  for (let offset = 0; offset < 1e4; offset += 100) {
    const page = rows(await database(context, "cloud_github_connections", {}, { ...match, select: "*", order: "id", limit: "100", offset: String(offset) }));
    result.push(...page);
    if (page.length < 100) return result;
  }
  return fail("GITHUB_RESULT_LIMIT", "Too many matching GitHub repository connections", 422);
}
async function processGitHubWebhookDeliveries(env, deliveryId) {
  const context = serviceContext(env);
  const deliveries = rows(await rpc(context, "cloud_github_claim_webhooks", { p_delivery_id: deliveryId ?? null }));
  let processed = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    try {
      for (const connection of await webhookConnections(context, delivery)) {
        const actorContext = serviceContext(env, String(connection.connected_by));
        let ids = [];
        try {
          const token = await accessToken(actorContext);
          const repository = (await installationRepositories(token, Number(connection.installation_id))).find((repo) => repo.id === Number(connection.repository_id));
          if (repository && writable(repository)) {
            const collaborators = await githubPages(`${repoPath(repository)}/collaborators?affiliation=all`, token);
            ids = collaborators.filter((collaborator) => {
              const permission = object(collaborator.permissions);
              return permission.push === true || permission.maintain === true || permission.admin === true;
            }).map((collaborator) => numericId(collaborator.id));
          }
          await rpc(context, "cloud_github_sync_members", { p_connection_id: connection.id, p_actor_id: null, p_github_user_ids: ids });
        } catch (error) {
          if (error instanceof GitHubError && [401, 403].includes(error.status)) {
            await rpc(context, "cloud_github_sync_members", { p_connection_id: connection.id, p_actor_id: null, p_github_user_ids: [] });
          }
          throw error;
        }
      }
      await database(context, "cloud_github_webhook_deliveries", { method: "PATCH", body: JSON.stringify({ status: "complete", completed_at: (/* @__PURE__ */ new Date()).toISOString(), leased_until: null, last_error: null }) }, { delivery_id: `eq.${delivery.delivery_id}`, status: "eq.processing" });
      processed++;
    } catch (error) {
      const lastError = error instanceof GitHubError ? error.code : "GITHUB_WEBHOOK_RETRY_REQUIRED";
      const retrySeconds = Math.min(3600, 30 * 2 ** Math.min(Number(delivery.attempts ?? 1), 7));
      await database(context, "cloud_github_webhook_deliveries", { method: "PATCH", body: JSON.stringify({ status: "failed", last_error: lastError, leased_until: null, available_at: new Date(Date.now() + retrySeconds * 1e3).toISOString() }) }, { delivery_id: `eq.${delivery.delivery_id}`, status: "eq.processing" });
      failed++;
    }
  }
  return { processed, failed };
}

// workers/shared-library-api/src/github-jobs.ts
async function handleGitHubJobs(request, env) {
  if (request.method !== "POST") return Response.json({ error: { code: "METHOD_NOT_ALLOWED" } }, { status: 405 });
  if (!env.GITHUB_SYNC_JOB_SECRET || env.GITHUB_SYNC_JOB_SECRET.length < 32) return Response.json({ error: { code: "GITHUB_NOT_CONFIGURED" } }, { status: 503 });
  const candidate = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1] ?? "";
  const digest = async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [received, expected] = await Promise.all([digest(candidate), digest(env.GITHUB_SYNC_JOB_SECRET)]);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= received[index] ^ expected[index];
  if (difference !== 0) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  try {
    return Response.json(await processGitHubWebhookDeliveries(env));
  } catch {
    return Response.json({ error: { code: "GITHUB_JOB_RETRY_REQUIRED" } }, { status: 503 });
  }
}

export default { fetch(request) { return handleGitHubJobs(request, {SUPABASE_URL: Deno.env.get("SUPABASE_URL"),SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY"),SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),GITHUB_APP_CLIENT_ID: Deno.env.get("GITHUB_APP_CLIENT_ID"),GITHUB_APP_CLIENT_SECRET: Deno.env.get("GITHUB_APP_CLIENT_SECRET"),GITHUB_TOKEN_ENCRYPTION_KEY: Deno.env.get("GITHUB_TOKEN_ENCRYPTION_KEY"),GITHUB_OAUTH_REDIRECT_URI: Deno.env.get("GITHUB_OAUTH_REDIRECT_URI"),GITHUB_APP_SLUG: Deno.env.get("GITHUB_APP_SLUG"),GITHUB_OAUTH_ALLOWED_RETURN_ORIGINS: Deno.env.get("GITHUB_OAUTH_ALLOWED_RETURN_ORIGINS"),GITHUB_WEBHOOK_SECRET: Deno.env.get("GITHUB_WEBHOOK_SECRET"),GITHUB_SYNC_JOB_SECRET: Deno.env.get("GITHUB_SYNC_JOB_SECRET"),TEAM_AI_ENCRYPTION_KEY: Deno.env.get("TEAM_AI_ENCRYPTION_KEY")}); } };
