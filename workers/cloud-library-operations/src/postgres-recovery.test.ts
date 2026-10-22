// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, cp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { nativePostgresAvailable, nativePostgresFixture } from '../test-support/native-postgres';

const runNode = promisify(execFile);
it('keeps snapshot capture CLI in preparation without reading any connection configuration', async () => {
  const result = await runNode(process.execPath, ['scripts/cloud-library-postgres-snapshot.mjs', 'unused-output', 'synthetic-source'], { env: { ...process.env, LATTICE_BACKUP_PG_PASSWORD: 'must-not-be-read-or-printed' } });
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'prepared', networkRequests: 0, credentialsRead: false, filesWritten: 0, productionRestoreVerified: false });
  expect(result.stdout).not.toContain('must-not-be-read-or-printed');
});
it('keeps restore CLI in preparation without inspecting files or target credentials', async () => {
  const result = await runNode(process.execPath, ['scripts/cloud-library-postgres-restore.mjs', 'absent-capture', 'synthetic-target'], { env: { ...process.env, LATTICE_RESTORE_PG_PASSWORD: 'must-not-be-read-or-printed' } });
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'prepared', databaseWrites: 0, credentialsRead: false, filesRead: 0 });
  expect(result.stdout).not.toContain('must-not-be-read-or-printed');
});

