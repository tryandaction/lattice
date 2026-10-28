// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const runtime = resolve('.lattice-build/cloud-team-test-runtime/node_modules/@electric-sql/pglite/dist/index.js');
type Row = Record<string, unknown>;
interface Pg {
  exec(sql: string): Promise<unknown>;
  query(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
  transaction<T>(callback: (tx: Pg) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// The optional runtime is shared with the repository's existing SQL RLS smoke
// fixture. No network, hosted database, or added production dependency is used.
describe.skipIf(!existsSync(runtime))('collaboration audit PostgreSQL behavior', () => {
  it('enforces actor snapshots, readonly RLS, private audit visibility and cascade retention', async () => {
    const { PGlite }: { PGlite: new () => Pg } = await import(/* @vite-ignore */ pathToFileURL(runtime).href);
    const db = new PGlite();
    const owner = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
    const organization = randomUUID(), library = randomUUID(), item = randomUUID(), annotation = randomUUID(), comment = randomUUID(), collection = randomUUID(), version = randomUUID();
    async function actor(user: string, sql: string, parameters: unknown[] = []) {
      return db.transaction(async tx => {
        await tx.exec('set local role authenticated');
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
        return tx.query(sql, parameters);
      });
    }
    try {
      await db.exec(
        "create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key,email text);" +
        "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
        'grant usage on schema public,auth to authenticated; grant execute on all functions in schema auth to authenticated;'
      );
      for (const name of ['202608200001_shared_library_core.sql', '202608200002_shared_library_rls.sql', '202608300001_shared_library_security_hardening.sql', '202610080001_cloud_team_library.sql', '202610120001_cloud_member_display_names.sql']) {
        await db.exec(readFileSync(resolve('supabase/migrations', name), 'utf8').replace('create extension if not exists "pgcrypto";', ''));
      }
      await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated; grant usage,select on all sequences in schema public to authenticated;');
      await db.exec(readFileSync(resolve('supabase/migrations/202610270002_cloud_collaboration_audit.sql'), 'utf8'));
      await db.query('insert into auth.users values($1,$4),($2,$5),($3,$6)', [owner, viewer, outsider, 'owner@fixture.test', 'viewer@fixture.test', 'outsider@fixture.test']);
      await db.query('insert into public.organizations(id,name,slug,created_by) values($1,$2,$2,$3)', [organization, 'fixture', owner]);
      await actor(owner, 'insert into public.libraries(id,organization_id,name,slug,created_by,settings) values($1,$2,$3,$3,$4,$5)', [library, organization, 'Library', owner, { secret: 'credential-do-not-audit' }]);
      await actor(owner, "insert into public.library_members(library_id,user_id,role) values($1,$2,'viewer')", [library, viewer]);
      await actor(owner, 'select public.cloud_set_member_display_name($1,$2)', [library, 'Owner']);
      await actor(owner, "insert into public.collections(id,library_id,name,sort_key) values($1,$2,'Papers','1')", [collection, library]);
      await actor(owner, "insert into public.items(id,library_id,collection_id,kind,title,canonical_name,created_by) values($1,$2,$3,'markdown','Old title','file.md',$4)", [item, library, collection, owner]);
      await actor(owner, "update public.items set title='New title' where id=$1", [item]);
      const renamed = (await actor(viewer, "select * from public.cloud_audit_events where entity_type='item' and action='updated' order by sequence desc limit 1")).rows[0];
      expect(renamed.actor_id).toBe(owner); expect(renamed.actor_display_name).toBe('Owner');
      expect(renamed.before).toMatchObject({ title: 'Old title' }); expect(renamed.after).toMatchObject({ title: 'New title' });
      expect(JSON.stringify((await actor(viewer, 'select * from public.cloud_audit_events')).rows)).not.toContain('credential-do-not-audit');
      expect((await actor(outsider, 'select * from public.cloud_audit_events')).rows).toHaveLength(0);
      for (const sql of ["insert into public.cloud_audit_events(library_id,entity_type,entity_id,action,target_label) values($1,'library',$1,'created','forged')", "update public.cloud_audit_events set target_label='forged' where library_id=$1", 'delete from public.cloud_audit_events where library_id=$1']) {
        await expect(actor(owner, sql, [library])).rejects.toMatchObject({ code: '42501' });
      }
      await expect(db.exec("update public.cloud_audit_events set target_label='forged'")).rejects.toMatchObject({ code: '42501' });
      const beforeSettings = (await actor(viewer, 'select * from public.cloud_audit_events')).rows.length;
      await actor(owner, 'update public.libraries set settings=$2 where id=$1', [library, { token: 'new-secret' }]);
      expect((await actor(viewer, 'select * from public.cloud_audit_events')).rows).toHaveLength(beforeSettings);
      await actor(owner, "update public.library_members set role='commenter' where library_id=$1 and user_id=$2", [library, viewer]);
      expect((await actor(viewer, "select * from public.cloud_audit_events where action='role-changed'")).rows[0]).toMatchObject({ actor_id: owner, before: { role: 'viewer' }, after: { role: 'commenter' } });
      // Seed one immutable existing content version as fixture superuser. The
      // production version guard itself is already covered by prior SQL tests.
      await db.exec('alter table public.item_versions disable trigger cloud_guard_version');
      await db.query("insert into public.item_versions(id,item_id,version_number,content_hash,created_by) values($1,$2,1,'hash',$3)", [version, item, owner]);
      await db.exec('alter table public.item_versions enable trigger cloud_guard_version');
      await actor(owner, "insert into public.annotations(id,item_id,version_id,author_id,kind,target,body) values($1,$2,$3,$4,'comment','{}',$5)", [annotation, item, version, owner, { comment: 'initially shared' }]);
      expect((await actor(viewer, 'select * from public.cloud_audit_events where annotation_id=$1', [annotation])).rows).toHaveLength(1);
      await actor(owner, 'select public.cloud_mutate_annotation($1,$2,1,false,$3)', [item, { id: annotation, versionId: version, kind: 'comment', target: {}, quote: null, geometry: null, style: {}, body: { visibility: 'private', comment: 'private-audit-content' } }, randomUUID()]);
      await actor(owner, 'insert into public.annotation_comments(id,annotation_id,author_id,body) values($1,$2,$3,$4)', [comment, annotation, owner, 'private-reply']);
      expect((await actor(viewer, 'select * from public.cloud_audit_events where annotation_id=$1', [annotation])).rows).toHaveLength(0);
      expect((await actor(owner, 'select * from public.cloud_audit_events where annotation_id=$1', [annotation])).rows).toHaveLength(3);
      const countBeforeDelete = (await actor(owner, 'select * from public.cloud_audit_events')).rows.length;
      await actor(owner, 'delete from public.items where id=$1', [item]);
      const deleted = (await actor(owner, "select * from public.cloud_audit_events where action='deleted'")).rows;
      expect(deleted.map(row => row.entity_type)).toEqual(expect.arrayContaining(['item', 'version', 'annotation', 'comment']));
      expect((await actor(owner, 'select * from public.cloud_audit_events')).rows.length).toBeGreaterThan(countBeforeDelete);
      expect((await actor(viewer, 'select * from public.cloud_audit_events where annotation_id=$1', [annotation])).rows).toHaveLength(0);
      await actor(owner, 'delete from public.libraries where id=$1', [library]);
      expect((await db.query('select * from public.cloud_audit_events where library_id=$1', [library])).rows.length).toBeGreaterThan(countBeforeDelete);
    } finally { await db.close(); }
  });
});
