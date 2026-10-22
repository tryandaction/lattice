"use client";

import { useI18n } from "@/hooks/use-i18n";

import { Cloud, FolderOpen, RefreshCw, Settings2 } from "lucide-react";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";

/** Small source controls above the existing Explorer; file actions live there. */
export function CloudExplorerControls() {
  const { t } = useI18n();
  const cloud = useCloudWorkbenchStore();
  const status = cloud.status;
  const roleLabel = cloud.role ? t(`cloud.role.${cloud.role}`) : "";
  const statusText = status?.error ? t("cloud.sync.error") : status?.status === "offline" ? t("cloud.sync.offline") : status?.pending ? t("cloud.sync.pending", { count: status.pending }) : status ? t("cloud.sync.synced") : t("cloud.sync.disconnected");
  const button = "flex h-7 items-center justify-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground";
  return <div className="space-y-1.5 border-b border-border px-2 py-2" data-testid="explorer-source-controls">
    <div className="flex items-center gap-1"><button type="button" className={`${button} ${!cloud.active ? "bg-accent text-foreground" : ""}`} aria-pressed={!cloud.active} onClick={() => cloud.setActive(false)}><FolderOpen className="size-3.5" />{t("cloud.local")}</button><button type="button" className={`${button} ${cloud.active ? "bg-accent text-foreground" : ""}`} aria-pressed={cloud.active} onClick={() => { cloud.setActive(true); if (!cloud.controller) cloud.setManagementOpen(true); }}><Cloud className="size-3.5" />{t("workbench.activity.library")}</button>{cloud.active ? <><span className="flex-1" /><button type="button" className={button} aria-label={t("cloud.refresh")} disabled={!cloud.controller || cloud.loading} onClick={() => void cloud.refresh().catch(() => {})}><RefreshCw className="size-3.5" /></button><button type="button" className={button} aria-label={t("cloud.manage.title")} onClick={() => cloud.setManagementOpen(true)}><Settings2 className="size-3.5" /></button></> : null}</div>
    {cloud.active ? <><select aria-label={t("cloud.library")} className="h-7 w-full min-w-0 rounded border border-border bg-background px-1.5 text-xs" value={cloud.libraryId} onChange={event => void cloud.selectLibrary(event.target.value).catch(() => {})} disabled={!cloud.controller}><option value="">{cloud.controller ? t("cloud.selectLibrary") : t("cloud.connectLibrary")}</option>{cloud.libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}</select><div className="flex min-w-0 items-center justify-between text-[10px] text-muted-foreground" data-testid="cloud-sync-status"><span>{statusText}{roleLabel ? ` · ${roleLabel}` : ""}</span>{cloud.uploading ? <button type="button" onClick={cloud.cancelUpload}>{t("cloud.upload.pause")}</button> : null}</div>{cloud.uploadProgress ? <p className="truncate text-[10px] text-muted-foreground">{cloud.uploadProgress}</p> : null}</> : null}
  </div>;
}
