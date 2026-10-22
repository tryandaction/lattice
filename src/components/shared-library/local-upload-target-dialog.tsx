"use client";

import { useI18n } from "@/hooks/use-i18n";

import { useEffect, useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import type { Item } from "@/lib/shared-library/domain";
import { can } from "@/lib/shared-library/permissions";
import { cn } from "@/lib/utils";
import { UI_MODAL_OVERLAY_CLASS, UI_MODAL_OVERLAY_STYLE, UI_MODAL_PANEL_CLASS } from "@/lib/ui-layers";

export function LocalUploadTargetDialog() {
  const { t } = useI18n();
  const cloud = useCloudWorkbenchStore();
  const [libraryId, setLibraryId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [folders, setFolders] = useState<Item[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (cloud.pendingLocalUpload) { setLibraryId(cloud.libraryId || cloud.libraries[0]?.id || ""); setFolderId(""); }
  }, [cloud.pendingLocalUpload]);
  useEffect(() => {
    const controller = cloud.controller; if (!controller || !libraryId || !cloud.pendingLocalUpload) return;
    let cancelled = false; setLoading(true); setAllowed(false);
    void controller.refreshLibrary(libraryId).then(() => {
      if (cancelled || useCloudWorkbenchStore.getState().controller !== controller) return;
      const snapshot = controller.getSnapshot(); setFolders(snapshot.items.filter(item => item.libraryId === libraryId && item.kind === "folder" && item.status === "active"));
      const role = snapshot.roles[libraryId]?.role; setAllowed(Boolean(role && can(role, "item.create")));
    }).catch(error => { if (!cancelled) cloud.setError(error); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cloud.controller, libraryId, cloud.pendingLocalUpload]);
  if (!cloud.pendingLocalUpload || cloud.managementOpen || !cloud.controller) return null;
  function folderLabel(item: Item) {
    const path = [item.title]; const seen = new Set([item.id]); let parent = item.metadata.parentItemId;
    while (typeof parent === "string" && !seen.has(parent)) { seen.add(parent); const folder = folders.find(value => value.id === parent); if (!folder) break; path.unshift(folder.title); parent = folder.metadata.parentItemId; }
    return path.join(" / ");
  }
  return <div className={cn(UI_MODAL_OVERLAY_CLASS, "flex items-center justify-center p-4")} style={UI_MODAL_OVERLAY_STYLE}>
    <section role="dialog" aria-modal="true" aria-label={t("cloud.upload.title")} className={cn(UI_MODAL_PANEL_CLASS, "w-full max-w-md rounded-lg")}>
      <header className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-medium"><Upload className="size-4" />{t("cloud.upload.title")}</h2><Button size="sm" variant="ghost" aria-label={t("cloud.upload.close")} disabled={cloud.uploading} onClick={cloud.dismissLocalUpload}><X className="size-4" /></Button></header>
      <div className="space-y-3 p-4 text-xs">
        <p className="break-all font-medium">{cloud.pendingLocalUpload.path}</p><p className="text-muted-foreground">{t(cloud.pendingLocalUpload.kind === "directory" ? "cloud.upload.directoryHint" : "cloud.upload.fileHint")}</p>
        <label className="grid gap-1">{t("cloud.library")}<select aria-label={t("cloud.upload.library")} className="h-8 rounded border border-border bg-background px-2" value={libraryId} disabled={cloud.uploading} onChange={event => { setLibraryId(event.target.value); setFolderId(""); }}><option value="">{t("cloud.selectLibrary")}</option>{cloud.libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
        <label className="grid gap-1">{t("cloud.upload.folder")}<select aria-label={t("cloud.upload.folderLabel")} className="h-8 rounded border border-border bg-background px-2" value={folderId} disabled={cloud.uploading || loading} onChange={event => setFolderId(event.target.value)}><option value="">{t("cloud.upload.root")}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folderLabel(folder)}</option>)}</select></label>
        {!loading && libraryId && !allowed ? <p className="text-destructive">{t("cloud.upload.denied")}</p> : null}
        {cloud.error ? <p role="alert" className="text-destructive">{cloud.error}</p> : null}
        {cloud.uploadProgress ? <p role="status" className="text-muted-foreground">{cloud.uploadProgress}</p> : null}
        {cloud.localUploadWarnings.length ? <ul className="max-h-32 list-disc overflow-auto pl-4 text-amber-600">{cloud.localUploadWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
        <div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={cloud.uploading} onClick={cloud.dismissLocalUpload}>{t("common.cancel")}</Button>{cloud.localUploadWarnings.length ? <Button size="sm" onClick={cloud.dismissLocalUpload}>{t("common.finish")}</Button> : <Button size="sm" disabled={!libraryId || !allowed || loading || cloud.uploading} onClick={() => void cloud.uploadLocalEntry(libraryId, folderId || undefined).catch(() => {})}>{cloud.uploading ? t("cloud.upload.uploading") : t("cloud.upload.submit")}</Button>}</div>
      </div>
    </section>
  </div>;
}
