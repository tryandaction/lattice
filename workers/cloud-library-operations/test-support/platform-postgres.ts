import { resolve } from 'node:path';
import { nativePostgresFixture } from './native-postgres';

const migrations = ['202608200001_shared_library_core.sql','202608200002_shared_library_rls.sql','202608300001_shared_library_security_hardening.sql','202610080001_cloud_team_library.sql','202610120001_cloud_member_display_names.sql','202610130001_cloud_supabase_storage.sql','202610130002_cloud_function_privileges.sql','202610170001_cloud_large_objects.sql'];
export const syntheticIds = { owner: '11111111-1111-4111-8111-111111111111', viewer: '22222222-2222-4222-8222-222222222222', outsider: '33333333-3333-4333-8333-333333333333', organization: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', library: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', paper: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', child: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', version: 'ffffffff-ffff-4fff-8fff-ffffffffffff', oldVersion: 'ffffffff-ffff-4fff-8fff-fffffffffff1', blob: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', oldBlob: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' };

/** Existing platform schema and the repository's eight real migrations, entirely synthetic. */
export async function platformPostgresFixture() {
  const f = await nativePostgresFixture();
  try {
    await f.sql('create role anon nologin; create role authenticated nologin;');
    for (const database of ['lattice_source','lattice_target']) {
      await f.sql(`create schema auth; create table auth.users(id uuid primary key,email text,encrypted_password text);
        create table auth.identities(id bigint generated always as identity primary key,user_id uuid references auth.users(id),identity_data jsonb);
        create table auth.schema_migrations(version text primary key);
        insert into auth.schema_migrations values('${database}-platform-version');
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub',auth.uid()) $$;
        create schema storage;
        create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint);
        create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
        alter table storage.objects enable row level security;
        grant usage on schema public,auth,storage to authenticated; grant execute on all functions in schema auth to authenticated;
        create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key);`, database);
      for (const name of migrations) {
        await f.file(resolve('supabase/migrations',name), database);
        await f.sql(`insert into supabase_migrations.schema_migrations values('${name.split('_')[0]}');`, database);
      }
      await f.sql('grant select,insert,update,delete on all tables in schema public,storage to authenticated; grant usage,select on all sequences in schema public to authenticated;',database);
    }
    const i = syntheticIds;
    await f.sql(`set session_replication_role=replica;
      insert into auth.users values('${i.owner}','owner@synthetic.test','synthetic-hash'),('${i.viewer}','viewer@synthetic.test','synthetic-hash'),('${i.outsider}','outsider@synthetic.test','synthetic-hash');
      insert into auth.identities(user_id,identity_data) values('${i.owner}','{"nickname":"原作者"}');
      insert into public.organizations(id,name,slug,created_by) values('${i.organization}','Recovery synthetic','recovery','${i.owner}');
      insert into public.libraries(id,organization_id,name,slug,created_by) values('${i.library}','${i.organization}','科研库','research','${i.owner}');
      insert into public.library_members(library_id,user_id,role,display_name) values('${i.library}','${i.owner}','owner','原作者'),('${i.library}','${i.viewer}','viewer','协作者');
      insert into public.blobs(id,library_id,storage_key,size_bytes,sha256,storage_backend) values('${i.blob}','${i.library}','libraries/${i.library}/blobs/${i.blob}',20971520,repeat('a',64),'supabase'),('${i.oldBlob}','${i.library}','libraries/${i.library}/blobs/${i.oldBlob}',4,repeat('b',64),'supabase');
      insert into public.items(id,library_id,kind,title,canonical_name,created_by,current_version_id,metadata) values('${i.paper}','${i.library}','pdf','Paper','paper.pdf','${i.owner}','${i.version}','{}'),('${i.child}','${i.library}','markdown','Child','note.md','${i.owner}',null,'{"parentItemId":"${i.paper}"}');
      insert into public.item_versions(id,item_id,version_number,blob_id,content_hash,created_by) values('${i.version}','${i.paper}',2,'${i.blob}',repeat('a',64),'${i.owner}'),('${i.oldVersion}','${i.paper}',1,'${i.oldBlob}',repeat('b',64),'${i.owner}');
      insert into public.item_children(parent_item_id,child_item_id,relative_path,kind,sort_key) values('${i.paper}','${i.child}','note.md','markdown','note.md');
      insert into public.annotations(item_id,version_id,author_id,kind,target,quote,body) values('${i.paper}','${i.version}','${i.owner}','highlight','{"page":3}','{"text":"Synthetic evidence"}','{"authorDisplayName":"原作者","text":"完整恢复批注"}');
      insert into storage.objects(bucket_id,name,metadata) values('lattice-shared-library','metadata-without-physical-bytes','{"size":4}');
      update public.cloud_storage_limits set max_storage_bytes=910000000;
      set session_replication_role=origin;`);
    return { ...f, ids: i,
      async newTarget(database: string) {
        if (!/^lattice_[a-z_]+$/.test(database)) throw new Error('Invalid synthetic database name');
        await f.sql(`create database ${database} template lattice_target;`, 'postgres');
        return { ...f.connection, database, projectRef: 'synthetic-' + database };
      },
    };
  } catch (error) { await f.close(); throw error; }
}
