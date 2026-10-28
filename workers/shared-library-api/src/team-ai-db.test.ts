// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createProtocolServer, PROFILE_A, PROFILE_B } from '../test-support/protocol-server';

describe('team AI real PostgreSQL permissions and budget', () => {
  let server: Awaited<ReturnType<typeof createProtocolServer>>;
  let organizationId: string;
  beforeAll(async () => {
    server = await createProtocolServer();
    // The shared protocol fixture now applies the complete production migration chain.
    await server.db.exec('grant usage on schema public to service_role;');
    organizationId = (await server.db.query<{ id: string }>("insert into public.organizations(name,slug,created_by) values('AI test','ai-test',$1) returning id", [PROFILE_A])).rows[0].id;
  });
  afterAll(async () => { await server?.close(); });
  async function library(options: { daily?: number; budget?: number; enabled?: boolean } = {}) {
    const id = (await server.db.query<{ id: string }>("insert into public.libraries(organization_id,name,slug,created_by) values($1,'AI Library',$2,$3) returning id", [organizationId, randomUUID(), PROFILE_A])).rows[0].id;
    await server.db.query("insert into public.library_members(library_id,user_id,role,status) values($1,$2,'viewer','active') on conflict do nothing", [id, PROFILE_A]);
    await server.db.query("insert into public.cloud_ai_library_policies(library_id,enabled,allowed_provider_ids,max_requests_per_day,monthly_budget_usd_micros,max_output_tokens) values($1,$2,array['team'],$3,$4,1024)", [id, options.enabled ?? true, options.daily ?? 100, options.budget ?? 100000]);
    return id;
  }
  async function reserve(id: string, options: { user?: string; role?: string; provider?: string; tokens?: number; price?: number } = {}) {
    return server.db.transaction(async db => {
      await db.exec(options.role === 'authenticated' ? 'set local role authenticated' : 'set local role service_role');
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [PROFILE_A]);
      return db.query<{ result: { reservationId: string } }>('select public.cloud_reserve_ai_request($1,$2,$3,$4,$5,$6) as result', [id, options.user ?? PROFILE_A, options.provider ?? 'team', randomUUID(), options.price ?? 10000, options.tokens ?? 500]);
    });
  }
  async function asMember<T>(user: string, sql: string, parameters: unknown[] = []): Promise<{ rows: T[] }> {
    return server.db.transaction(async db => {
      await db.exec('set local role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      return db.query<T>(sql, parameters);
    });
  }
  it('restricts policy reads to members and denies policy edits and quota RPC to authenticated callers', async () => {
    const id = await library();
    expect((await asMember(PROFILE_A, 'select library_id from public.cloud_ai_library_policies where library_id=$1', [id])).rows).toHaveLength(1);
    expect((await asMember(PROFILE_B, 'select library_id from public.cloud_ai_library_policies where library_id=$1', [id])).rows).toHaveLength(0);
    await expect(asMember(PROFILE_A, 'update public.cloud_ai_library_policies set monthly_budget_usd_micros=999999999 where library_id=$1', [id])).rejects.toMatchObject({ code: '42501' });
    await expect(reserve(id, { role: 'authenticated' })).rejects.toMatchObject({ code: '42501' });
  });
  it('enforces the per-library daily request count across independent callers', async () => {
    const id = await library({ daily: 1 });
    const outcomes = await Promise.allSettled([reserve(id), reserve(id)]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    expect((await server.db.query('select id from public.cloud_ai_requests where library_id=$1', [id])).rows).toHaveLength(1);
    const other = await library({ daily: 1 });
    await expect(reserve(other)).resolves.toBeDefined();
  });
  it('enforces monthly allocated budget without automatically refunding failed upstream work', async () => {
    const id = await library({ budget: 15000 });
    await reserve(id);
    await expect(reserve(id)).rejects.toMatchObject({ code: 'P0001' });
    expect((await server.db.query<{ total: string }>('select sum(reserved_usd_micros) as total from public.cloud_ai_requests where library_id=$1', [id])).rows[0].total).toBe('10000');
    await expect(asMember(PROFILE_A, 'delete from public.cloud_ai_requests where library_id=$1', [id])).rejects.toMatchObject({ code: '42501' });
  });
  it('rechecks active membership, enabled policy, provider and token cap inside the atomic reservation', async () => {
    const id = await library();
    await expect(reserve(id, { user: PROFILE_B })).rejects.toMatchObject({ code: '42501' });
    await expect(reserve(id, { provider: 'unapproved' })).rejects.toMatchObject({ code: '42501' });
    await expect(reserve(id, { tokens: 1025 })).rejects.toMatchObject({ code: '22023' });
    await expect(reserve(id, { price: -1 })).rejects.toMatchObject({ code: '22023' });
    await server.db.query("update public.library_members set status='suspended' where library_id=$1", [id]);
    await expect(reserve(id)).rejects.toMatchObject({ code: '42501' });
    const disabled = await library({ enabled: false });
    await expect(reserve(disabled)).rejects.toMatchObject({ code: '42501' });
  });
  it('stores owner-configured provider keys as private ciphertext and updates the library allowlist atomically', async () => {
    const id = await library({ enabled: false });
    const ciphertext = 'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA==';
    const configure = () => server.db.transaction(async db => {
      await db.exec('set local role service_role');
      return db.query<{ result: { saved: boolean } }>(`select public.cloud_configure_team_ai_provider($1,$2,true,25,5000000,2048,'team-byo','Team BYOK','https://gateway.example.com/v1',array['research-v2'],1024,25000,$3) as result`, [id, PROFILE_A, ciphertext]);
    });
    await expect(configure()).resolves.toMatchObject({ rows: [{ result: { saved: true } }] });
    const saved = (await server.db.query<{ api_key_ciphertext: string }>('select api_key_ciphertext from public.cloud_ai_library_providers where library_id=$1 and provider_id=$2', [id, 'team-byo'])).rows[0];
    expect(saved.api_key_ciphertext).toBe(ciphertext);
    const policy = (await server.db.query<{ enabled: boolean; allowed_provider_ids: string[]; max_requests_per_day: number }>('select enabled,allowed_provider_ids,max_requests_per_day from public.cloud_ai_library_policies where library_id=$1', [id])).rows[0];
    expect(policy).toMatchObject({ enabled: true, allowed_provider_ids: ['team-byo'], max_requests_per_day: 25 });
    await expect(asMember(PROFILE_A, 'select api_key_ciphertext from public.cloud_ai_library_providers where library_id=$1', [id])).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects a non-admin actor and deletes a provider while disabling its stale policy entry', async () => {
    const id = await library();
    await expect(server.db.transaction(async db => {
      await db.exec('set local role service_role');
      return db.query('select public.cloud_configure_team_ai_provider($1,$2,true,25,5000000,2048,\'team-byo\',\'Team BYOK\',\'https://gateway.example.com/v1\',array[\'research-v2\'],1024,25000,\'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA==\')', [id, PROFILE_B]);
    })).rejects.toMatchObject({ code: '42501' });
    await server.db.query("insert into public.cloud_ai_library_providers(library_id,provider_id,label,base_url,models,api_key_ciphertext,max_output_tokens,request_budget_usd_micros,updated_by) values($1,'team-byo','Team BYOK','https://gateway.example.com/v1',array['research-v2'],'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA==',1024,25000,$2)", [id, PROFILE_A]);
    await server.db.query("update public.cloud_ai_library_policies set enabled=true,allowed_provider_ids=array['team-byo'] where library_id=$1", [id]);
    await server.db.transaction(async db => { await db.exec('set local role service_role'); await db.query('select public.cloud_delete_team_ai_provider($1,$2,$3)', [id, PROFILE_A, 'team-byo']); });
    expect((await server.db.query('select provider_id from public.cloud_ai_library_providers where library_id=$1', [id])).rows).toHaveLength(0);
    expect((await server.db.query<{ enabled: boolean; allowed_provider_ids: string[] }>('select enabled,allowed_provider_ids from public.cloud_ai_library_policies where library_id=$1', [id])).rows[0]).toMatchObject({ enabled: false, allowed_provider_ids: [] });
  });
});
