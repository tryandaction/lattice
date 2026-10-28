// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { dispatch } from './collaboration-audit';
import type { CloudIntegrationContext } from './integration-context';

const library = '11111111-1111-4111-8111-111111111111';
const row = (sequence: number) => ({ sequence, library_id: library, actor_id: 'actor', actor_display_name: 'Alice', entity_type: 'version', entity_id: 'version', item_id: 'item', version_id: 'version', annotation_id: null, action: 'created', target_label: 'paper.pdf', before: null, after: { version_number: 2 }, created_at: '2026-10-27T00:00:00Z' });
function fixture(query = '', member = true, rows = [row(3), row(2), row(1)]) {
  const url = new URL(`https://api.test/v1/libraries/${library}/activity${query}`);
  const db = vi.fn(async (table: string) => ({ response: new Response(null, { status: 200 }), body: table === 'library_members' ? member ? [{ role: 'viewer' }] : [] : rows }));
  const context: CloudIntegrationContext = { env: { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }, actor: { userId: 'actor', accessToken: 'jwt' }, segments: url.pathname.split('/').filter(Boolean), url, db, json: (body, status = 200) => Response.json(body, { status }), error: (code, message, status) => Response.json({ error: { code, message } }, { status }) };
  return { context, db, request: new Request(url) };
}
describe('cloud audit route', () => {
  it('requires active membership before returning audit records', async () => {
    const f = fixture('', false);
    expect((await dispatch(f.request, f.context))?.status).toBe(403);
    expect(f.db).toHaveBeenCalledTimes(1);
  });
  it('paginates newest first with a bounded strict sequence cursor', async () => {
    const f = fixture('?cursor=9&limit=2');
    const response = await dispatch(f.request, f.context);
    expect(await response?.json()).toMatchObject({ events: [{ sequence: '3', actorDisplayName: 'Alice', versionId: 'version' }, { sequence: '2' }], nextCursor: '2', hasMore: true });
    expect(f.db).toHaveBeenLastCalledWith('cloud_audit_events', undefined, expect.objectContaining({ library_id: `eq.${library}`, sequence: 'lt.9', limit: 3, order: 'sequence.desc' }));
  });
  it.each(['?cursor=0', '?cursor=1,or(sequence.gt.0)', '?limit=101', '?limit=0', '?limit=1.2'])('rejects malformed page parameters %s', async query => {
    const f = fixture(query);
    expect((await dispatch(f.request, f.context))?.status).toBe(400);
    expect(f.db).not.toHaveBeenCalled();
  });
  it('returns a terminal page and rejects writes', async () => {
    const f = fixture('', true, []);
    expect(await (await dispatch(f.request, f.context))?.json()).toEqual({ events: [], nextCursor: null, hasMore: false });
    expect((await dispatch(new Request(f.request.url, { method: 'POST' }), f.context))?.status).toBe(405);
  });
  it('does not claim unrelated routes', async () => {
    const f = fixture(); f.context.segments[3] = 'items';
    expect(await dispatch(f.request, f.context)).toBeNull();
  });
});
