import { describe, expect, it } from "vitest";
import { buildCommentThreads } from "../comment-thread";
import type { AnnotationComment } from "../domain";

function comment(id: string, createdAt: string, parentId?: string): AnnotationComment {
  return {
    id,
    authorId: "user-1",
    body: `body ${id}`,
    createdAt,
    ...(parentId ? { parentId } : {}),
  };
}

describe("comment threads", () => {
  it("builds one thread per root comment", () => {
    const threads = buildCommentThreads([
      comment("c1", "2026-08-20T00:00:00.000Z"),
      comment("c2", "2026-08-20T00:01:00.000Z"),
    ]);
    expect(threads.map((thread) => thread.root.id)).toEqual(["c1", "c2"]);
    expect(threads.every((thread) => thread.replies.length === 0)).toBe(true);
  });

  it("orders threads by root creation time ascending", () => {
    const threads = buildCommentThreads([
      comment("late", "2026-08-20T00:05:00.000Z"),
      comment("early", "2026-08-20T00:00:00.000Z"),
    ]);
    expect(threads.map((thread) => thread.root.id)).toEqual(["early", "late"]);
  });

  it("nests replies under their parent comment in creation order", () => {
    const threads = buildCommentThreads([
      comment("root", "2026-08-20T00:00:00.000Z"),
      comment("r2", "2026-08-20T00:02:00.000Z", "root"),
      comment("r1", "2026-08-20T00:01:00.000Z", "root"),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.id).toBe("root");
    expect(threads[0].replies.map((entry) => entry.id)).toEqual(["r1", "r2"]);
  });

  it("treats comments anchored only to the annotation as roots", () => {
    const threads = buildCommentThreads([
      comment("c1", "2026-08-20T00:00:00.000Z", "annotation-1"),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.id).toBe("c1");
  });

  it("promotes detached replies whose parent comment is missing to their own thread", () => {
    const threads = buildCommentThreads([
      comment("root", "2026-08-20T00:00:00.000Z"),
      comment("orphan", "2026-08-20T00:01:00.000Z", "missing-parent"),
    ]);
    expect(threads.map((thread) => thread.root.id)).toEqual(["root", "orphan"]);
  });
});
