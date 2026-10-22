/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { indexCommentsByAnnotation, SharedAnnotationPanel } from "../shared-annotation-panel";
import type { Annotation } from "@/lib/shared-library/domain";
import type { AnnotationComment } from "@/lib/shared-library/domain";

beforeEach(() => setLocale("en-US"));
afterEach(() => { cleanup(); setLocale("zh-CN"); });

const annotation: Annotation = {
  id: "ann-1",
  itemId: "item-1",
  versionId: "ver-1",
  authorId: "user-1",
  kind: "comment",
  target: { locatorType: "pdf-page", locator: { page: 2 } },
  style: {},
  body: { text: "Check this result" },
  status: "active",
  revision: 1,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

describe("SharedAnnotationPanel", () => {
  it("shows member nicknames and labels the imported local author separately", () => {
    setLocale("zh-CN");
    render(<SharedAnnotationPanel annotations={[{ ...annotation, body: { ...annotation.body, authorDisplayName: "创建时昵称", importedFromLocal: { author: "本地作者" } } }]} authorNames={{ "user-1": "当前昵称" }} />);
    expect(screen.getByText("当前昵称")).toBeTruthy();
    expect(screen.getByText("本地导入 · 原作者：本地作者")).toBeTruthy();
  });
  it("indexes comments by annotation in one pass", () => {
    const comments: AnnotationComment[] = [
      { id: "comment-1", annotationId: "ann-1", parentId: undefined, authorId: "user-1", body: "first", createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" },
      { id: "comment-2", annotationId: "ann-2", parentId: undefined, authorId: "user-2", body: "second", createdAt: "2026-08-30T00:00:01.000Z", updatedAt: "2026-08-30T00:00:01.000Z" },
      { id: "comment-3", annotationId: "ann-1", parentId: "comment-1", authorId: "user-2", body: "reply", createdAt: "2026-08-30T00:00:02.000Z", updatedAt: "2026-08-30T00:00:02.000Z" },
    ];

    const indexed = indexCommentsByAnnotation(comments);

    expect(indexed.get("ann-1")).toEqual([comments[0], comments[2]]);
    expect(indexed.get("ann-2")).toEqual([comments[1]]);
    expect(indexed.has("ann-3")).toBe(false);
  });

  it("creates a page note and replies to an annotation", async () => {
    const onCreatePageNote = vi.fn(async () => undefined);
    const onCreateComment = vi.fn(async () => undefined);
    render(<SharedAnnotationPanel annotations={[annotation]} onCreatePageNote={onCreatePageNote} onCreateComment={onCreateComment} />);

    fireEvent.change(screen.getByLabelText("Annotation note"), { target: { value: "Page note" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(onCreatePageNote).toHaveBeenCalledWith(1, "Page note"));

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByLabelText("Reply to annotation ann-1"), { target: { value: "I agree" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(onCreateComment).toHaveBeenCalledWith("ann-1", undefined, "I agree"));
  });
});
