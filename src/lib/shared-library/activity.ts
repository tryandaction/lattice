/**
 * Shared-library activity stream.
 *
 * Activity events are the audit-friendly surface for "what changed, by whom,
 * when" in a library. The feed is a pure, time-ordered projection — the panel
 * never mutates the underlying event list.
 */

import type { ActorId, IsoTimestamp } from "./domain";

export const ACTIVITY_VERBS = [
  "created",
  "updated",
  "annotated",
  "commented",
  "uploaded",
  "deleted",
  "restored",
  "invited",
  "role-changed",
  "resolved-conflict",
] as const;
export type ActivityVerb = (typeof ACTIVITY_VERBS)[number];

export interface ActivityEvent {
  id: string;
  libraryId: string;
  actorId: ActorId;
  verb: ActivityVerb;
  entityType: string;
  entityId: string;
  targetLabel: string;
  metadata?: Record<string, unknown>;
  createdAt: IsoTimestamp;
}

const VERB_LABELS: Record<ActivityVerb, string> = {
  created: "created",
  updated: "updated",
  annotated: "annotated",
  commented: "commented",
  uploaded: "uploaded",
  deleted: "deleted",
  restored: "restored",
  invited: "invited",
  "role-changed": "changed role",
  "resolved-conflict": "resolved a conflict",
};

export function buildActivityFeed(events: readonly ActivityEvent[]): ActivityEvent[] {
  return [...events].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function activityVerbLabel(verb: ActivityVerb): string {
  return VERB_LABELS[verb];
}

export function isActivityVerb(value: unknown): value is ActivityVerb {
  return typeof value === "string" && (ACTIVITY_VERBS as readonly string[]).includes(value);
}