describe.skipIf(!nativePostgresAvailable)('real native PostgreSQL recovery acquisition', () => {
  let fixture: Awaited<ReturnType<typeof nativePostgresFixture>>;
  beforeAll(async () => {
    fixture = await nativePostgresFixture();
    await fixture.sql(`
      create schema auth; create schema storage; create schema supabase_migrations;
      create table auth.users(id uuid primary key,email text);
      create table storage.buckets(id text primary key,public boolean);
      create table supabase_migrations.schema_migrations(version text primary key);
      create table public.libraries(id uuid primary key,name text);
      create table public.blobs(id uuid primary key,library_id uuid references public.libraries(id),storage_key text,storage_backend text,size_bytes bigint,sha256 text,mime_type text);
      insert into auth.users values('11111111-1111-4111-8111-111111111111','synthetic@fixture.test');
      insert into storage.buckets values('lattice-shared-library',false);
      insert into supabase_migrations.schema_migrations values('202610170001');
      insert into public.libraries values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','snapshot-original');
      insert into public.blobs values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','libraries/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/blobs/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','supabase',4,repeat('a',64),'text/plain');
    `);
  }, 120000);
  afterAll(async () => { await fixture?.close(); });

  it('stops its own fresh cluster when bootstrap fails before a fixture can be returned', async () => {
    let startedPort = 0, refused = false;
    let unexpectedlyCreated: Awaited<ReturnType<typeof nativePostgresFixture>> | undefined;
    try {
      unexpectedlyCreated = await nativePostgresFixture({ afterStarted: async port => { startedPort = port; throw new Error('synthetic bootstrap failure'); } });
    } catch { refused = true; }
    finally { await unexpectedlyCreated?.close(); }
    expect(refused).toBe(true); expect(startedPort).toBeGreaterThan(0);
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(startedPort, '127.0.0.1', resolve); });
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('keeps the object inventory and every SQL dump on one exported snapshot despite concurrent writes', async () => {
    const { capturePostgresRecoverySnapshot, withPostgresRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-snapshot.mjs');
    const output = resolve(fixture.root, 'captured');
    const result = await withPostgresRecoverySnapshot({ connection: fixture.connection, binDirectory: fixture.binDirectory }, async snapshot => {
      await fixture.sql("update public.libraries set name='concurrent-later'; insert into public.libraries values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','later-library');");
      return capturePostgresRecoverySnapshot({ connection: fixture.connection, binDirectory: fixture.binDirectory, output, snapshot });
    });
    expect(result).toMatchObject({ status: 'captured', libraries: 1, objects: 1, databaseSnapshotVerified: true, productionRestoreVerified: false });
    const inventory = JSON.parse(await readFile(resolve(output, 'inventory.json'), 'utf8'));
    expect(inventory.libraryIds).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
    const data = await readFile(resolve(output, 'data.sql'), 'utf8');
    expect(data).toContain('snapshot-original'); expect(data).not.toContain('concurrent-later'); expect(data).not.toContain('later-library');
    const capture = JSON.parse(await readFile(resolve(output, 'database-capture.json'), 'utf8'));
    expect(capture).toMatchObject({ complete: true, projectRef: 'synthetic-source', databaseSnapshotVerified: true });
    expect(capture.artifacts.map((artifact: { kind: string }) => artifact.kind).sort()).toEqual(['data','history-data','history-schema','roles','schema']);
    expect(await fixture.sql("select name from public.libraries where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")).toBe('concurrent-later');
    expect(JSON.stringify(result)).not.toContain(fixture.connection.host);
  });

  it('does not leave a completed capture for missing project tables or an existing output', async () => {
    const { capturePostgresRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-snapshot.mjs');
    const output = resolve(fixture.root, 'interrupted');
    await expect(capturePostgresRecoverySnapshot({ connection: { ...fixture.connection, database: 'lattice_target' }, binDirectory: fixture.binDirectory, output })).rejects.toThrow();
    await expect(access(resolve(output, 'database-capture.json'))).rejects.toThrow();
    await expect(capturePostgresRecoverySnapshot({ connection: fixture.connection, binDirectory: fixture.binDirectory, output: resolve(fixture.root, 'captured') })).rejects.toThrow(/exist/i);
  });

  it('restores the captured snapshot only into a distinct empty database and leaves concurrent source data intact', async () => {
    const { restorePostgresRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-restore.mjs');
    const options = { captureRoot: resolve(fixture.root, 'captured'), connection: { ...fixture.connection, database: 'lattice_target', projectRef: 'synthetic-target' }, binDirectory: fixture.binDirectory };
    const restored = await restorePostgresRecoverySnapshot(options);
    expect(restored).toMatchObject({ status: 'restored-isolated-postgres', databaseRestored: true, productionRestoreVerified: false, hostedPlatformCompatibilityVerified: false });
    expect(await fixture.sql('select name from public.libraries order by id', 'lattice_target')).toBe('snapshot-original');
    expect(await fixture.sql('select email from auth.users', 'lattice_target')).toBe('synthetic@fixture.test');
    expect(await fixture.sql('select version from supabase_migrations.schema_migrations', 'lattice_target')).toBe('202610170001');
    expect(await fixture.sql("select name from public.libraries where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")).toBe('concurrent-later');
    await expect(restorePostgresRecoverySnapshot(options)).rejects.toThrow(/empty|nonempty/i);
  });

  it('refuses a source identity or same project target before executing recovery SQL', async () => {
    const { restorePostgresRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-restore.mjs');
    await expect(restorePostgresRecoverySnapshot({ captureRoot: resolve(fixture.root, 'captured'), connection: fixture.connection, binDirectory: fixture.binDirectory })).rejects.toThrow(/source|identity|project/i);
    await expect(restorePostgresRecoverySnapshot({ captureRoot: resolve(fixture.root, 'captured'), connection: { ...fixture.connection, projectRef: 'synthetic-disguised' }, binDirectory: fixture.binDirectory })).rejects.toThrow(/source|identity/i);
  });

  it('rolls back all target schemas and data when a later restore statement fails', async () => {
    const { restorePostgresRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-restore.mjs');
    const captureRoot = resolve(fixture.root, 'bad-sql');
    await cp(resolve(fixture.root, 'captured'), captureRoot, { recursive: true, errorOnExist: true });
    const sql = (await readFile(resolve(captureRoot, 'data.sql'), 'utf8')) + '\nSELECT * FROM missing_restore_failure_table;\n';
    await writeFile(resolve(captureRoot, 'data.sql'), sql);
    const capture = JSON.parse(await readFile(resolve(captureRoot, 'database-capture.json'), 'utf8'));
    const artifact = capture.artifacts.find((row: { kind: string }) => row.kind === 'data');
    artifact.sizeBytes = Buffer.byteLength(sql); artifact.sha256 = createHash('sha256').update(sql).digest('hex');
    await writeFile(resolve(captureRoot, 'database-capture.json'), JSON.stringify(capture));
    await fixture.sql('create database lattice_rollback;', 'postgres');
    await expect(restorePostgresRecoverySnapshot({ captureRoot, connection: { ...fixture.connection, database: 'lattice_rollback', projectRef: 'synthetic-rollback' }, binDirectory: fixture.binDirectory })).rejects.toThrow();
    expect(await fixture.sql("select count(*) from pg_tables where schemaname in ('public','auth','storage','supabase_migrations')", 'lattice_rollback')).toBe('0');
    expect(await fixture.sql("select count(*) from pg_namespace where nspname='public'", 'lattice_rollback')).toBe('1');
  });

  it('refuses a replaced object inventory before restoring any target data', async () => {
    const { restorePostgresRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-restore.mjs');
    const captureRoot = resolve(fixture.root, 'changed-inventory');
    await cp(resolve(fixture.root, 'captured'), captureRoot, { recursive: true, errorOnExist: true });
    const inventory = JSON.parse(await readFile(resolve(captureRoot, 'inventory.json'), 'utf8'));
    inventory.objects = [];
    await writeFile(resolve(captureRoot, 'inventory.json'), JSON.stringify(inventory));
    await expect(restorePostgresRecoverySnapshot({ captureRoot, connection: { ...fixture.connection, database: 'lattice_rollback', projectRef: 'synthetic-integrity' }, binDirectory: fixture.binDirectory })).rejects.toThrow(/inventory|integrity/i);
    expect(await fixture.sql("select count(*) from pg_tables where schemaname='public'", 'lattice_rollback')).toBe('0');
  });

  it('rolls back when restored object metadata differs from the bound inventory even if all SQL files execute', async () => {
    const { restorePostgresRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-restore.mjs');
    const captureRoot = resolve(fixture.root, 'inconsistent-sql');
    await cp(resolve(fixture.root, 'captured'), captureRoot, { recursive: true, errorOnExist: true });
    const sql = (await readFile(resolve(captureRoot, 'data.sql'), 'utf8')) + '\nDELETE FROM public.blobs;\n';
    await writeFile(resolve(captureRoot, 'data.sql'), sql);
    const capture = JSON.parse(await readFile(resolve(captureRoot, 'database-capture.json'), 'utf8'));
    const artifact = capture.artifacts.find((row: { kind: string }) => row.kind === 'data');
    artifact.sizeBytes = Buffer.byteLength(sql); artifact.sha256 = createHash('sha256').update(sql).digest('hex');
    await writeFile(resolve(captureRoot, 'database-capture.json'), JSON.stringify(capture));
    await fixture.sql('create database lattice_inventory_rollback;', 'postgres');
    await expect(restorePostgresRecoverySnapshot({ captureRoot, connection: { ...fixture.connection, database: 'lattice_inventory_rollback', projectRef: 'synthetic-inventory-rollback' }, binDirectory: fixture.binDirectory })).rejects.toThrow();
    expect(await fixture.sql("select count(*) from pg_tables where schemaname in ('public','auth','storage','supabase_migrations')", 'lattice_inventory_rollback')).toBe('0');
  });

  it('fails closed instead of capturing an RLS-filtered empty inventory', async () => {
    const { capturePostgresRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-snapshot.mjs');
    await fixture.sql(`create role lattice_limited login; grant connect on database lattice_source to lattice_limited;
      grant usage on schema public to lattice_limited; grant select on public.libraries,public.blobs to lattice_limited;
      grant execute on function pg_control_system() to lattice_limited; alter table public.libraries enable row level security;`);
    const output = resolve(fixture.root, 'filtered');
    await expect(capturePostgresRecoverySnapshot({ connection: { ...fixture.connection, user: 'lattice_limited' }, binDirectory: fixture.binDirectory, output })).rejects.toThrow();
    await expect(access(resolve(output, 'database-capture.json'))).rejects.toThrow();
  });

  it('restores the actual Lattice migration schema, history, annotations, child links, nicknames and member RLS', async () => {
    const { capturePostgresRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-snapshot.mjs');
    const { restorePostgresRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-restore.mjs');
    await fixture.sql('create database lattice_complete_source;', 'postgres'); await fixture.sql('create database lattice_complete_target;', 'postgres');
    const database = 'lattice_complete_source';
    await fixture.sql(`create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub',auth.uid()) $$;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated; grant execute on all functions in schema auth to authenticated;
      create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key);
    `, database);
    const migrations = ['202608200001_shared_library_core.sql', '202608200002_shared_library_rls.sql', '202608300001_shared_library_security_hardening.sql', '202610080001_cloud_team_library.sql', '202610120001_cloud_member_display_names.sql', '202610130001_cloud_supabase_storage.sql', '202610130002_cloud_function_privileges.sql', '202610170001_cloud_large_objects.sql'];
    for (const name of migrations) {
      await fixture.file(resolve('supabase/migrations', name), database);
      await fixture.sql(`insert into supabase_migrations.schema_migrations values('${name.split('_')[0]}');`, database);
    }
    const owner = '11111111-1111-4111-8111-111111111111', viewer = '22222222-2222-4222-8222-222222222222', outsider = '33333333-3333-4333-8333-333333333333';
    const org = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', library = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const paper = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', child = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
    const version = 'ffffffff-ffff-4fff-8fff-ffffffffffff', historical = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    const blob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', oldBlob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
    await fixture.sql(`grant select,insert,update,delete on all tables in schema public,storage to authenticated;
      grant usage,select on all sequences in schema public to authenticated;
      set session_replication_role=replica;
      insert into auth.users values('${owner}','owner@synthetic.test'),('${viewer}','viewer@synthetic.test'),('${outsider}','outsider@synthetic.test');
      insert into public.organizations(id,name,slug,created_by) values('${org}','Recovery synthetic','recovery','${owner}');
      insert into public.libraries(id,organization_id,name,slug,created_by) values('${library}','${org}','Research','research','${owner}');
      insert into public.library_members(library_id,user_id,role,display_name) values('${library}','${owner}','owner','原作者'),('${library}','${viewer}','viewer','协作者');
      insert into public.blobs(id,library_id,storage_key,size_bytes,sha256,storage_backend) values('${blob}','${library}','libraries/${library}/blobs/${blob}',20971520,repeat('a',64),'supabase'),('${oldBlob}','${library}','libraries/${library}/blobs/${oldBlob}',4,repeat('b',64),'supabase');
      insert into public.items(id,library_id,kind,title,canonical_name,created_by,current_version_id,metadata) values('${paper}','${library}','pdf','Paper','paper.pdf','${owner}','${version}','{}'),('${child}','${library}','markdown','Child','research-note.md','${owner}',null,'{"parentItemId":"${paper}"}');
      insert into public.item_versions(id,item_id,version_number,blob_id,content_hash,created_by) values('${version}','${paper}',2,'${blob}',repeat('a',64),'${owner}'),('${historical}','${paper}',1,'${oldBlob}',repeat('b',64),'${owner}');
      insert into public.item_children(parent_item_id,child_item_id,relative_path,kind,sort_key) values('${paper}','${child}','research-note.md','markdown','research-note.md');
      insert into public.annotations(item_id,version_id,author_id,kind,target,quote,body) values('${paper}','${version}','${owner}','highlight','{"page":3}','{"text":"Synthetic original evidence"}','{"authorDisplayName":"原作者","text":"恢复后的批注"}');
      set session_replication_role=origin;
    `, database);
    const captureRoot = resolve(fixture.root, 'complete-capture');
    expect(await capturePostgresRecoverySnapshot({ connection: { ...fixture.connection, database, projectRef: 'synthetic-complete-source' }, binDirectory: fixture.binDirectory, output: captureRoot })).toMatchObject({ libraries: 1, objects: 2 });
    expect(await restorePostgresRecoverySnapshot({ captureRoot, connection: { ...fixture.connection, database: 'lattice_complete_target', projectRef: 'synthetic-complete-target' }, binDirectory: fixture.binDirectory })).toMatchObject({ databaseRestored: true, physicalStorageRestored: false });
    const target = 'lattice_complete_target';
    const asMember = (user: string, query: string) => fixture.sql(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}'; ${query}; rollback;`, target);
    expect(await asMember(viewer, 'select count(*) from public.items')).toBe('2');
    expect(await asMember(viewer, "select body->>'text' from public.annotations")).toBe('恢复后的批注');
    expect(await asMember(viewer, "select body->>'authorDisplayName' from public.annotations")).toBe('原作者');
    expect(await asMember(viewer, "select display_name from public.library_members where user_id='" + viewer + "'")).toBe('协作者');
    expect(await asMember(viewer, 'select count(*) from public.item_versions')).toBe('2');
    expect(await asMember(viewer, 'select count(*) from public.item_children')).toBe('1');
    expect(await asMember(outsider, 'select count(*) from public.items')).toBe('0');
    expect(await fixture.sql('select count(*) from supabase_migrations.schema_migrations', target)).toBe('8');
    expect(await fixture.sql("select public::text||':'||file_size_limit::text from storage.buckets where id='lattice-shared-library'", target)).toBe('false:20971520');
    await fixture.sql(`update public.library_members set status='suspended' where user_id='${viewer}';`, target);
    expect(await asMember(viewer, 'select count(*) from public.items')).toBe('0');
    expect(await fixture.sql(`select status from public.library_members where user_id='${viewer}';`, database)).toBe('active');
  }, 120000);
});
