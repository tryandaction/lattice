import type { CloudIntegrationContext } from './integration-context';

type AuditRow = Record<string, unknown>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const cursorPattern = /^[1-9][0-9]{0,18}$/;
const nullableString = (value: unknown) => typeof value === 'string' ? value : null;

function event(row: AuditRow) {
  return {
    id: String(row.sequence), sequence: String(row.sequence), libraryId: String(row.library_id),
    actorId: nullableString(row.actor_id), actorDisplayName: nullableString(row.actor_display_name),
    entityType: String(row.entity_type), entityId: String(row.entity_id),
    itemId: nullableString(row.item_id), versionId: nullableString(row.version_id), annotationId: nullableString(row.annotation_id),
    action: String(row.action), targetLabel: String(row.target_label),
    before: row.before ?? null, after: row.after ?? null, createdAt: String(row.created_at),
  };
}

/** The caller has verified the JWT; database RLS remains authoritative. */
export async function dispatch(request: Request, context: CloudIntegrationContext): Promise<Response | null> {
  const { segments, url, actor, db, error, json } = context;
  if (segments.length !== 4 || segments[0] !== 'v1' || segments[1] !== 'libraries' || segments[3] !== 'activity') return null;
  if (request.method !== 'GET') return error('METHOD_NOT_ALLOWED', 'Activity history is read-only', 405);
  const libraryId = segments[2];
  const cursor = url.searchParams.get('cursor');
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 30 : Number(rawLimit);
  if (!uuid.test(libraryId) || (cursor !== null && (!cursorPattern.test(cursor) || BigInt(cursor) > BigInt('9223372036854775807'))) || !Number.isInteger(limit) || limit < 1 || limit > 100) return error('INVALID_INPUT', 'Invalid library, activity cursor, or page limit', 400);
  const access = await db('library_members', undefined, { library_id: `eq.${libraryId}`, user_id: `eq.${actor.userId}`, status: 'eq.active', select: 'role' });
  if (!access.response.ok) return error('DATABASE_ERROR', 'Unable to verify library membership', access.response.status, access.response.status >= 500);
  if (!Array.isArray(access.body) || access.body.length === 0) return error('FORBIDDEN', 'Active library membership required', 403);
  const result = await db('cloud_audit_events', undefined, {
    library_id: `eq.${libraryId}`, select: 'sequence::text,library_id,actor_id,actor_display_name,entity_type,entity_id,item_id,version_id,annotation_id,action,target_label,before,after,created_at',
    order: 'sequence.desc', limit: limit + 1, ...(cursor ? { sequence: `lt.${cursor}` } : {}),
  });
  if (!result.response.ok || !Array.isArray(result.body)) return error('DATABASE_ERROR', 'Unable to load activity history', result.response.ok ? 502 : result.response.status, true);
  const rows = result.body as AuditRow[];
  const events = rows.slice(0, limit).map(event);
  const hasMore = rows.length > limit;
  return json({ events, nextCursor: hasMore ? events.at(-1)!.sequence : null, hasMore });
}
