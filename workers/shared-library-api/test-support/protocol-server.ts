/** Isolated real HTTP + real embedded PostgreSQL/RLS. Auth issuer and R2 binding are explicit test providers. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHmac, randomUUID } from "node:crypto";
import worker, { type SharedLibraryWorkerEnv } from "../src/index";

type RecordValue = Record<string, unknown>;
interface Database {
  exec(sql: string): Promise<unknown>;
  query<T = RecordValue>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(callback: (db: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const PROFILE_A = "11111111-1111-4111-8111-111111111111";
export const PROFILE_B = "22222222-2222-4222-8222-222222222222";
export const TEST_PASSWORD = "generated-fixture-password";
const accounts = new Map([["a@cloud.test", PROFILE_A], ["b@cloud.test", PROFILE_B]]);
const roles = ["viewer", "commenter", "editor", "admin", "owner"];

async function requestOf(incoming: IncomingMessage, origin: string) {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  return new Request(new URL(incoming.url ?? "/", origin), { method: incoming.method, headers: incoming.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
}
async function send(response: ServerResponse, result: Response) {
  response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
  response.end(Buffer.from(await result.arrayBuffer()));
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,apikey,content-type", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" } }); }

export async function createProtocolServer(options: { authPort?: number; apiPort?: number; allowedOrigins?: string[]; storageBackend?: "r2" | "supabase" } = {}) {
  const diagnostics: Array<{ route: string; code?: string; message?: string }> = [];
  let failBlobRegistration = false;
  const modulePath = pathToFileURL(resolve(".lattice-build/cloud-team-test-runtime/node_modules/@electric-sql/pglite/dist/index.js")).href;
  const { PGlite } = await import(/* @vite-ignore */ modulePath) as { PGlite: new () => Database };
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub',auth.uid()) $$;
    grant usage on schema auth,public to authenticated; grant execute on all functions in schema auth to authenticated;
    insert into auth.users values('${PROFILE_A}','a@cloud.test'),('${PROFILE_B}','b@cloud.test');`);
  if (options.storageBackend === "supabase") await db.exec(`create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;`);
  const migrations = ["202608200001_shared_library_core.sql", "202608200002_shared_library_rls.sql", "202608300001_shared_library_security_hardening.sql", "202610080001_cloud_team_library.sql", "202610120001_cloud_member_display_names.sql"];
  if (options.storageBackend === "supabase") migrations.push("202610130001_cloud_supabase_storage.sql", "202610130002_cloud_function_privileges.sql", "202610170001_cloud_large_objects.sql");
  for (const migration of migrations) {
    const sql = await readFile(resolve("supabase/migrations", migration), "utf8");
    // PG's built-in gen_random_uuid is used. PGlite does not bundle the unused pgcrypto extension.
    await db.exec(sql.replace(/create extension if not exists "pgcrypto";/, ""));
  }
  await db.exec("grant select,insert,update,delete on all tables in schema public to authenticated; grant usage,select on all sequences in schema public to authenticated;");
  if (options.storageBackend === "supabase") await db.exec("grant select,insert,update,delete on all tables in schema storage to authenticated");
  const tokens = new Map<string, string>();
  const refresh = new Map<string, string>();
  const signingKey = randomUUID();
  function session(userId: string) {
    const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, nonce: randomUUID() })).toString("base64url");
    const token = `${head}.${payload}.${createHmac("sha256", signingKey).update(`${head}.${payload}`).digest("base64url")}`;
    const refreshToken = randomUUID(); tokens.set(token, userId); refresh.set(refreshToken, userId);
    return { access_token: token, refresh_token: refreshToken, expires_in: 3600, user: { id: userId } };
  }
  async function databaseRequest(request: Request) {
    const url = new URL(request.url); const route = url.pathname.replace("/rest/v1/", "");
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    const userId = token ? tokens.get(token) : undefined;
    if (!userId) return json({ code: "42501", message: "invalid JWT" }, 401);
    if (route === "blobs" && request.method === "POST" && failBlobRegistration) { failBlobRegistration = false; return json({ code: "fixture_transient_failure", message: "injected blob registration failure" }, 503); }
    try {
      return await db.transaction(async transaction => {
        await transaction.exec("set local role authenticated");
        await transaction.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
        if (route.startsWith("rpc/")) {
          const name = route.slice(4); const input = await request.json() as RecordValue;
          if (!/^cloud_[a-z_]+$/.test(name)) return json({ code: "42501" }, 403);
          const keys = Object.keys(input);
          const result = await transaction.query(`select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")})`, Object.values(input).map(v => v && typeof v === "object" ? JSON.stringify(v) : v));
          if (name === "cloud_accept_invitation") return json(Object.values(result.rows[0])[0]);
          if (["cloud_library_usage", "cloud_library_health", "cloud_complete_storage_upload"].includes(name)) return json(result.rows[0][name]);
          return json(result.rows[0] ?? null);
        }
        if (!/^[a-z_]+$/.test(route)) return json({ code: "42501" }, 403);
        const params: unknown[] = [];
        const conditions: string[] = [];
        const parameter = (value: unknown) => { params.push(value); return `$${params.length}`; };
        for (const [key, value] of url.searchParams.entries()) {
          if (["select", "order", "limit", "or"].includes(key)) continue;
          if (!/^[a-z_][a-z0-9_]*$/.test(key)) throw new Error("invalid query column");
          const operators: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<" };
          const [op, ...rest] = value.split(".");
          if (!operators[op]) throw new Error("unsupported test query operator");
          conditions.push(`${key} ${operators[op]} ${parameter(rest.join("."))}`);
        }
        if (url.searchParams.has("or")) {
          const search = url.searchParams.get("or")!.match(/title\.ilike\.\*(.*?)\*/)?.[1] ?? "";
          conditions.push(`(title ilike ${parameter(`%${search}%`)} or body ilike ${parameter(`%${search}%`)})`);
        }
        const where = conditions.length ? ` where ${conditions.join(" and ")}` : "";
        if (request.method === "GET") {
          const select = url.searchParams.get("select") ?? "*";
          if (!/^[a-z0-9_,*]+$/.test(select)) throw new Error("invalid select");
          const order = url.searchParams.get("order")?.split(",").map(part => { const [column, direction] = part.split("."); if (!/^[a-z_]+$/.test(column) || !["asc", "desc"].includes(direction)) throw new Error("invalid order"); return `${column} ${direction}`; }).join(",");
          const limit = Number(url.searchParams.get("limit") ?? 10000);
          const result = await transaction.query(`select ${select} from public.${route}${where}${order ? ` order by ${order}` : ""} limit ${Math.min(limit, 10000)}`, params);
          return json(result.rows);
        }
        if (request.method === "DELETE") return json((await transaction.query(`delete from public.${route}${where} returning *`, params)).rows);
        const input = await request.json() as RecordValue | RecordValue[];
        const inputs = Array.isArray(input) ? input : [input]; const all: RecordValue[] = [];
        for (const row of inputs) {
          const columns = Object.keys(row);
          if (columns.some(k => !/^[a-z_][a-z0-9_]*$/.test(k))) throw new Error("invalid column");
          const values = Object.values(row).map(v => v && typeof v === "object" ? JSON.stringify(v) : v);
          if (request.method === "PATCH") {
            const expressions = columns.map((column, i) => `${column}=$${params.length + i + 1}`);
            all.push(...(await transaction.query(`update public.${route} set ${expressions.join(",")}${where} returning *`, [...params, ...values])).rows);
          } else {
            const ignore = request.headers.get("prefer")?.includes("ignore-duplicates") ? " on conflict do nothing" : "";
            all.push(...(await transaction.query(`insert into public.${route}(${columns.join(",")}) values(${values.map((_, i) => `$${i + 1}`).join(",")})${ignore} returning *`, values)).rows);
          }
        }
        return json(all, request.method === "POST" ? 201 : 200);
      });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      diagnostics.push({ route, code: e.code, message: e.message });
      return json({ code: e.code, message: e.message }, e.code === "40001" || e.code === "23505" ? 409 : e.code === "42501" ? 403 : 400);
    }
  }
  async function storageRequest(request: Request) {
    const userId = tokens.get(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
    if (!userId) return json({ error: "invalid JWT" }, 401);
    const path = new URL(request.url).pathname;
    const key = decodeURIComponent(path.replace(/^\/storage\/v1\/object\/(?:authenticated\/)?lattice-shared-library\/?/, ""));
    try {
      return await db.transaction(async tx => {
        await tx.exec("set local role authenticated");
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
        if (request.method === "POST") {
          partCalls++;
          const data = await request.arrayBuffer();
          if (objects.has(key)) return json({ error: "Duplicate", statusCode: "409" }, 400);
          await tx.query("insert into storage.objects(bucket_id,name,metadata) values('lattice-shared-library',$1,$2)", [key, JSON.stringify({ size: data.byteLength, mimetype: request.headers.get("content-type") })]);
          objects.set(key, data);
          if (losePartResponse) { losePartResponse = false; return json({ error: "synthetic lost response after persistence" }, 503); }
          return json({ Key: key }, 200);
        }
        if (request.method === "GET") {
          const row = (await tx.query("select name from storage.objects where bucket_id='lattice-shared-library' and name=$1", [key])).rows[0];
          return row && objects.has(key) ? new Response(objects.get(key)!, { headers: { "content-type": "application/pdf" } }) : json({ error: "not found" }, 404);
        }
        if (request.method === "DELETE") {
          const input = await request.json() as { prefixes: string[] };
          for (const prefix of input.prefixes) {
            const deleted = await tx.query("delete from storage.objects where bucket_id='lattice-shared-library' and name=$1 returning name", [prefix]);
            if (deleted.rows.length) objects.delete(prefix);
          }
          return json([]);
        }
        return json({ error: "unsupported fixture method" }, 405);
      });
    } catch (error) { return json({ error: String(error) }, 403); }
  }
  const authServer = createServer(async (incoming, response) => {
    try {
      const request = await requestOf(incoming, authUrl);
      if (request.method === "OPTIONS") { await send(response, json(null)); return; }
      const url = new URL(request.url);
      if (url.pathname.startsWith("/rest/v1/")) { await send(response, await databaseRequest(request)); return; }
      if (options.storageBackend === "supabase" && url.pathname.startsWith("/storage/v1/")) { await send(response, await storageRequest(request)); return; }
      if (url.pathname === "/auth/v1/token") {
        const input = await request.json() as { email?: string; password?: string; refresh_token?: string };
        if (url.searchParams.get("grant_type") === "refresh_token") {
          const userId = refresh.get(input.refresh_token ?? ""); refresh.delete(input.refresh_token ?? "");
          await send(response, userId ? json(session(userId)) : json({ error: "invalid refresh" }, 400)); return;
        }
        const userId = accounts.get(input.email ?? "");
        await send(response, userId && input.password === TEST_PASSWORD ? json(session(userId)) : json({ error: "fixture sign in rejected" }, 400)); return;
      }
      if (url.pathname === "/auth/v1/logout") {
        const userId = tokens.get(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
        for (const [key, id] of refresh) if (id === userId) refresh.delete(key);
        await send(response, new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } })); return;
      }
      await send(response, json({ error: "not found" }, 404));
    } catch (e) { await send(response, json({ error: String(e) }, 500)); }
  });
  let authUrl = "";
  await new Promise<void>(resolveReady => authServer.listen(options.authPort ?? 0, "127.0.0.1", resolveReady));
  authUrl = `http://127.0.0.1:${(authServer.address() as { port: number }).port}`;
  const objects = new Map<string, ArrayBuffer>(); const multipart = new Map<string, { key: string; parts: Map<number, ArrayBuffer> }>();
  let failPart = false; let failPartNumber: number | undefined; let partCalls = 0; let losePartResponse = false;
  const bucket = {
    async createMultipartUpload(key: string) { const uploadId = randomUUID(); multipart.set(uploadId, { key, parts: new Map() }); return bucket.resumeMultipartUpload(key, uploadId); },
    resumeMultipartUpload(key: string, uploadId: string) {
      return { key, uploadId,
        async uploadPart(partNumber: number, data: ArrayBuffer) { partCalls++; if (failPart || failPartNumber === partNumber) { failPart = false; failPartNumber = undefined; throw new Error("injected transient R2 failure"); } const entry = multipart.get(uploadId); if (!entry || entry.key !== key) throw new Error("unknown upload"); entry.parts.set(partNumber, data.slice(0)); return { etag: `etag-${partNumber}` }; },
        async complete(parts: Array<{ partNumber: number; etag: string }>) { const entry = multipart.get(uploadId); if (!entry || entry.key !== key || objects.has(key)) throw new Error("unknown or already-completed upload"); const data = parts.map(p => entry.parts.get(p.partNumber)!); const result = new Uint8Array(data.reduce((sum, p) => sum + p.byteLength, 0)); let offset = 0; for (const p of data) { result.set(new Uint8Array(p), offset); offset += p.byteLength; } objects.set(key, result.buffer); },
        async abort() { multipart.delete(uploadId); },
      };
    },
    async get(key: string) { const data = objects.get(key); return data ? { body: new Response(data).body, httpMetadata: { contentLength: data.byteLength } } : null; },
  };
  const env: SharedLibraryWorkerEnv = { SUPABASE_URL: authUrl, SUPABASE_ANON_KEY: "sb_publishable_fixture", ALLOWED_ORIGINS: (options.allowedOrigins ?? ["http://127.0.0.1:3538"]).join(","), LIBRARY_BLOBS: bucket, BLOB_BACKEND: options.storageBackend ?? "r2" };
  let apiUrl = "";
  const apiServer = createServer(async (incoming, response) => {
    try { await send(response, await worker.fetch(await requestOf(incoming, apiUrl), env)); } catch (error) { await send(response, json({ error: String(error) }, 500)); }
  });
  await new Promise<void>(resolveReady => apiServer.listen(options.apiPort ?? 0, "127.0.0.1", resolveReady));
  apiUrl = `http://127.0.0.1:${(apiServer.address() as { port: number }).port}`;
  return { apiUrl, authUrl, db, roles, diagnostics, failNextBlobRegistration: () => { failBlobRegistration = true; }, partCalls: () => partCalls, failNextPart: (partNumber?: number) => { if (partNumber) failPartNumber = partNumber; else failPart = true; },
    loseNextPartResponse: () => { losePartResponse = true; },
    async close() { await Promise.all([new Promise<void>((res, rej) => apiServer.close(e => e ? rej(e) : res())), new Promise<void>((res, rej) => authServer.close(e => e ? rej(e) : res()))]); await db.close(); },
  };
}
