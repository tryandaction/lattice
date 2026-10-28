// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { listCloudActivity } from '../collaboration-audit';

describe('cloud audit client', () => {
  it('uses the authenticated transport and keeps pagination/cancellation', async () => {
    const page = { events: [], nextCursor: null, hasMore: false };
    const transport = { request: vi.fn(async () => ({ status: 200, body: { data: page } })) };
    const signal = new AbortController().signal;
    expect(await listCloudActivity(transport, 'library/id', { cursor: '17', limit: 20, signal })).toEqual(page);
    expect(transport.request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/libraries/library%2Fid/activity', query: { cursor: '17', limit: 20 }, signal });
  });
  it('rejects incomplete server responses', async () => {
    await expect(listCloudActivity({ request: async () => ({ status: 200, body: { events: [] } }) }, 'library')).rejects.toThrow('Invalid activity response');
  });
});
describe('audit migration invariants', () => {
  const sql = () => readFileSync('supabase/migrations/202610270002_cloud_collaboration_audit.sql', 'utf8');
  it('records every collaborative entity and denies direct mutation', () => {
    const source = sql();
    for (const table of ['libraries', 'collections', 'items', 'item_versions', 'annotations', 'annotation_comments', 'library_members']) expect(source).toContain(`on public.${table}`);
    expect(source).toContain('before update or delete on public.cloud_audit_events');
    expect(source).toContain('revoke all on public.cloud_audit_events from public, anon, authenticated');
    expect(source).toContain('grant select on public.cloud_audit_events to authenticated');
    expect(source).toContain('public.is_library_member(library_id,auth.uid())');
  });
  it('captures whitelisted snapshots instead of whole rows or credentials', () => {
    const source = sql();
    expect(source).toContain('before_value:=public.cloud_audit_snapshot');
    expect(source).toContain('after_value:=public.cloud_audit_snapshot');
    expect(source).not.toContain("->'settings'");
    expect(source).not.toContain("->'token'");
    expect(source).toContain('visibility_owner_id');
    expect(source).toContain('cloud_audit_annotation_visible');
  });
});
