// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nativePostgresAvailable } from '../test-support/native-postgres';
import { platformPostgresFixture } from '../test-support/platform-postgres';

it('prepares platform import without reading source files or target credentials', async () => {
  const result = await promisify(execFile)(process.execPath,['scripts/cloud-library-platform-restore.mjs','absent-point','synthetic-target'],{env:{...process.env,LATTICE_RESTORE_PG_PASSWORD:'must-not-be-read-or-printed'}});
  expect(JSON.parse(result.stdout)).toMatchObject({status:'prepared',filesRead:0,credentialsRead:false,databaseWrites:0});
  expect(result.stdout).not.toContain('must-not-be-read-or-printed');
});

describe.skipIf(!nativePostgresAvailable)('initialized platform data restoration', () => {
  let f: Awaited<ReturnType<typeof platformPostgresFixture>>, captureRoot: string;
  beforeAll(async () => {
    f = await platformPostgresFixture(); captureRoot=resolve(f.root,'captured-platform');
    const { capturePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-snapshot.mjs');
    await capturePostgresPlatformRecoverySnapshot({connection:f.connection,binDirectory:f.binDirectory,output:captureRoot});
  },180000);
  afterAll(async () => { await f?.close(); });

  it('imports real-migration data while preserving platform schemas, migrations, policies and empty physical storage', async () => {
    const { restorePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-platform-restore.mjs');
    const connection = await f.newTarget('lattice_restored');
    const before = await f.sql("select 'auth.users'::regclass::oid||':'||'storage.objects'::regclass::oid",connection.database);
    expect(await restorePostgresPlatformRecoverySnapshot({captureRoot,connection,binDirectory:f.binDirectory})).toMatchObject({status:'restored-platform-data',inventoryVerifiedInTransaction:true,tableCountsVerified:true,schemaReplaced:false,physicalStorageRestored:false,productionRestoreVerified:false});
    expect(await f.sql("select 'auth.users'::regclass::oid||':'||'storage.objects'::regclass::oid",connection.database)).toBe(before);
    expect(await f.sql('select version from auth.schema_migrations',connection.database)).toBe('lattice_target-platform-version');
    expect(await f.sql('select count(*) from storage.objects',connection.database)).toBe('0');
    expect(await f.sql('select count(*) from supabase_migrations.schema_migrations',connection.database)).toBe('8');
    expect(await f.sql('select max_storage_bytes from public.cloud_storage_limits',connection.database)).toBe('910000000');
    expect(await f.sql("select encrypted_password from auth.users limit 1",connection.database)).toBe('synthetic-hash');
    expect(await f.sql("select identity_data->>'nickname' from auth.identities",connection.database)).toBe('原作者');
    expect(await f.sql("insert into auth.identities(user_id,identity_data) values('"+f.ids.owner+"','{}') returning id",connection.database)).toBe('2');
    const member = (user:string,sql:string) => f.sql(`begin;set local role authenticated;set local request.jwt.claim.sub='${user}';${sql};rollback;`,connection.database);
    expect(await member(f.ids.viewer,'select count(*) from public.items')).toBe('2');
    expect(await member(f.ids.viewer,"select body->>'text' from public.annotations")).toBe('完整恢复批注');
    expect(await member(f.ids.viewer,"select display_name from public.library_members where user_id='"+f.ids.viewer+"'")).toBe('协作者');
    expect(await member(f.ids.viewer,'select count(*) from public.item_versions')).toBe('2');
    expect(await member(f.ids.viewer,'select count(*) from public.item_children')).toBe('1');
    expect(await member(f.ids.outsider,'select count(*) from public.items')).toBe('0');
    await f.sql("update public.library_members set status='suspended' where user_id='"+f.ids.viewer+"'",connection.database);
    expect(await member(f.ids.viewer,'select count(*) from public.items')).toBe('0');
    expect(await f.sql("select status from public.library_members where user_id='"+f.ids.viewer+"'")).toBe('active');
  },180000);

  it('refuses source identity and preexisting business data without modifying either database', async () => {
    const { restorePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-platform-restore.mjs');
    await expect(restorePostgresPlatformRecoverySnapshot({captureRoot,connection:f.connection,binDirectory:f.binDirectory})).rejects.toThrow(/source/i);
    await expect(restorePostgresPlatformRecoverySnapshot({captureRoot,connection:{...f.connection,projectRef:'synthetic-alias'},binDirectory:f.binDirectory})).rejects.toThrow(/identity/i);
    const connection=await f.newTarget('lattice_populated');
    await f.sql("insert into auth.users values('aaaaaaaa-1111-4111-8111-111111111111','existing@synthetic.test','keep')",connection.database);
    await expect(restorePostgresPlatformRecoverySnapshot({captureRoot,connection,binDirectory:f.binDirectory})).rejects.toThrow();
    expect(await f.sql('select email from auth.users',connection.database)).toBe('existing@synthetic.test');
    expect(await f.sql('select count(*) from public.libraries',connection.database)).toBe('0');
  });

  it('rejects incompatible columns, migration versions and changed initial configuration', async () => {
    const { restorePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-platform-restore.mjs');
    for(const fault of ['columns','versions','config'] as const){
      const connection=await f.newTarget('lattice_bad_'+fault);
      await f.sql(fault==='columns'?'alter table auth.users add column unexpected text':fault==='versions'?"delete from supabase_migrations.schema_migrations where version='202610170001'":'update public.cloud_storage_limits set max_storage_bytes=920000000',connection.database);
      await expect(restorePostgresPlatformRecoverySnapshot({captureRoot,connection,binDirectory:f.binDirectory})).rejects.toThrow();
      expect(await f.sql('select count(*) from auth.users',connection.database)).toBe('0');
    }
  });

  it('rejects a widened RLS policy even when migration versions, columns and RLS enablement are unchanged', async () => {
    const { restorePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-platform-restore.mjs');
    const connection=await f.newTarget('lattice_widened_policy');
    const policy=await f.sql("select policyname from pg_policies where schemaname='public' and tablename='items' and cmd='SELECT' limit 1",connection.database);
    if(!/^[a-z_][a-z0-9_]*$/.test(policy)) throw new Error('Missing synthetic item policy');
    await f.sql('alter policy '+policy+' on public.items using(true)',connection.database);
    await expect(restorePostgresPlatformRecoverySnapshot({captureRoot,connection,binDirectory:f.binDirectory})).rejects.toThrow();
    expect(await f.sql('select count(*) from auth.users',connection.database)).toBe('0');
    expect(await f.sql('select count(*) from public.items',connection.database)).toBe('0');
  });

  it('rolls back copied rows, pristine configuration and sequence restarts when end verification fails', async () => {
    const { restorePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-platform-restore.mjs');
    const changed=resolve(f.root,'bad-count'); await cp(captureRoot,changed,{recursive:true,errorOnExist:true});
    const catalog=JSON.parse(await readFile(resolve(changed,'catalog.json'),'utf8'));
    catalog.relations.find((row:{schema:string;name:string})=>row.schema==='auth'&&row.name==='users').rows++;
    const bytes=Buffer.from(JSON.stringify(catalog)); await writeFile(resolve(changed,'catalog.json'),bytes);
    const manifest=JSON.parse(await readFile(resolve(changed,'platform-capture.json'),'utf8'));
    const artifact=manifest.artifacts.find((row:{kind:string})=>row.kind==='catalog');artifact.sizeBytes=bytes.length;artifact.sha256=createHash('sha256').update(bytes).digest('hex');
    await writeFile(resolve(changed,'platform-capture.json'),JSON.stringify(manifest));
    const connection=await f.newTarget('lattice_rollback');
    const sequenceBefore=await f.sql('select last_value::text||\':\'||is_called::text from auth.identities_id_seq',connection.database);
    await expect(restorePostgresPlatformRecoverySnapshot({captureRoot:changed,connection,binDirectory:f.binDirectory})).rejects.toThrow();
    expect(await f.sql('select count(*) from auth.users',connection.database)).toBe('0');
    expect(await f.sql('select count(*) from public.libraries',connection.database)).toBe('0');
    expect(await f.sql('select max_storage_bytes from public.cloud_storage_limits',connection.database)).toBe('950000000');
    expect(await f.sql('select last_value::text||\':\'||is_called::text from auth.identities_id_seq',connection.database)).toBe(sequenceBefore);
  });

  it('rejects a widened RLS helper whose policy text and application migrations are unchanged', async () => {
    const { restorePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-platform-restore.mjs');
    const connection=await f.newTarget('lattice_widened_helper');
    await f.sql("create or replace function public.is_library_member(target_library_id uuid,target_user_id uuid) returns boolean language sql stable security definer set search_path=public as $$select true$$",connection.database);
    await expect(restorePostgresPlatformRecoverySnapshot({captureRoot,connection,binDirectory:f.binDirectory})).rejects.toThrow();
    expect(await f.sql('select count(*) from auth.users',connection.database)).toBe('0');
    expect(await f.sql('select count(*) from public.items',connection.database)).toBe('0');
  });

  it('rejects a missing standalone unique index even when columns, constraints and versions match', async () => {
    const { restorePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-platform-restore.mjs');
    const connection=await f.newTarget('lattice_missing_unique_index');
    await f.sql('drop index public.cloud_items_sibling_name',connection.database);
    await expect(restorePostgresPlatformRecoverySnapshot({captureRoot,connection,binDirectory:f.binDirectory})).rejects.toThrow();
    expect(await f.sql('select count(*) from auth.users',connection.database)).toBe('0');
    expect(await f.sql('select count(*) from public.items',connection.database)).toBe('0');
  });

  it.each([
    ['acl', 'grant select on auth.users to authenticated'],
    ['owner', 'alter table public.items owner to authenticated'],
    ['column_acl', 'grant select(encrypted_password) on auth.users to authenticated'],
  ])('rejects target table privilege drift: %s', async (label,statement) => {
    const { restorePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-platform-restore.mjs');
    const connection=await f.newTarget('lattice_changed_'+label);
    await f.sql(statement,connection.database);
    await expect(restorePostgresPlatformRecoverySnapshot({captureRoot,connection,binDirectory:f.binDirectory})).rejects.toThrow();
    expect(await f.sql('select count(*) from auth.users',connection.database)).toBe('0');
    expect(await f.sql('select count(*) from public.items',connection.database)).toBe('0');
  });

  it('rolls back an archive whose copied rows have broken foreign keys even if counts and blob inventory match', async () => {
    const { capturePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-postgres-snapshot.mjs');
    const { restorePostgresPlatformRecoverySnapshot } = await import('../../../scripts/cloud-library-platform-restore.mjs');
    const broken=resolve(f.root,'broken-reference'), connection=await f.newTarget('lattice_bad_reference');
    await f.sql("set session_replication_role=replica;update auth.identities set user_id='99999999-9999-4999-8999-999999999999';set session_replication_role=origin;");
    try {
      await capturePostgresPlatformRecoverySnapshot({connection:f.connection,binDirectory:f.binDirectory,output:broken});
      await expect(restorePostgresPlatformRecoverySnapshot({captureRoot:broken,connection,binDirectory:f.binDirectory})).rejects.toThrow();
      expect(await f.sql('select count(*) from auth.users',connection.database)).toBe('0');
      expect(await f.sql('select max_storage_bytes from public.cloud_storage_limits',connection.database)).toBe('950000000');
    } finally {await f.sql("set session_replication_role=replica;update auth.identities set user_id='"+f.ids.owner+"';set session_replication_role=origin;");}
  });
});
