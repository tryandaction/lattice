"use client";

import { useEffect, useId, useRef } from "react";
import { CheckCircle2, Clock3, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import { cn } from "@/lib/utils";
import { UI_MODAL_OVERLAY_CLASS, UI_MODAL_OVERLAY_STYLE, UI_MODAL_PANEL_CLASS } from "@/lib/ui-layers";
import type { CloudImportState } from "@/lib/shared-library/cloud-import-batch";
import type { TranslationKey } from "@/lib/i18n";
import { CloudUploadAction } from "./cloud-upload-action";

export interface CloudUploadDialogProps {
  open: boolean;
  onClose: () => void;
  onFiles: (files: File[]) => void;
  pendingFiles?: File[];
  preparationLabel?: string;
  preparationError?: string;
  onPrepareRetry?: () => void;
}
const statusKey: Record<CloudImportState, TranslationKey> = {
  pending: "cloud.upload.state.pending", reading: "cloud.upload.state.reading", queued: "cloud.upload.state.queued", synced: "cloud.upload.state.synced",
  failed: "cloud.upload.state.failed", cancelled: "cloud.upload.state.cancelled", paused: "cloud.upload.state.paused", conflicted: "cloud.upload.state.conflicted",
};

export function CloudUploadDialog({ open, onClose, onFiles, pendingFiles = [], preparationLabel, preparationError, onPrepareRetry }: CloudUploadDialogProps) {
  const { t, formatFileSize } = useI18n();
  const cloud = useCloudWorkbenchStore();
  const panel = useRef<HTMLElement>(null); const close = useRef<HTMLButtonElement>(null); const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [open]);
  if (!open) return null;
  const preparing = pendingFiles.length > 0;
  const entries = preparing ? [] : cloud.uploadEntries;
  const canRetry = entries.some(entry => ["failed", "cancelled", "paused"].includes(entry.state) || (entry.state === "queued" && Boolean(entry.error)));
  const canCancel = cloud.uploading || entries.some(entry => entry.state === "queued");
  const libraryName = cloud.libraries.find(library => library.id === cloud.libraryId)?.name;
  return <div className={cn(UI_MODAL_OVERLAY_CLASS, "flex items-center justify-center p-4")} style={UI_MODAL_OVERLAY_STYLE}>
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn(UI_MODAL_PANEL_CLASS, "flex max-h-[85vh] w-full max-w-xl flex-col rounded-lg")}
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
        if (event.key !== "Tab") return;
        const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]') ?? []);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div><h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold"><Upload className="size-4" />{t("cloud.upload.title")}</h2>{libraryName ? <p className="mt-1 text-xs text-muted-foreground">{libraryName}</p> : null}</div>
        <Button ref={close} size="icon" variant="ghost" aria-label={t("cloud.upload.close")} onClick={onClose}><X className="size-4" /></Button>
      </header>
      <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
        <p className="text-xs leading-5 text-muted-foreground">{t("cloud.upload.queueHint")}</p>
        <CloudUploadAction disabled={cloud.uploading || preparing} onFiles={onFiles} />
        {preparing ? <div className="space-y-2"><p role="status" className="text-xs text-muted-foreground">{preparationLabel || t("cloud.upload.preparing")}</p>
          <ul className="divide-y divide-border rounded-lg border border-border">{pendingFiles.map((file, index) => <li key={`${index}-${file.name}`} className="flex items-center justify-between gap-3 px-3 py-2 text-xs"><span className="min-w-0 break-all">{file.webkitRelativePath || file.name}</span><span className="shrink-0 text-muted-foreground">{t("cloud.upload.notUploaded")}</span></li>)}</ul>
          <p className="text-xs text-muted-foreground">{t("cloud.upload.pendingHint")}</p>
        </div> : entries.length ? <ul className="divide-y divide-border rounded-lg border border-border" aria-label={t("cloud.upload.fileList")}>
          {entries.map(entry => <li key={entry.id} className="space-y-1 px-3 py-3 text-xs">
            <div className="flex items-start gap-2">
              {entry.state === "synced" ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : entry.state === "reading" ? <Loader2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : <Clock3 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 break-all font-medium">{entry.path}</span><span className="shrink-0 text-muted-foreground">{formatFileSize(entry.file.size)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 pl-5"><span className={entry.state === "failed" || entry.state === "conflicted" ? "text-destructive" : "text-muted-foreground"}>{t(statusKey[entry.state])}</span>
              {["failed", "cancelled", "paused"].includes(entry.state) || (entry.state === "queued" && Boolean(entry.error)) ? <button type="button" className="shrink-0 underline disabled:opacity-50" disabled={cloud.uploading} aria-label={t("cloud.upload.retryFile", { path: entry.path })} onClick={() => void cloud.retryUpload(entry.id).catch(() => {})}>{t("cloud.upload.retry")}</button> : null}
            </div>
            {entry.error ? <p className="break-words pl-5 text-destructive">{entry.error}</p> : null}
          </li>)}
        </ul> : <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">{t("cloud.upload.empty")}</p>}
        {preparationError || cloud.error ? <p role="alert" className="break-words text-xs text-destructive">{preparationError || cloud.error}</p> : null}
        {preparationError && onPrepareRetry ? <Button size="sm" variant="outline" onClick={onPrepareRetry}>{t("cloud.upload.retry")}</Button> : null}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
        {canCancel && !preparing ? <Button size="sm" variant="ghost" onClick={cloud.cancelUpload}>{t("cloud.upload.cancelRemaining")}</Button> : null}
        {canRetry && !preparing ? <Button size="sm" variant="outline" disabled={cloud.uploading} onClick={() => void cloud.retryUpload().catch(() => {})}>{t("cloud.upload.retryFailed")}</Button> : null}
        <Button size="sm" variant="outline" onClick={onClose}>{t("cloud.upload.background")}</Button>
      </footer>
    </section>
  </div>;
}
