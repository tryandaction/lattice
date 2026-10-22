"use client";

import { useI18n } from "@/hooks/use-i18n";
import { useRef } from "react";
import { collectCloudDropFiles } from "@/lib/shared-library/cloud-drop-import";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CloudUploadProgress {
  label: string;
  failed?: number;
  onRetry?: () => void;
}

export function CloudUploadToolbar({ disabled, onFiles, progress, onError }: {
  disabled: boolean;
  onError?: (error: unknown) => void;
  onFiles: (files: File[]) => void;
  progress: CloudUploadProgress | null;
}) {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const acceptFiles = (list: FileList | null) => { if (disabled) return; const files = Array.from(list ?? []); if (files.length) onFiles(files); };
  return <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-2 text-xs" data-testid="cloud-upload-toolbar"
    onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
    onDrop={event => { event.preventDefault(); if (disabled) return; void collectCloudDropFiles(event.dataTransfer).then(files => { if (files.length) onFiles(files); }).catch(error => onError?.(error)); }}>
    <Button size="sm" variant="outline" disabled={disabled} onClick={() => fileInput.current?.click()}><Upload className="size-3" />{t("explorer.action.upload")}</Button>
    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => folderInput.current?.click()}>{t("cloud.upload.uploadFolder")}</Button>
    <span className="text-muted-foreground">{t("cloud.upload.dropHint")}</span>
    <input ref={fileInput} aria-label={t("cloud.upload.selectFiles")} type="file" multiple className="sr-only" disabled={disabled} onChange={event => { acceptFiles(event.target.files); event.target.value = ""; }} />
    <input ref={folderInput} aria-label={t("cloud.upload.selectFolder")} type="file" multiple {...{ webkitdirectory: "" }} className="sr-only" disabled={disabled} onChange={event => { acceptFiles(event.target.files); event.target.value = ""; }} />
    {progress ? <span role="status" className={progress.failed ? "text-destructive" : "text-muted-foreground"}>{progress.label}{progress.failed && progress.onRetry ? <button type="button" className="ml-2 underline" onClick={progress.onRetry}>{t("cloud.upload.retryFailed")}</button> : null}</span> : null}
  </div>;
}
