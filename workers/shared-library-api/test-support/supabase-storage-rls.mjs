/** Synthetic PostgreSQL fixture only. Never connects to a hosted Supabase project. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(resolve(".lattice-build/cloud-team-test-runtime/node_modules/@electric-sql/pglite/dist/index.js")).href;
const { PGlite } = await import(moduleUrl);
const db = new PGlite();
const owner = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
const org = randomUUID(), library = randomUUID(), otherLibrary = randomUUID();
const syntheticObject = Buffer.from("0123456789abcdef");
const bucket = "lattice-shared-library", hash = createHash("sha256").update(syntheticObject).digest("hex"), reserve = 20 * 1024 * 1024;
let checks = 0;
function check(actual, expected) { assert.deepEqual(actual, expected); checks++; }
async function actor(user, sql, parameters = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    return tx.query(sql, parameters);
  });
}
async function denied(user, sql, parameters = [], code = "42501") {
  await assert.rejects(actor(user, sql, parameters), error => error.code === code); checks++;
}
async function upload(lib = library, size = 16, ttl = "24 hours") {
  const id = randomUUID(), key = `libraries/${lib}/blobs/${randomUUID()}`;
  const descriptor = { libraryId: lib, key, uploadId: id, fileName: "fixture.txt", mimeType: "text/plain", sizeBytes: size, partSize: Math.max(size, 1), storageBackend: "supabase" };
  await actor(owner, "insert into public.cloud_upload_sessions(id,library_id,user_id,descriptor,expires_at) values($1,$2,$3,$4,now()+$5::interval)", [id, lib, owner, descriptor, ttl]);
  return { id, key, descriptor };
}
async function put(session, size = 16) {
  await actor(owner, "insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)", [bucket, session.key, { size, mimetype: "text/plain" }]);
}

try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub',auth.uid()) $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to authenticated;
    grant execute on all functions in schema auth to authenticated;`);
  const migrationNames = ["202608200001_shared_library_core.sql", "202608200002_shared_library_rls.sql", "202608300001_shared_library_security_hardening.sql", "202610080001_cloud_team_library.sql", "202610120001_cloud_member_display_names.sql", "202610130001_cloud_supabase_storage.sql", "202610130002_cloud_function_privileges.sql", "202610170001_cloud_large_objects.sql"];
  for (const name of migrationNames) await db.exec((await readFile(resolve("supabase/migrations", name), "utf8")).replace(/create extension if not exists "pgcrypto";/, ""));
  await db.exec("grant select,insert,update,delete on all tables in schema public,storage to authenticated; grant usage,select on all sequences in schema public to authenticated;");
  check((await db.query("select count(*)::int as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')")).rows[0].count, 0);
  check((await db.query("select count(*)::int as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prorettype='trigger'::regtype and has_function_privilege('authenticated',p.oid,'execute')")).rows[0].count, 0);
  await db.query("insert into auth.users values($1,'owner@fixture.test'),($2,'viewer@fixture.test'),($3,'outsider@fixture.test')", [owner, viewer, outsider]);
  await db.query("insert into public.organizations(id,name,slug,created_by) values($1,'Fixture','fixture',$2)", [org, owner]);
  await db.query("insert into public.libraries(id,organization_id,name,slug,created_by) values($1,$3,'One','one',$4),($2,$3,'Two','two',$4)", [library, otherLibrary, org, owner]);
  await db.query("insert into public.library_members(library_id,user_id,role) values($1,$2,'viewer')", [library, viewer]);
  check((await db.query("select public,file_size_limit from storage.buckets where id=$1", [bucket])).rows[0], { public: false, file_size_limit: reserve });
  const health = (await actor(owner, "select public.cloud_library_health($1) as health", [library])).rows[0].health;
  check(health.bucketMaxFileBytes, reserve);
  check(health.bucketPrivate, true);
  await denied(viewer, "select public.cloud_library_health($1)", [library]);
  await denied(outsider, "select public.cloud_library_health($1)", [library]);
  const large = await upload(library, reserve);
  check((await actor(owner, "select public.cloud_storage_can_insert($1,$2,$3) as allowed", [bucket, large.key, { size: reserve - 1 }])).rows[0].allowed, false);
  await assert.rejects(upload(library, reserve + 1), error => error.code === "22023"); checks++;
  await put(large, reserve);
  const largeBlob = (await actor(owner, "select public.cloud_complete_storage_upload($1,$2) as id", [large.id, hash])).rows[0].id;
  check((await db.query("select size_bytes from public.blobs where id=$1", [largeBlob])).rows[0].size_bytes, reserve);
  // Remove only synthetic fixture records as the fixture superuser before the
  // original quota scenarios; never expose this path as application cleanup.
  await db.query("delete from public.blobs where id=$1", [largeBlob]);
  await db.query("delete from storage.objects where name=$1", [large.key]);
  await denied(owner, "insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)", [bucket, `libraries/${library}/blobs/unplanned`, { size: 16 }]);
  const planned = await upload();
  check((await actor(owner, "select public.cloud_library_usage($1) as usage", [library])).rows[0].usage.reservedBytes, reserve);
  check((await actor(owner, "select public.cloud_storage_can_insert($1,$2,$3) as allowed", [bucket, planned.key, { contentLength: 16 }])).rows[0].allowed, true);
  await put(planned);
  check((await actor(owner, "select name from storage.objects")).rows.length, 1);
  check((await actor(viewer, "select name from storage.objects")).rows.length, 0);
  check((await actor(outsider, "select name from storage.objects")).rows.length, 0);
  await denied(viewer, "insert into public.cloud_upload_sessions(library_id,user_id,descriptor) values($1,$2,$3)", [library, viewer, { ...planned.descriptor, key: `libraries/${library}/blobs/${randomUUID()}` }]);
  await denied(owner, "update public.cloud_upload_sessions set state='aborted' where id=$1", [planned.id]);
  await denied(owner, "delete from public.cloud_upload_sessions where id=$1", [planned.id]);
  const completeSql = "select public.cloud_complete_storage_upload($1,$2) as id";
  const committed = (await actor(owner, completeSql, [planned.id, hash])).rows[0].id;
  check((await actor(owner, completeSql, [planned.id, hash])).rows[0].id, committed);
  check((await actor(viewer, "select name from storage.objects")).rows.length, 1);
  check((await actor(outsider, "select name from storage.objects")).rows.length, 0);
  check((await actor(owner, "update storage.objects set metadata='{}' where name=$1 returning id", [planned.key])).rows.length, 0);
  check((await actor(owner, "delete from storage.objects where name=$1 returning id", [planned.key])).rows.length, 0);
  await db.query("update public.library_members set status='suspended' where library_id=$1 and user_id=$2", [library, viewer]);
  check((await actor(viewer, "select name from storage.objects")).rows.length, 0);
  await denied(viewer, completeSql, [planned.id, hash]);
  const empty = await upload();
  await denied(owner, completeSql, [empty.id, hash]);
  check((await db.query("select state from public.cloud_upload_sessions where id=$1", [empty.id])).rows[0].state, "active");
  await actor(owner, "update public.cloud_upload_sessions set state='aborted' where id=$1", [empty.id]);
  const expired = await upload(library, 16, "500 milliseconds");
  await put(expired);
  await new Promise(resolve => setTimeout(resolve, 550));
  await denied(owner, completeSql, [expired.id, hash], "22023");
  check((await actor(owner, "select public.cloud_library_usage($1) as usage", [library])).rows[0].usage.reservedBytes, 16);
  check((await actor(owner, "delete from storage.objects where name=$1 returning id", [expired.key])).rows.length, 1);
  await actor(owner, "update public.cloud_upload_sessions set state='aborted' where id=$1", [expired.id]);
  check((await actor(owner, "select public.cloud_library_usage($1) as usage", [library])).rows[0].usage.reservedBytes, 0);
  // A declared 1-byte file still reserves the full bucket limit until bytes exist.
  await db.query("update public.cloud_storage_limits set max_storage_bytes=$1", [reserve * 2 + 16]);
  const first = await upload(library, 1), second = await upload(otherLibrary, 1);
  await assert.rejects(upload(library, 1), error => error.code === "P0001"); checks++;
  // Expiration alone never releases the reservation; only cleanup does.
  await denied(owner, "delete from public.cloud_upload_sessions where id=$1", [first.id]);
  await actor(owner, "update public.cloud_upload_sessions set state='aborted' where id=$1", [first.id]);
  await actor(owner, "update public.cloud_upload_sessions set state='aborted' where id=$1", [second.id]);
  await db.query("update public.cloud_storage_limits set max_storage_bytes=950000000");
  await db.query("update public.libraries set settings=$1 where id=$2", [{ maxStorageBytes: reserve + 16 }, otherLibrary]);
  const narrow = await upload(otherLibrary, 1);
  await assert.rejects(upload(otherLibrary, 1), error => error.code === "P0001"); checks++;
  await put(narrow, 1);
  const afterBytes = await upload(otherLibrary, 1); // 1 real byte + 20MiB reserved fits.
  await actor(owner, "update public.cloud_upload_sessions set state='aborted' where id=$1", [afterBytes.id]);
  // A viewer promoted to admin can clean another creator's abandoned object.
  await db.query("update public.library_members set status='active',role='admin' where library_id=$1 and user_id=$2", [library, viewer]);
  const abandoned = await upload();
  await put(abandoned);
  await db.query("update public.library_members set status='suspended' where library_id=$1 and user_id=$2", [library, owner]);
  check((await actor(owner, "delete from storage.objects where name=$1 returning id", [abandoned.key])).rows.length, 0);
  check((await actor(viewer, "delete from storage.objects where name=$1 returning id", [abandoned.key])).rows.length, 1);
  await actor(viewer, "update public.cloud_upload_sessions set state='aborted' where id=$1", [abandoned.id]);
  check((await db.query("select state from public.cloud_upload_sessions where id=$1", [abandoned.id])).rows[0].state, "aborted");
  // The existing R2 descriptor and blob registration path remains valid.
  const r2Key = `libraries/${otherLibrary}/blobs/${randomUUID()}`;
  const r2Descriptor = { libraryId: otherLibrary, key: r2Key, uploadId: "fixture-r2-multipart", fileName: "r2.txt", mimeType: "text/plain", sizeBytes: 8, storageBackend: "r2" };
  await actor(owner, "insert into public.cloud_upload_sessions(library_id,user_id,descriptor) values($1,$2,$3)", [otherLibrary, owner, r2Descriptor]);
  check((await actor(owner, "insert into public.blobs(library_id,storage_key,size_bytes,sha256,mime_type,uploaded_by) values($1,$2,8,$3,'text/plain',$4) returning storage_backend", [otherLibrary, r2Key, hash, owner])).rows[0].storage_backend, "r2");
  // Objects in another project bucket still consume the service storage budget.
  await db.query("insert into storage.buckets(id,name) values('other-bucket','other-bucket')");
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('other-bucket','external-fixture',$1)", [{ size: 950000000 }]);
  await assert.rejects(upload(otherLibrary, 1), error => error.code === "P0001"); checks++;
  // Separate database and object backups are required: a PostgreSQL snapshot
  // contains Storage metadata, never the actual Storage API object bytes.
  const backupDirectory = resolve(".lattice-build/cloud-restore-drill-20261017");
  await mkdir(resolve(backupDirectory, "objects"), { recursive: true });
  const databaseArchive = await db.dumpDataDir();
  await writeFile(resolve(backupDirectory, "database.tar.gz"), Buffer.from(await databaseArchive.arrayBuffer()));
  await writeFile(resolve(backupDirectory, "objects", `${hash}.bin`), syntheticObject);
  const manifest = { scope: "synthetic-only", objects: [{ key: planned.key, sha256: hash, sizeBytes: syntheticObject.byteLength }], productionRequests: 0 };
  await writeFile(resolve(backupDirectory, "manifest.json"), JSON.stringify(manifest, null, 2));
  const restored = new PGlite({ loadDataDir: new Blob([await readFile(resolve(backupDirectory, "database.tar.gz"))]) });
  try {
    check((await restored.query("select size_bytes,sha256 from public.blobs where id=$1", [committed])).rows[0], { size_bytes: 16, sha256: hash });
    const restoredBytes = await readFile(resolve(backupDirectory, "objects", `${hash}.bin`));
    check(createHash("sha256").update(restoredBytes).digest("hex"), hash);
    check(restoredBytes.byteLength, 16);
    const visible = async user => restored.transaction(async tx => {
      await tx.exec("set local role authenticated"); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      return (await tx.query("select name from storage.objects where name=$1", [planned.key])).rows.length;
    });
    check(await visible(viewer), 1); // the promoted admin remains authorized
    check(await visible(outsider), 0);
    console.log(JSON.stringify({ fixture: "synthetic-database-plus-physical-object-restore", status: "passed", restoredObjectBytes: restoredBytes.byteLength, restoredRls: true, output: backupDirectory, productionRequests: 0 }));
  } finally { await restored.close(); }
  console.log(JSON.stringify({ fixture: "synthetic-storage-schema-and-user-RLS", migrations: migrationNames.length, checks, status: "passed", productionRequests: 0 }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", checks, code: error.code, message: error.message, position: error.position, where: error.where }));
  process.exitCode = 1;
} finally { await db.close(); }
