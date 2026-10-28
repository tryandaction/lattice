// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GitHubIntegrationClient, decodeGitHubFile, encodeGitHubFile } from '../github';

describe('GitHub shared-library client', () => {
  it('preserves UTF-8 and binary bytes in GitHub file content', () => {
    const text = new TextEncoder().encode('你好，Lattice 🌌');
    expect(decodeGitHubFile({ content: encodeGitHubFile(text) })).toEqual(text);
    const bytes = new Uint8Array([0, 255, 128, 13, 10]);
    expect(decodeGitHubFile({ content: encodeGitHubFile(bytes) })).toEqual(bytes);
  });
  it('uses the authenticated shared transport with explicit publication base SHA', async () => {
    const request = vi.fn(async (_input: unknown) => ({ status: 200, body: { data: { sha: 'new-sha' } } }));
    const client = new GitHubIntegrationClient({ request });
    expect(await client.publishFile('lib/id', { path: '研究.md', content: 'aGVsbG8=', expectedSha: 'known-sha' })).toEqual({ sha: 'new-sha' });
    expect(request).toHaveBeenCalledWith({ method: 'PUT', path: '/v1/libraries/lib%2Fid/github/file', body: { path: '研究.md', content: 'aGVsbG8=', expectedSha: 'known-sha' } });
  });
  it('keeps OAuth state and code in a POST body and passes file names as query data', async () => {
    const request = vi.fn(async (_input: unknown) => ({ status: 200, body: { data: {} } })); const client = new GitHubIntegrationClient({ request });
    await client.exchange({ code: 'oauth-code', state: 'random-state', redirectUri: 'https://lattice.example/cloud' });
    await client.readFile('library', 'dir/a&b.md');
    expect(request.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/integrations/github/exchange', body: { code: 'oauth-code', state: 'random-state' } });
    expect(request.mock.calls[1][0]).toMatchObject({ method: 'GET', query: { path: 'dir/a&b.md' } });
  });
});

describe('GitHub database security contract', () => {
  const sql = readFileSync(new URL('../../../../supabase/migrations/202610270003_github_integration.sql', import.meta.url), 'utf8');
  it('enables RLS and revokes clients from every secret and provenance table', () => {
    for (const table of ['cloud_github_tokens', 'cloud_github_oauth_states', 'cloud_github_member_grants']) expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain('from public,anon,authenticated');
    expect(sql).toContain('grant select on public.cloud_github_identities,public.cloud_github_connections to authenticated');
    expect(sql).not.toContain('grant select on public.cloud_github_tokens');
  });
  it('preserves manual memberships with insert-only grants and explicit provenance removal', () => {
    expect(sql).toContain('on conflict(library_id,user_id) do nothing');
    expect(sql).toContain('create trigger cloud_github_manual_member before insert or update or delete on public.library_members');
    expect(sql).toContain('g.connection_id=c.id and c.library_id=new.library_id and g.user_id=new.user_id');
    expect(sql).not.toContain('do update set role=');
    expect(sql).toContain("and role='editor' and status='active'");
  });
  it('protects single-use identity ownership and server-only RPC privileges', () => {
    expect(sql).toContain('github_user_id bigint not null unique');
    expect(sql).toContain('A different GitHub identity is already connected');
    expect(sql).toContain('public.cloud_github_sync_members(uuid,uuid,jsonb)');
    expect(sql).toContain('to service_role');
    expect(sql).not.toContain('to authenticated;\ngrant execute');
  });
});
