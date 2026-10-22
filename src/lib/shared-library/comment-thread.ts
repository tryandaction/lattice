/**
 * Comment threads.
 *
 * Comments belong to an annotation; a comment whose `parentId` matches
 * another comment's id is a reply nested under that comment. A comment whose
 * `parentId` does not match any comment (including annotation-level anchors)
 * is a thread root. Threads and replies are ordered by creation time; detached
 * replies are promoted rather than dropped so the UI never loses a comment.
 */

import type { AnnotationComment } from "./domain";

export interface CommentThread {
  root: AnnotationComment;
  replies: AnnotationComment[];
}

function compareByCreatedAt(a: AnnotationComment, b: AnnotationComment): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

export function buildCommentThreads(
  comments: readonly AnnotationComment[],
): CommentThread[] {
  const byId = new Map<string, AnnotationComment>();
  for (const comment of comments) {
    byId.set(comment.id, comment);
  }

  const roots: AnnotationComment[] = [];
  const replies: AnnotationComment[] = [];
  for (const comment of comments) {
    const isReply =
      comment.parentId !== undefined &&
      comment.parentId !== comment.id &&
      byId.has(comment.parentId);
    if (isReply) {
      replies.push(comment);
    } else {
      roots.push(comment);
    }
  }

  roots.sort(compareByCreatedAt);
  replies.sort(compareByCreatedAt);

  const threads = new Map<string, CommentThread>();
  for (const root of roots) {
    threads.set(root.id, { root, replies: [] });
  }
  for (const reply of replies) {
    const thread = threads.get(reply.parentId!);
    if (thread) {
      thread.replies.push(reply);
    } else {
      threads.set(reply.id, { root: reply, replies: [] });
    }
  }

  return [...threads.values()];
}

export function totalCommentCount(threads: readonly CommentThread[]): number {
  return threads.reduce((sum, thread) => sum + 1 + thread.replies.length, 0);
}
