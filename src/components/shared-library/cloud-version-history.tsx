"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, RotateCcw, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import type { ItemVersion } from "@/lib/shared-library/domain";
import type { SharedLibraryItemContent } from "@/lib/shared-library/content-store";
import { computeDiff } from "@/lib/ai/diff-utils";
import { cloudCollaborationCopy } from "./cloud-collaboration-copy";

export interface CloudVersionHistoryProps {
  fileName: string;
  currentVersionId?: string;
  initialVersionId?: string;
  currentText?: string;
  authorNames?: Record<string, string>;
  canRestore: boolean;
  restoreBlockedReason?: string;
  loadVersions: (signal?: AbortSignal) => Promise<ItemVersion[]>;
  readVersion: (versionId: string, signal?: AbortSignal) => Promise<SharedLibraryItemContent>;
  onRestore: (versionId: string) => Promise<void>;
  onClose: () => void;
}
const PREVIEW_LIMIT = 100_000;
const action = "inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50 disabled:pointer-events-none";

/** Historical reads never change an open editor; restoring is an explicit new write. */
export function CloudVersionHistory({ fileName, currentVersionId, initialVersionId, currentText, authorNames, canRestore, restoreBlockedReason, loadVersions, readVersion, onRestore, onClose }: CloudVersionHistoryProps) {
  const { locale, formatDate } = useI18n();
  const copy = cloudCollaborationCopy(locale);
  const [versions, setVersions] = useState<ItemVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<ItemVersion>();
  const [preview, setPreview] = useState<SharedLibraryItemContent>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [compare, setCompare] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const autoSelected = useRef<string | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const current = abort; return () => current.current?.abort(); }, []);
  const diff = useMemo(() => compare && preview?.kind === "text" && currentText !== undefined
    ? computeDiff(preview.text.slice(0, PREVIEW_LIMIT), currentText.slice(0, PREVIEW_LIMIT)) : null, [compare, preview, currentText]);

  const select = useCallback((version: ItemVersion) => {
    abort.current?.abort(); const pending = new AbortController(); abort.current = pending;
    const sequence = ++request.current;
    setSelected(version); setPreview(undefined); setPreviewLoading(true); setError(null); setConfirm(false); setCompare(false);
    void readVersion(version.id, pending.signal).then(content => { if (sequence === request.current && !pending.signal.aborted) setPreview(content); })
      .catch(cause => { if (sequence === request.current && !pending.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (sequence === request.current && !pending.signal.aborted) setPreviewLoading(false); });
  }, [readVersion]);
  useEffect(() => {
    const pending = new AbortController();
    void loadVersions(pending.signal).then(result => {
      if (pending.signal.aborted) return;
      setVersions([...result].sort((a, b) => b.versionNumber - a.versionNumber));
      if (initialVersionId && autoSelected.current !== initialVersionId) {
        const target = result.find(version => version.id === initialVersionId);
        if (target) { autoSelected.current = initialVersionId; select(target); }
        else setError(locale === 'en-US' ? 'The requested historical version is unavailable.' : '请求的历史版本已不可用，请选择其他版本。');
      }
    }).catch(cause => { if (!pending.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!pending.signal.aborted) setLoading(false); });
    return () => pending.abort();
  }, [loadVersions, refresh, initialVersionId, select, locale]);
  function download() {
    if (!preview || !selected) return;
    const url = URL.createObjectURL(new Blob([preview.kind === "binary" ? preview.data : preview.text], { type: preview.mimeType }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName.replace(/(\.[^.]+)?$/, `-v${selected.versionNumber}$1`); anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function restore() {
    if (!selected || !canRestore || restoreBlockedReason || restoring) return;
    setRestoring(true); setError(null);
    try { await onRestore(selected.id); if (mounted.current) { setConfirm(false); setRefresh(value => value + 1); } }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current) setRestoring(false); }
  }
  return <aside aria-label={copy.history} className="absolute inset-y-0 right-0 z-30 flex w-full max-w-xl flex-col border-l border-border bg-background shadow-xl" data-testid="cloud-version-history">
    <header className="flex shrink-0 items-center gap-2 border-b border-border p-3">
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{copy.history} · {fileName}</h2>
      <button type="button" className={action} aria-label={copy.refresh} onClick={() => { setLoading(true); setError(null); setRefresh(value => value + 1); }} disabled={loading || restoring}><RefreshCw className="size-3.5" /></button>
      <button type="button" className={action} aria-label={copy.close} onClick={onClose}><X className="size-3.5" /></button>
    </header>
    {error ? <p role="alert" className="border-b border-border px-3 py-2 text-xs text-destructive">{error}</p> : null}
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {loading ? <p role="status" className="text-xs text-muted-foreground">{copy.loading}</p> : versions.length === 0 ? <p className="text-xs text-muted-foreground">{copy.empty}</p> : null}
      <ol className="space-y-1" aria-label={copy.history}>
        {versions.map(version => <li key={version.id}>
          <button type="button" disabled={restoring} aria-pressed={selected?.id === version.id} className={`flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded border px-2 py-2 text-left text-xs hover:bg-accent ${selected?.id === version.id ? "border-primary bg-accent" : "border-border"}`} onClick={() => select(version)}>
            <span className="font-medium">v{version.versionNumber}</span>
            <span>{authorNames?.[version.createdBy] ?? version.createdBy ?? copy.unknownAuthor}</span>
            <time className="text-muted-foreground" dateTime={version.createdAt}>{formatDate(version.createdAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
            {typeof version.manifest.restoredFromVersionId === "string" ? <span className="text-muted-foreground">{copy.restoredFrom} v{versions.find(candidate => candidate.id === version.manifest.restoredFromVersionId)?.versionNumber ?? "…"}</span> : null}
            {version.id === currentVersionId ? <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{copy.current}</span> : null}
          </button>
        </li>)}
      </ol>
      <section className="mt-4 space-y-2" aria-label={copy.preview}>
        {!selected ? <p className="text-xs text-muted-foreground">{copy.choose}</p> : <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">v{selected.versionNumber}</span>
            {preview?.kind === "text" && currentText !== undefined ? <button type="button" className={action} aria-pressed={compare} onClick={() => setCompare(value => !value)}>{compare ? copy.original : copy.compare}</button> : null}
            <button type="button" className={action} disabled={!preview} onClick={download}><Download className="size-3.5" />{copy.download}</button>
          </div>
          {previewLoading ? <p role="status" className="text-xs text-muted-foreground">{copy.loading}</p> : null}
          {preview?.kind === "text" ? diff ? <div data-testid="cloud-history-diff" className="overflow-auto rounded border border-border text-xs">
            <p className="sticky left-0 border-b border-border bg-muted p-2">{copy.compareHint} · +{diff.additions} / -{diff.deletions}</p>
            <pre className="p-2">{diff.lines.slice(0, 2000).map((line, index) => <div key={index} className={line.type === "added" ? "bg-green-500/10 text-green-700 dark:text-green-300" : line.type === "removed" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "text-muted-foreground"}>{line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "}{line.content || " "}</div>)}</pre>
          </div> : <pre className="overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/20 p-3 text-xs">{preview.text.slice(0, PREVIEW_LIMIT)}</pre> : preview ? <p className="rounded border border-border p-3 text-xs text-muted-foreground">{copy.binary}</p> : null}
          {preview?.kind === "text" && (preview.text.length > PREVIEW_LIMIT || compare && (currentText?.length ?? 0) > PREVIEW_LIMIT || (diff?.lines.length ?? 0) > 2000) ? <p className="text-xs text-muted-foreground">{copy.truncated}</p> : null}
          {selected.id !== currentVersionId ? canRestore ? <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">{restoreBlockedReason ?? copy.restoreHint}</p>
            {confirm ? <div className="flex flex-wrap gap-2"><button type="button" className={action} disabled={Boolean(restoreBlockedReason) || restoring} onClick={() => void restore()}>{restoring ? copy.restoring : copy.confirm}</button><button type="button" className={action} disabled={restoring} onClick={() => setConfirm(false)}>{copy.cancel}</button></div>
              : <button type="button" className={action} disabled={!preview || Boolean(restoreBlockedReason) || restoring} onClick={() => setConfirm(true)}><RotateCcw className="size-3.5" />{copy.restore}</button>}
          </div> : <p className="text-xs text-muted-foreground">{copy.readonlyHistory}</p> : null}
        </>}
      </section>
    </div>
  </aside>;
}
