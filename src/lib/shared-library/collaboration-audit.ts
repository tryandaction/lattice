import type { SharedLibraryTransport } from './remote-repository';

export type CloudAuditEntityType = 'library' | 'collection' | 'item' | 'version' | 'annotation' | 'comment' | 'member';
export type CloudAuditAction = 'created' | 'updated' | 'deleted' | 'trashed' | 'restored' | 'role-changed' | 'status-changed';
export interface CloudAuditEvent {
  id: string;
  sequence: string;
  libraryId: string;
  actorId: string | null;
  actorDisplayName: string | null;
  entityType: CloudAuditEntityType;
  entityId: string;
  itemId: string | null;
  versionId: string | null;
  annotationId: string | null;
  action: CloudAuditAction;
  targetLabel: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}
export interface CloudAuditPage { events: CloudAuditEvent[]; nextCursor: string | null; hasMore: boolean }
export interface CloudAuditPageOptions { cursor?: string; limit?: number; signal?: AbortSignal }

export async function listCloudActivity(transport: SharedLibraryTransport, libraryId: string, options: CloudAuditPageOptions = {}): Promise<CloudAuditPage> {
  const response = await transport.request({ method: 'GET', path: `/v1/libraries/${encodeURIComponent(libraryId)}/activity`, query: { cursor: options.cursor, limit: options.limit }, ...(options.signal ? { signal: options.signal } : {}) });
  const body = response.body && typeof response.body === 'object' && 'data' in response.body ? response.body.data : response.body;
  if (!body || typeof body !== 'object' || !('events' in body) || !Array.isArray(body.events) || !('hasMore' in body) || typeof body.hasMore !== 'boolean' || !('nextCursor' in body) || (body.nextCursor !== null && typeof body.nextCursor !== 'string')) throw new Error('Invalid activity response');
  return body as CloudAuditPage;
}
