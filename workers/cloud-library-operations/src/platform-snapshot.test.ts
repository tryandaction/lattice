// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nativePostgresAvailable, nativePostgresFixture } from '../test-support/native-postgres';

const runNode = promisify(execFile);
it('prepares platform capture without reading files or connection configuration', async () => {
  const result = await runNode(process.execPath, ['scripts/cloud-library-platform-snapshot.mjs', 'absent-new-point', 'synthetic-source'], { env: { ...process.env, LATTICE_BACKUP_PG_PASSWORD: 'must-not-be-read-or-printed' } });
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'prepared', filesRead: 0, credentialsRead: false, networkRequests: 0, filesWritten: 0 });
  expect(result.stdout).not.toContain('must-not-be-read-or-printed');
});

describe.skipIf(!nativePostgresAvailable)('native platform-compatible data capture', () => {
  let f: Awaited<ReturnType<typeof nativePostgresFixture>>;
  beforeAll(async () => {
    f = await nativePostgresFixture();
    await f.sql(`create schema auth; create schema storage; create schema supabase_migrations;
      create table auth.users(id uuid primary key,email text,encrypted_password text);
      create table auth.identities(id bigint generated always as identity primary key,user_id uuid references auth.users(id),identity_data jsonb);
      create table auth.schema_migrations(version text primary key);
      insert into auth.schema_migrations values('platform-owned-migration');
      create table storage.buckets(id text primary key,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid primary key,bucket_id text,name text);
      insert into storage.buckets values('lattice-shared-library',false,20971520);
      insert into storage.objects values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','lattice-shared-library','metadata-is-not-bytes');
      create table supabase_migrations.schema_migrations(version text primary key,name text);
      insert into supabase_migrations.schema_migrations values('202610170001','cloud_large_objects');
      create table public.libraries(id uuid primary key,name text);
      create table public.blobs(id uuid primary key,library_id uuid references public.libraries(id),storage_key text,storage_backend text,size_bytes bigint,sha256 text,mime_type text);
      insert into public.libraries values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','原始库');
      insert into public.blobs values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','libraries/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/blobs/bbbbbbbbbbbb','supabase',4,repeat('a',64),'application/pdf');
      insert into auth.users values('11111111-1111-4111-8111-111111111111','synthetic@fixture.test','synthetic-password-hash');
      insert into auth.identities(user_id,identity_data) values('11111111-1111-4111-8111-111111111111','{"nickname":"合成作者"}');`);
  }, 180000);
  afterAll(async () => { await f?.close(); });

  it('captures real custom table data and catalog on one snapshot, excluding platform migrations and Storage rows', async () => {
    const { capturePostgresPlatformRecoverySnapshot, withPostgresRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-snapshot.mjs');
    const output = resolve(f.root, 'platform-capture');
    const result = await withPostgresRecoverySnapshot({ connection: f.connection, binDirectory: f.binDirectory }, async snapshot => {
      await f.sql("update public.libraries set name='并发修改'; insert into auth.users values('22222222-2222-4222-8222-222222222222','later@fixture.test','later');");
      return capturePostgresPlatformRecoverySnapshot({ connection: f.connection, binDirectory: f.binDirectory, output, snapshot });
    });
    expect(result).toMatchObject({ status: 'captured-platform-data', databaseSnapshotVerified: true, physicalStorageRestored: false, productionRestoreVerified: false });
    expect(JSON.stringify(result)).not.toMatch(/synthetic-password-hash|synthetic@fixture/);
    const capture = JSON.parse(await readFile(resolve(output, 'platform-capture.json'), 'utf8'));
    expect(capture).toMatchObject({ complete: true, scope: 'lattice-platform-data-snapshot', authenticationSecretsIncluded: true, platformEncryptionRootKeyIncluded: false, hostedPlatformCompatibilityVerified: false });
    for (const artifact of capture.artifacts) {
      const bytes = await readFile(resolve(output, artifact.path));
      expect(bytes.length).toBe(artifact.sizeBytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
    }
    const catalog = JSON.parse(await readFile(resolve(output, 'catalog.json'), 'utf8'));
    expect(catalog.sequenceConsistency).toBe('unverified-nontransactional');
    expect(capture.sequenceConsistency).toBe('unverified-nontransactional');
    expect(result).toMatchObject({ sequenceConsistency: 'unverified-nontransactional' });
    expect(catalog.relations).toEqual(expect.arrayContaining([expect.objectContaining({ schema: 'auth', name: 'users', rows: 1 }), expect.objectContaining({ schema: 'public', name: 'libraries', rows: 1 })]));
    expect(catalog.relations.some((row: {schema:string; name:string}) => row.schema === 'storage' || row.name === 'schema_migrations')).toBe(false);
    const dump = await runNode(resolve(f.binDirectory, 'pg_restore' + (process.platform === 'win32' ? '.exe' : '')), ['--data-only','--no-owner','--no-privileges','--file=-',resolve(output, 'platform-data.dump')], { windowsHide: true, maxBuffer: 1024 * 1024 });
    expect(dump.stdout).toContain('原始库'); expect(dump.stdout).toContain('合成作者');
    expect(dump.stdout).not.toMatch(/并发修改|later@fixture|platform-owned-migration|metadata-is-not-bytes|CREATE SCHEMA/);
    expect(dump.stdout).toContain('setval');
    const inventory = JSON.parse(await readFile(resolve(output, 'inventory.json'), 'utf8'));
    expect(inventory.libraryIds).toHaveLength(1); expect(inventory.objects).toHaveLength(1);
    expect(JSON.parse(await readFile(resolve(output, 'migration-ledger.json'),'utf8'))).toEqual([{ version: '202610170001', name: 'cloud_large_objects' }]);
    expect(JSON.parse(await readFile(resolve(output, 'storage-config.json'),'utf8'))).toMatchObject({ buckets: [{id:'lattice-shared-library',public:false,file_size_limit:20971520}] });
    await expect(capturePostgresPlatformRecoverySnapshot({ connection: f.connection, binDirectory: f.binDirectory, output })).rejects.toThrow(/exists/i);
  }, 180000);

  it('rejects an expired snapshot lease without creating an output', async () => {
    const { capturePostgresPlatformRecoverySnapshot, withPostgresRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-snapshot.mjs');
    let expired!: Readonly<{ snapshotId: string }>;
    await withPostgresRecoverySnapshot({ connection: f.connection, binDirectory: f.binDirectory }, async snapshot => { expired = snapshot; });
    const output = resolve(f.root, 'expired');
    await expect(capturePostgresPlatformRecoverySnapshot({ connection: f.connection, binDirectory: f.binDirectory, output, snapshot: expired })).rejects.toThrow(/lease/i);
    await expect(access(output)).rejects.toThrow();
  });

  it('does not publish a capture from an RLS-filtered account even if all table grants exist', async () => {
    const { capturePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-snapshot.mjs');
    await f.sql(`create role lattice_platform_limited login;
      grant connect on database lattice_source to lattice_platform_limited;
      grant usage on schema public,auth,storage,supabase_migrations to lattice_platform_limited;
      grant select on all tables in schema public,auth,storage,supabase_migrations to lattice_platform_limited;
      grant usage,select on all sequences in schema auth to lattice_platform_limited;
      grant execute on function pg_control_system() to lattice_platform_limited;
      alter table public.libraries enable row level security;`);
    const output = resolve(f.root, 'rls-refused');
    try {
      await expect(capturePostgresPlatformRecoverySnapshot({ connection: { ...f.connection, user: 'lattice_platform_limited' }, binDirectory: f.binDirectory, output })).rejects.toThrow();
      await expect(access(resolve(output, 'platform-capture.json'))).rejects.toThrow();
    } finally { await f.sql('alter table public.libraries disable row level security;'); }
  });

  it('rejects a public or unrelated bucket before creating a completed recovery point', async () => {
    const { capturePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-snapshot.mjs');
    await f.sql("update storage.buckets set public=true;");
    const output = resolve(f.root, 'public-bucket-refused');
    try {
      await expect(capturePostgresPlatformRecoverySnapshot({ connection: f.connection, binDirectory: f.binDirectory, output })).rejects.toThrow(/scope/i);
      await expect(access(resolve(output, 'platform-capture.json'))).rejects.toThrow();
    } finally { await f.sql("update storage.buckets set public=false;"); }
    await f.sql("insert into storage.buckets values('other-app-bucket',false,20971520);");
    try {
      await expect(capturePostgresPlatformRecoverySnapshot({ connection: f.connection, binDirectory: f.binDirectory, output })).rejects.toThrow(/scope/i);
      await expect(access(resolve(output, 'platform-capture.json'))).rejects.toThrow();
    } finally { await f.sql("delete from storage.buckets where id='other-app-bucket';"); }
  });
});
