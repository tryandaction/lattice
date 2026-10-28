"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, History, RefreshCw, Users, Sparkles, ListChecks } from "lucide-react";
import { toast } from "sonner";
import type { CloudFileTabState } from "@/types/layout";
import type { ViewerContent } from "@/types/viewer-content";
import { useI18n } from "@/hooks/use-i18n";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cloudDocumentHasDrafts, refreshCloudDocumentViews } from "@/lib/shared-library/cloud-document-actions";
import { can } from "@/lib/shared-library/permissions";
import { CloudVersionHistory } from "./cloud-version-history";
import { CloudAiButton } from "./cloud-ai-button";
import { cloudCollaborationCopy } from "./cloud-collaboration-copy";
import "./cloud-collaboration-toolbar.css";

const action = "inline-flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-50";

/** Collaboration stays beside the same editors used for local files. */
export function CloudCollaborationToolbar({ tab, content }: { tab: CloudFileTabState; content: ViewerContent }) {
  const { locale } = useI18n(); const copy = cloudCollaborationCopy(locale);
  const controller = useCloudWorkbenchStore(state => state.controller);
  const provider = useCloudWorkbenchStore(state => state.provider);
  const scope = useCloudWorkbenchStore(state => state.scope);
  const status = useCloudWorkbenchStore(state => state.status);
  const revision = useCloudWorkbenchStore(state => state.revision);
  const requestedHistory = useCloudWorkbenchStore(state => state.requestedVersionHistory);
  useContentCacheStore(state => state.cache);
  useWorkspaceStore(state => state.layout.root);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const restoreRequest = useRef<AbortController | null>(null);
  useEffect(() => { const current = restoreRequest; return () => current.current?.abort(); }, []);
  const { libraryId, itemId, resourceId, versionId } = tab.cloud;
  const connected = Boolean(controller && scope === tab.cloud.scope);
  void revision;
  const snapshot = connected ? controller!.getSnapshot() : undefined;
  const revoked = snapshot?.revoked.includes(libraryId) ?? false;
  const matchingHistory = connected && !revoked && requestedHistory?.scope === tab.cloud.scope && requestedHistory.libraryId === libraryId && requestedHistory.itemId === itemId ? requestedHistory : null;
  const historyOpen = history || matchingHistory !== null;
  function closeHistory() { setHistory(false); if (matchingHistory) useCloudWorkbenchStore.getState().clearVersionHistoryRequest(matchingHistory.id); }
  const role = snapshot?.roles[libraryId]?.role ?? "viewer";
  const operations = snapshot?.outbox.filter(entry => entry.libraryId === libraryId && entry.itemId === itemId) ?? [];
  const item = snapshot?.items.find(entry => entry.libraryId === libraryId && entry.id === itemId);
  const hasDrafts = cloudDocumentHasDrafts(tab);
  const newer = Boolean(item?.currentVersionId && item.currentVersionId !== versionId && !operations.length);
  const blocked = hasDrafts ? copy.dirty : operations.length ? copy.syncFirst : undefined;
  const label = !connected || revoked ? copy.disconnected : operations.some(entry => entry.state === "conflicted") ? copy.conflict
    : operations.some(entry => entry.state === "failed" || entry.state === "paused") ? copy.failed
    : status?.status === "offline" ? copy.offline : operations.length ? copy.pending : status?.error ? copy.failed : copy.synced;
  const guard = useCallback(() => {
    const current = useCloudWorkbenchStore.getState();
    if (!controller || current.controller !== controller || current.scope !== tab.cloud.scope || controller.getSnapshot().revoked.includes(libraryId)) throw new Error(copy.disconnected);
  }, [controller, tab.cloud.scope, libraryId, copy.disconnected]);
  const loadVersions = useCallback(async (signal?: AbortSignal) => { guard(); return controller!.listVersions(libraryId, itemId, signal); }, [guard, controller, libraryId, itemId]);
  const readVersion = useCallback(async (id: string, signal?: AbortSignal) => { guard(); return controller!.readVersion(libraryId, itemId, id, signal); }, [guard, controller, libraryId, itemId]);
  useEffect(() => {
    if (historyOpen && connected && controller && !revoked) void controller.members(libraryId).catch(() => {});
  }, [historyOpen, connected, controller, libraryId, revoked]);
  async function run(task: () => Promise<void>) {
    if (busy) return; setBusy(true);
    try { await task(); } catch (cause) { toast.error(cause instanceof Error ? cause.message : copy.error); }
    finally { setBusy(false); }
  }
  async function share() {
    guard();
    await useCloudWorkbenchStore.getState().selectLibrary(libraryId);
    guard();
    if (useCloudWorkbenchStore.getState().libraryId !== libraryId) return;
    useCloudWorkbenchStore.getState().setManagementOpen(true, "members");
  }
  async function manage(section: 'ai' | 'activity') {
    guard(); await useCloudWorkbenchStore.getState().selectLibrary(libraryId); guard();
    const state = useCloudWorkbenchStore.getState();
    if (state.libraryId !== libraryId) return;
    if (section === 'ai' && content.kind === 'text') state.setTeamAiSource({ name: tab.fileName, text: content.text, versionId });
    else if (section === 'ai' && provider) {
      const { captureTeamAiSource } = await import('@/lib/shared-library/cloud-team-ai-source');
      const captured = await captureTeamAiSource({ provider, libraryId, itemId, expectedVersionId: versionId, isCurrent: () => useCloudWorkbenchStore.getState().controller === controller && useCloudWorkbenchStore.getState().scope === tab.cloud.scope && useCloudWorkbenchStore.getState().libraryId === libraryId });
      guard(); if (useCloudWorkbenchStore.getState().libraryId !== libraryId) return;
      state.setTeamAiSource(captured);
    } else state.setTeamAiSource(undefined);
    state.setManagementOpen(true, section);
  }
  async function restore(id: string) {
    guard(); if (cloudDocumentHasDrafts(tab)) throw new Error(copy.dirty);
    if (!versionId) throw new Error(copy.syncFirst);
    const pending = new AbortController(); restoreRequest.current = pending;
    const stopForDraft = () => { if (cloudDocumentHasDrafts(tab)) pending.abort(new Error(copy.dirty)); };
    const stopForIdentity = () => {
      const current = useCloudWorkbenchStore.getState();
      if (current.controller !== controller || current.scope !== tab.cloud.scope) pending.abort(new Error(copy.disconnected));
    };
    const unsubscribers = [useContentCacheStore.subscribe(stopForDraft), useWorkspaceStore.subscribe(stopForDraft), useCloudWorkbenchStore.subscribe(stopForIdentity)];
    try { await controller!.restoreVersion(libraryId, itemId, id, versionId, pending.signal); }
    finally { unsubscribers.forEach(unsubscribe => unsubscribe()); if (restoreRequest.current === pending) restoreRequest.current = null; }
    guard(); refreshCloudDocumentViews(tab);
    void controller!.sync(); toast.success(copy.restored);
  }
  return <>
    <div className="lattice-cloud-toolbar flex min-h-9 shrink-0 flex-wrap items-center gap-x-1 gap-y-1 border-b border-border bg-muted/15 px-2 py-1" data-testid="cloud-collaboration-toolbar">
      <Cloud className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <button type="button" className={`${action} min-w-0 max-w-[50%] text-muted-foreground`} title={copy.manage} onClick={() => useCloudWorkbenchStore.getState().setManagementOpen(true)}><span className="truncate">{label}</span></button>
      {!can(role, "item.update") && connected ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{copy.readOnly}</span> : null}
      <span className="flex-1" />
      {newer ? <button type="button" className={`${action} text-primary`} title={blocked ?? copy.remote} disabled={Boolean(blocked) || busy || !connected || revoked} onClick={() => void run(async () => { guard(); if (cloudDocumentHasDrafts(tab)) throw new Error(copy.dirty); refreshCloudDocumentViews(tab); })}><RefreshCw className="size-3.5" />{copy.reload}</button> : null}
      <button type="button" className={action} aria-label={copy.share} title={copy.share} disabled={!connected || revoked || busy} onClick={() => void run(share)}><Users className="size-3.5" /><span className="lattice-cloud-action-label">{copy.share}</span></button>
      {provider && connected && !revoked ? <CloudAiButton provider={provider} expectedScope={tab.cloud.scope} selection={{ libraryId, itemId, kind: "file" }} sourceName={tab.fileName} className={action} /> : null}
      <button type="button" className={action} aria-label={locale === 'en-US' ? 'Team AI' : '团队 AI'} disabled={!connected || revoked || busy} onClick={() => void run(() => manage('ai'))}><Sparkles className="size-3.5" /><span className="lattice-cloud-action-label">{locale === 'en-US' ? 'Team AI' : '团队 AI'}</span></button>
      <button type="button" className={action} aria-label={locale === 'en-US' ? 'Activity history' : '协作记录'} disabled={!connected || revoked || busy} onClick={() => void run(() => manage('activity'))}><ListChecks className="size-3.5" /><span className="lattice-cloud-action-label">{locale === 'en-US' ? 'Activity' : '协作记录'}</span></button>
      <button type="button" className={action} aria-label={copy.history} title={copy.history} disabled={!connected || revoked} aria-expanded={historyOpen} onClick={() => { if (historyOpen) closeHistory(); else setHistory(true); }}><History className="size-3.5" /><span className="lattice-cloud-action-label">{copy.history}</span></button>
    </div>
    {historyOpen && connected && !revoked ? <CloudVersionHistory key={`${scope}:${resourceId}:${matchingHistory?.id ?? 'manual'}`} fileName={tab.fileName} currentVersionId={versionId} initialVersionId={matchingHistory?.versionId}
      currentText={content.kind === "text" ? content.text : undefined} authorNames={snapshot?.memberNames?.[libraryId]}
      canRestore={can(role, "item.update")} restoreBlockedReason={blocked} loadVersions={loadVersions} readVersion={readVersion} onRestore={restore} onClose={closeHistory} /> : null}
  </>;
}
