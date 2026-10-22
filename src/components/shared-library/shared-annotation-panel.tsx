"use client";

import { useI18n } from "@/hooks/use-i18n";
import { useMemo, useState } from "react";
import { MessageSquarePlus, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Annotation } from "@/lib/shared-library/domain";
import type { AnnotationComment } from "@/lib/shared-library/domain";
import { buildCommentThreads } from "@/lib/shared-library/comment-thread";

export function indexCommentsByAnnotation(
  comments: readonly AnnotationComment[],
): Map<string, AnnotationComment[]> {
  const indexed = new Map<string, AnnotationComment[]>();
  for (const comment of comments) {
    if (!comment.annotationId) continue;
    const bucket = indexed.get(comment.annotationId);
    if (bucket) {
      bucket.push(comment);
    } else {
      indexed.set(comment.annotationId, [comment]);
    }
  }
  return indexed;
}

export interface SharedAnnotationPanelProps {
  annotations: readonly Annotation[];
  comments?: readonly AnnotationComment[];
  authorNames?: Readonly<Record<string, string>>;
  onCreatePageNote?: (page: number, body: string) => Promise<void>;
  onCreateComment?: (annotationId: string, parentId: string | undefined, body: string) => Promise<void>;
}

export function SharedAnnotationPanel({ annotations, comments = [], authorNames = {}, onCreatePageNote, onCreateComment }: SharedAnnotationPanelProps) {
  const { t } = useI18n();
  const [page, setPage] = useState("1");
  const [body, setBody] = useState("");
  const [replyAnnotationId, setReplyAnnotationId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<{ message: string } | { key: "cloud.annotation.saveCommentFailed" | "cloud.annotation.saveNoteFailed" } | null>(null);
  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.status !== "deleted"),
    [annotations],
  );
  const commentsByAnnotation = useMemo(
    () => indexCommentsByAnnotation(comments),
    [comments],
  );

  async function submitReply(annotationId: string) {
    const text = replyBody.trim();
    if (!text || !onCreateComment) return;
    setIsSaving(true);
    setError(null);
    try {
      await onCreateComment(annotationId, undefined, text);
      setReplyBody("");
      setReplyAnnotationId(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? { message: saveError.message } : { key: "cloud.annotation.saveCommentFailed" });
    } finally {
      setIsSaving(false);
    }
  }

  async function submit() {
    const pageNumber = Number(page);
    const text = body.trim();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || !text || !onCreatePageNote) return;
    setIsSaving(true);
    setError(null);
    try {
      await onCreatePageNote(pageNumber, text);
      setBody("");
    } catch (saveError) {
      setError(saveError instanceof Error ? { message: saveError.message } : { key: "cloud.annotation.saveNoteFailed" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div data-testid="shared-annotation-panel" aria-label={t("cloud.annotation.title")} className="flex h-full min-h-0 flex-col border-l border-border bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-sm font-semibold"><StickyNote className="h-4 w-4 text-muted-foreground" />{t("cloud.annotation.title")}</header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {visibleAnnotations.length === 0 ? <div className="mb-3 text-xs text-muted-foreground">{t("cloud.annotation.empty")}</div> : (
          <ol className="grid gap-2">
            {visibleAnnotations.map((annotation) => (
              <li key={annotation.id} className="rounded-md border border-border bg-muted/15 p-2 text-xs">
                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>{t("cloud.annotation.page")} {String(annotation.target.locator.page ?? "?")}</span><span title={annotation.authorId}>{authorNames[annotation.authorId] ?? (typeof annotation.body.authorDisplayName === "string" ? annotation.body.authorDisplayName : annotation.authorId)}</span></div>
                {annotation.body.importedFromLocal && typeof annotation.body.importedFromLocal === "object" && typeof (annotation.body.importedFromLocal as { author?: unknown }).author === "string" ? <p className="mt-1 text-[10px] text-muted-foreground">{t("cloud.annotation.imported", { author: (annotation.body.importedFromLocal as { author: string }).author })}</p> : null}
                <p className="mt-1 whitespace-pre-wrap text-foreground">{typeof annotation.body.text === "string" ? annotation.body.text : typeof annotation.quote?.exact === "string" ? annotation.quote.exact : t("cloud.annotation.fallback")}</p>
                {buildCommentThreads((commentsByAnnotation.get(annotation.id) ?? []).filter((comment) => !comment.deletedAt)).map((thread) => (
                  <div key={thread.root.id} className="mt-2 border-l-2 border-border pl-2 text-[11px] text-muted-foreground">
                    <p className="text-[10px]">{authorNames[thread.root.authorId] ?? thread.root.authorId}</p><p className="whitespace-pre-wrap text-foreground">{thread.root.body}</p>
                    {thread.replies.map((reply) => <p key={reply.id} className="mt-1 whitespace-pre-wrap">{reply.body}</p>)}
                  </div>
                ))}
                {onCreateComment ? <div className="mt-2">
                  {replyAnnotationId === annotation.id ? <div className="grid gap-1">
                    <textarea aria-label={t("cloud.annotation.replyLabel", { id: annotation.id })} value={replyBody} onChange={(event) => setReplyBody(event.target.value)} className="min-h-12 resize-y rounded border border-border bg-background px-2 py-1 text-xs" placeholder={t("cloud.annotation.replyPlaceholder")} />
                    <div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="sm" onClick={() => { setReplyAnnotationId(null); setReplyBody(""); }}>{t("common.cancel")}</Button><Button type="button" size="sm" disabled={isSaving || !replyBody.trim()} onClick={() => void submitReply(annotation.id)}>{isSaving ? t("cloud.annotation.saving") : t("cloud.annotation.reply")}</Button></div>
                  </div> : <Button type="button" variant="ghost" size="sm" onClick={() => { setReplyAnnotationId(annotation.id); setError(null); }}>{t("cloud.annotation.reply")}</Button>}
                </div> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
      {onCreatePageNote ? <div className="shrink-0 border-t border-border p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium"><MessageSquarePlus className="h-3.5 w-3.5" />{t("cloud.annotation.addPage")}</div>
        <div className="grid gap-2">
          <label className="grid gap-1 text-[11px] text-muted-foreground">{t("cloud.annotation.page")}<input aria-label={t("cloud.annotation.pageLabel")} inputMode="numeric" value={page} onChange={(event) => setPage(event.target.value)} className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground" /></label>
          <label className="grid gap-1 text-[11px] text-muted-foreground">{t("cloud.annotation.note")}<textarea aria-label={t("cloud.annotation.noteLabel")} value={body} onChange={(event) => setBody(event.target.value)} className="min-h-16 resize-y rounded border border-border bg-background px-2 py-1 text-sm text-foreground" placeholder={t("cloud.annotation.placeholder")} /></label>
          {error ? <div role="alert" className="text-xs text-destructive">{"message" in error ? error.message : t(error.key)}</div> : null}
          <Button type="button" size="sm" disabled={isSaving || !body.trim()} onClick={() => void submit()}>{isSaving ? t("cloud.annotation.saving") : t("cloud.annotation.add")}</Button>
        </div>
      </div> : null}
    </div>
  );
}
