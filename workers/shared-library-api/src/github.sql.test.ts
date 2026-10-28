// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const runtime = resolve('.lattice-build/cloud-team-test-runtime/node_modules/@electric-sql/pglite/dist/index.js');
type Row = Record<string, unknown>;
interface Pg { exec(sql: string): Promise<unknown>; query(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>; transaction<T>(fn: (tx: Pg) => Promise<T>): Promise<T>; close(): Promise<void> }
describe.skipIf(!existsSync(runtime))('GitHub PostgreSQL service and RLS boundaries', () => {
  it('runs migration, preserves manual members, revokes automatic grants and denies client secrets/RPCs', async () => {
    const { PGlite }: { PGlite: new () => Pg } = await import(/* @vite-ignore */ pathToFileURL(runtime).href); const db = new PGlite();
    const owner = randomUUID(), a = randomUUID(), b = randomUUID(), c = randomUUID(), outsider = randomUUID(), org = randomUUID(), library = randomUUID();
    async function actor(user: string, sql: string, parameters: unknown[] = [], service = false) {
      return db.transaction(async tx => {
        await tx.exec(`set local role ${service ? 'service_role' : 'authenticated'}`);
        await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)", [user, service ? 'service_role' : 'authenticated']);
        return tx.query(sql, parameters);
      });
    }
    const service = (sql: string, parameters: unknown[] = []) => actor(owner, sql, parameters, true);
    try {
      await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$; grant usage on schema public,auth to authenticated,service_role; grant execute on all functions in schema auth to authenticated,service_role;");
      for (const migration of ['202608200001_shared_library_core.sql','202608200002_shared_library_rls.sql','202608300001_shared_library_security_hardening.sql','202610080001_cloud_team_library.sql','202610120001_cloud_member_display_names.sql','202610130002_cloud_function_privileges.sql']) await db.exec(readFileSync(resolve('supabase/migrations', migration), 'utf8').replace('create extension if not exists "pgcrypto";', ''));
      await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated,service_role; grant usage,select on all sequences in schema public to authenticated,service_role;');
      await db.exec(readFileSync(resolve('supabase/migrations/202610270003_github_integration.sql'), 'utf8'));
      await db.exec(readFileSync(resolve('supabase/migrations/202610270004_github_identity_unbind.sql'), 'utf8'));
      for (const id of [owner,a,b,c,outsider]) await db.query('insert into auth.users(id) values($1)', [id]);
      await db.query("insert into public.organizations(id,name,slug,created_by) values($1,'GitHub test','github-test',$2)", [org,owner]);
      await actor(owner, "insert into public.libraries(id,organization_id,name,slug,created_by) values($1,$2,'Library','repo',$3)", [library,org,owner]);
      await actor(owner, "insert into public.library_members(library_id,user_id,role) values($1,$2,'viewer')", [library,b]);
      const folderA = randomUUID(), folderB = randomUUID(), file = randomUUID(), contentVersion = randomUUID();
      for (const [id,name] of [[folderA,'Folder A'],[folderB,'Folder B']] as const) await actor(owner,"insert into public.items(id,library_id,kind,title,canonical_name,created_by) values($1,$2,'folder',$3,$3,$4)",[id,library,name,owner]);
      await actor(owner,"insert into public.items(id,library_id,kind,title,canonical_name,created_by,metadata) values($1,$2,'markdown','notes.md','notes.md',$3,$4)",[file,library,owner,{parentItemId:folderA,unrelated:'retained'}]);
      // A different client moves the file after the caller captured its source.
      await actor(owner,'update public.items set metadata=metadata||$2 where id=$1',[file,{parentItemId:folderB}]);
      const patched = (await actor(owner,'select (public.cloud_update_item_metadata($1,$2,null)).*',[file,{github:{repositoryId:88,path:'notes.md',sha:'baseline',branch:'main'}}])).rows[0];
      expect(patched.metadata).toMatchObject({ parentItemId:folderB,unrelated:'retained',github:{sha:'baseline'} });
      for (const forbidden of [{parentItemId:folderA},{expectedParentVersion:randomUUID()}]) await expect(actor(owner,'select public.cloud_update_item_metadata($1,$2,null)',[file,forbidden])).rejects.toMatchObject({code:'22023'});
      await expect(actor(b,'select public.cloud_update_item_metadata($1,$2,null)',[file,{github:{sha:'forged'}}])).rejects.toMatchObject({code:'42501'});
      await db.exec('alter table public.item_versions disable trigger cloud_guard_version');
      await db.query("insert into public.item_versions(id,item_id,version_number,content_hash,created_by) values($1,$2,1,'new-version-hash',$3)",[contentVersion,file,owner]);
      await db.exec('alter table public.item_versions enable trigger cloud_guard_version');
      await expect(actor(owner,'select public.cloud_update_item_metadata($1,$2,null)',[file,{github:{sha:'stale-baseline'}}])).rejects.toMatchObject({code:'40001'});
      const newest = (await actor(owner,'select (public.cloud_update_item_metadata($1,$2,$3)).*',[file,{github:{sha:'new-baseline'}},contentVersion])).rows[0];
      expect(newest.metadata).toMatchObject({parentItemId:folderB,unrelated:'retained',github:{sha:'new-baseline'}});
      const token = { access_cipher: 'v1.encrypted', refresh_cipher: 'v1.encrypted', expires_at: new Date(Date.now()+3600000).toISOString(), refresh_expires_at: new Date(Date.now()+7200000).toISOString() };
      for (const [id,numeric] of [[a,42],[b,43],[c,44]] as const) await service('select public.cloud_github_bind_identity($1,$2,$3,$4)', [id,numeric,`user-${numeric}`,token]);
      await expect(service('select public.cloud_github_bind_identity($1,42,$2,$3)', [outsider,'forged',token])).rejects.toMatchObject({ code: '23505' });
      await expect(service('select public.cloud_github_bind_identity($1,99,$2,$3)', [a,'different',token])).rejects.toMatchObject({ code: '23505' });
      const connection = (await service('select (public.cloud_github_connect($1,$2,$3)).*', [library,owner,{repository_id:88,installation_id:77,owner:'research',name:'notes',branch:'main',private:true}])).rows[0];
      const result = (await service('select public.cloud_github_sync_members($1,$2,$3) as result', [connection.id,owner,[42,43,44,99]])).rows[0].result;
      expect(result).toMatchObject({ granted: 2, matched: 3, unbound: 1, revoked: 0 });
      expect((await service('select role from public.library_members where library_id=$1 and user_id=$2',[library,b])).rows[0].role).toBe('viewer');
      expect((await service('select * from public.cloud_github_member_grants')).rows).toHaveLength(2);
      await actor(a, 'select public.cloud_set_member_display_name($1,$2)', [library,'GitHub editor nickname']);
      expect((await service('select * from public.cloud_github_member_grants')).rows).toHaveLength(2);
      await actor(owner, "update public.library_members set role='commenter' where library_id=$1 and user_id=$2",[library,a]);
      expect((await service('select * from public.cloud_github_member_grants where user_id=$1',[a])).rows).toHaveLength(0);
      const revoked = (await service('select public.cloud_github_sync_members($1,null,$2) as result',[connection.id,[43]])).rows[0].result;
      expect(revoked).toMatchObject({ revoked: 1, granted: 0 });
      expect((await service('select role from public.library_members where library_id=$1 and user_id=$2',[library,a])).rows[0].role).toBe('commenter');
      expect((await service('select * from public.library_members where library_id=$1 and user_id=$2',[library,c])).rows).toHaveLength(0);
      for (const table of ['cloud_github_tokens','cloud_github_oauth_states','cloud_github_member_grants','cloud_github_webhook_deliveries']) await expect(actor(owner, `select * from public.${table}`)).rejects.toMatchObject({ code: '42501' });
      await expect(actor(owner,'select public.cloud_github_sync_members($1,$2,$3)',[connection.id,owner,[]])).rejects.toMatchObject({ code:'42501' });
      expect((await actor(outsider,'select * from public.cloud_github_connections')).rows).toHaveLength(0);
      expect((await actor(owner,'select * from public.cloud_github_connections')).rows).toHaveLength(1);
      expect((await actor(a,'select * from public.cloud_github_identities')).rows).toHaveLength(1);
      await service("insert into public.cloud_github_oauth_states(state_hash,user_id,verifier_cipher,redirect_uri,expires_at) values('single-use',$1,'v1.pkce','https://callback.example',now()+interval '10 minutes')",[a]);
      expect((await service("delete from public.cloud_github_oauth_states where state_hash='single-use' and user_id=$1 and expires_at>now() returning *",[a])).rows).toHaveLength(1);
      expect((await service("delete from public.cloud_github_oauth_states where state_hash='single-use' and user_id=$1 and expires_at>now() returning *",[a])).rows).toHaveLength(0);
      await service("update public.cloud_github_tokens set expires_at=now()-interval '1 second' where user_id=$1",[a]);
      expect((await service('select * from public.cloud_github_claim_refresh($1)',[a])).rows).toHaveLength(1);
      expect((await service('select * from public.cloud_github_claim_refresh($1)',[a])).rows).toHaveLength(0);
      await service('select public.cloud_github_sync_members($1,null,$2)',[connection.id,[44]]);
      expect((await service('select * from public.cloud_github_member_grants where user_id=$1',[c])).rows).toHaveLength(1);
      await service('select public.cloud_github_unbind_identity($1)',[c]);
      expect((await service('select * from public.cloud_github_identities where user_id=$1',[c])).rows).toHaveLength(0);
      expect((await service('select * from public.cloud_github_tokens where user_id=$1',[c])).rows).toHaveLength(0);
      expect((await service('select * from public.cloud_github_member_grants where user_id=$1',[c])).rows).toHaveLength(0);
      expect((await service('select * from public.library_members where library_id=$1 and user_id=$2',[library,c])).rows).toHaveLength(0);
      expect((await service('select * from public.libraries where id=$1',[library])).rows).toHaveLength(1);
      await service('select public.cloud_github_disconnect($1,$2)',[connection.id,owner]);
      expect((await service('select * from public.library_members where library_id=$1 and user_id=$2',[library,c])).rows).toHaveLength(0);
      expect((await service('select role from public.library_members where library_id=$1 and user_id=$2',[library,a])).rows[0].role).toBe('commenter');
      await service('select public.cloud_github_unbind_identity($1)',[b]);
      expect((await actor(owner,'select role from public.library_members where library_id=$1 and user_id=$2',[library,b])).rows[0].role).toBe('viewer');
      await service("insert into public.cloud_github_webhook_deliveries(delivery_id,event,payload) values('one','member','{}')");
      expect((await service('select * from public.cloud_github_claim_webhooks(null)')).rows).toHaveLength(1);
      expect((await service('select * from public.cloud_github_claim_webhooks(null)')).rows).toHaveLength(0);
    } finally { await db.close(); }
  });
});
