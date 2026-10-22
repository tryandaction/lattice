"use client";

import { useI18n } from "@/hooks/use-i18n";
import { t as translate, type TranslationKey } from "@/lib/i18n";

import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Users, X, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CloudConnectionPanel } from "./cloud-connection-panel";
import { MemberManagement } from "./member-management";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { CloudLibraryConnection } from "@/lib/shared-library/connection";
import { cloudScope, validateCloudConnection, parseCloudConnectionInput, resolveCloudConnection } from "@/lib/shared-library/connection";
import { createCloudInviteShare, retainCloudInvitation, type PendingCloudInvitation } from "@/lib/shared-library/cloud-simple-flow";
import { CloudAuthSession, SupabaseAuthRepository, createCloudSessionStore } from "@/lib/shared-library/supabase-auth";
import { CloudLibraryWorkspaceController } from "@/lib/shared-library/cloud-workspace";
import { createCloudPersistence } from "@/lib/shared-library/cloud-persistence";
import { ApiTransport } from "@/lib/shared-library/api-transport";
import { SharedLibraryError } from "@/lib/shared-library/errors";
import type { LibraryMember } from "@/lib/shared-library/domain";
import { can } from "@/lib/shared-library/permissions";
import { registerCloudWorkspaceNavigator, setCloudWorkspaceActive, setCloudWorkspaceResource } from "@/lib/cloud-workspace-host";
import { UI_MODAL_OVERLAY_CLASS, UI_MODAL_OVERLAY_STYLE, UI_MODAL_PANEL_CLASS } from "@/lib/ui-layers";
import { cn } from "@/lib/utils";
import { LocalUploadTargetDialog } from "./local-upload-target-dialog";
import { cloudStartupConnections, getManagedCloudConnection } from "@/lib/shared-library/managed-service";
import { findEmailCallbackConnection, readCloudEmailCallback, type EmailConfirmationTokens } from "@/lib/shared-library/email-confirmation";
import { parseSharedLibraryPath } from "@/lib/shared-library/cloud-navigation";

const CONFIG_KEY = "lattice-cloud-connections-v1";
const INVITE_KEY = "lattice-cloud-pending-invite-v1";
const LIBRARY_KEY = "lattice-cloud-active-library-v1";
const ACTIVE_KEY = "lattice-cloud-active-connection-v1";
const field = "min-w-0 rounded border border-border bg-background px-2 py-1 text-sm";

/** Authentication/sync lifetime belongs to AppLayout, never an explorer or pane. */
export function CloudLibraryControllerHost() {
  const { t } = useI18n();
  const [connections, setConnections] = useState<CloudLibraryConnection[]>([]);
  const [activeId, setActiveId] = useState("");
  const [managedConnectionId, setManagedConnectionId] = useState<string | undefined>();
  const [members, setMembers] = useState<LibraryMember[] | null>(null);
  const [invitations, setInvitations] = useState<Awaited<ReturnType<CloudLibraryWorkspaceController["invitations"]>>>([]);
  const [inviteUrl, setInviteUrl] = useState("");
  const [pendingInvite, setPendingInvite] = useState<PendingCloudInvitation | null>(null);
  const [inviteState, setInviteState] = useState<"pending" | "joining" | "failed">("pending");
  const [newLibraryName, setNewLibraryName] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [emailConfirmation, setEmailConfirmation] = useState<{ tone: "pending" | "success" | "error"; messageKey: TranslationKey }>();
  const pendingEmailConfirmation = useRef<{ connectionId: string; tokens: EmailConfirmationTokens } | null>(null);
  const cloud = useCloudWorkbenchStore();
  const { controller, provider, libraryId, managementOpen, error, role, status } = cloud;
  const authRef = useRef<CloudAuthSession | null>(null);
  const controllerRef = useRef<CloudLibraryWorkspaceController | null>(null);
  const epochRef = useRef(0);
  const inviteAttempt = useRef("");
  const joiningInvite = useRef(false);
  const initialOpen = useRef("");
  const activeTab = useWorkspaceStore(state => state.getActiveTab?.());
  const activeCloudVersion = activeTab?.kind === "cloud-file" ? activeTab.cloud.versionId : undefined;

  async function run(task: () => Promise<unknown>) {
    useCloudWorkbenchStore.getState().setError(null);
    try { await task(); } catch (cause) { useCloudWorkbenchStore.getState().setError(cause); }
  }
  function closeIdentity() {
    ++epochRef.current; controllerRef.current?.dispose(); controllerRef.current = null;
    useCloudWorkbenchStore.getState().bindController(null);
    setMembers(null); setInvitations([]); setInviteUrl(""); joiningInvite.current = false;
    setCloudWorkspaceResource(null);
  }
  async function bind(connection: CloudLibraryConnection, auth: CloudAuthSession, userId: string, epoch: number) {
    const next = new CloudLibraryWorkspaceController(connection, userId, createCloudPersistence(cloudScope(connection, userId)), new ApiTransport({ baseUrl: connection.apiUrl, getAccessToken: async () => {
      let session;
      try { session = await auth.load(); } catch (cause) {
        if ([400, 401, 403].includes((cause as { status?: number }).status ?? 0) && controllerRef.current?.userId === userId) closeIdentity();
        throw cause;
      }
      if (!session || session.userId !== userId) {
        if (controllerRef.current?.userId === userId) closeIdentity();
        throw new SharedLibraryError({ code: "UNAUTHORIZED", message: translate("cloud.auth.expired"), status: 401 });
      }
      return session.accessToken;
    } }));
    await next.initialize();
    if (epoch !== epochRef.current) { next.dispose(); return; }
    await next.refreshLibraries();
    if (epoch !== epochRef.current) { next.dispose(); return; }
    controllerRef.current = next; useCloudWorkbenchStore.getState().bindController(next);
    const libraries = next.getSnapshot().libraries;
    const requested = new URL(window.location.href).searchParams.get("library");
    const saved = localStorage.getItem(`${LIBRARY_KEY}:${connection.id}:${userId}`);
    const selected = libraries.find(library => library.id === requested)?.id ?? libraries.find(library => library.id === saved)?.id ?? (libraries.length === 1 ? libraries[0].id : "");
    if (selected) await useCloudWorkbenchStore.getState().selectLibrary(selected);
    next.start();
  }
  function savePendingInvite(token: string, targetLibraryId: string, connectionId: string) {
    const invite = retainCloudInvitation({ token, libraryId: targetLibraryId, connectionId }, JSON.parse(localStorage.getItem(INVITE_KEY) ?? "null") as PendingCloudInvitation | null);
    localStorage.setItem(INVITE_KEY, JSON.stringify(invite)); setPendingInvite(invite); setInviteState("pending"); inviteAttempt.current = "";
    useCloudWorkbenchStore.getState().setManagementOpen(true);
  }
  useEffect(() => {
    // Read and scrub credentials before parsing invites or doing any asynchronous work.
    const returned = readCloudEmailCallback(window.location.href);
    if (returned.callback) {
      history.replaceState(history.state, "", returned.cleanUrl);
      useCloudWorkbenchStore.getState().setActive(true);
      useCloudWorkbenchStore.getState().setManagementOpen(true);
      setEmailConfirmation(returned.callback.kind === "error" ? { tone: "error", messageKey: returned.callback.messageKey } : { tone: "pending", messageKey: "cloud.email.pending" });
    }
    try {
      const saved = (JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "[]") as CloudLibraryConnection[]).map(validateCloudConnection);
      const managed = getManagedCloudConnection();
      setManagedConnectionId(managed?.id);
      const startup = cloudStartupConnections(saved, managed, localStorage.getItem(ACTIVE_KEY));
      const stored = startup.connections;
      const parsed = parseCloudConnectionInput(returned.cleanUrl);
      const savedInvite = JSON.parse(localStorage.getItem(INVITE_KEY) ?? "null") as PendingCloudInvitation | null;
      if (parsed) {
        const connection = resolveCloudConnection(parsed, stored); const next = [...stored.filter(value => value.id !== connection.id), connection];
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next)); localStorage.setItem(ACTIVE_KEY, connection.id);
        setConnections(next); setActiveId(connection.id); useCloudWorkbenchStore.getState().setActive(true);
        if (parsed.inviteToken && parsed.libraryId) savePendingInvite(parsed.inviteToken, parsed.libraryId, connection.id);
      } else {
        setConnections(stored); setActiveId(startup.activeId);
        if (savedInvite?.token && savedInvite.libraryId && savedInvite.connectionId) setPendingInvite(savedInvite);
      }
      if (returned.callback?.kind === "session") {
        const target = findEmailCallbackConnection(returned.callback, stored);
        if (target) {
          pendingEmailConfirmation.current = { connectionId: target.id, tokens: returned.callback };
          localStorage.setItem(ACTIVE_KEY, target.id); setActiveId(target.id);
        } else setEmailConfirmation({ tone: "error", messageKey: "cloud.email.unknownService" });
      }
    } catch (cause) {
      if (returned.callback) setEmailConfirmation({ tone: "error", messageKey: "cloud.email.loadFailed" });
      useCloudWorkbenchStore.getState().setError(cause);
    }
    return () => { ++epochRef.current; controllerRef.current?.dispose(); controllerRef.current = null; useCloudWorkbenchStore.getState().bindController(null); };
  }, []);
  useEffect(() => {
    if (!activeId) return;
    closeIdentity(); const epoch = epochRef.current; const connection = connections.find(value => value.id === activeId); if (!connection) return;
    let deviceId = localStorage.getItem("lattice-cloud-device-v1");
    if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem("lattice-cloud-device-v1", deviceId); }
    const key = `cloud-session:${JSON.stringify([connection.id, connection.apiUrl, connection.supabaseUrl])}`;
    const auth = new CloudAuthSession(createCloudSessionStore(key), new SupabaseAuthRepository(connection), deviceId); authRef.current = auth;
    void run(async () => {
      let session;
      const pending = pendingEmailConfirmation.current;
      if (pending?.connectionId === connection.id) {
        pendingEmailConfirmation.current = null;
        try {
          session = await auth.confirmEmail(pending.tokens);
          if (epoch !== epochRef.current) return;
          setEmailConfirmation({ tone: "success", messageKey: "cloud.email.confirmed" });
        } catch {
          if (epoch !== epochRef.current) return;
          setEmailConfirmation({ tone: "error", messageKey: "cloud.email.restoreFailed" });
          // A failed email return never signs out an existing working account.
          session = await auth.load();
        }
      } else session = await auth.load();
      if (session && epoch === epochRef.current) await bind(connection, auth, session.userId, epoch);
    });
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== key) return; auth.invalidate();
      if (event.newValue) { try { if ((JSON.parse(event.newValue) as { userId?: string }).userId === controllerRef.current?.userId) return; } catch { /* Invalid sessions close the previous identity. */ } }
      closeIdentity(); useCloudWorkbenchStore.getState().setError(translate("cloud.auth.changed"));
    };
    window.addEventListener("storage", storageChanged);
    return () => { auth.invalidate(); window.removeEventListener("storage", storageChanged); };
    // A connection change always starts a new authenticated controller scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, connections]);
  useEffect(() => {
    if (!controller || !libraryId) return;
    localStorage.setItem(`${LIBRARY_KEY}:${controller.connection.id}:${controller.userId}`, libraryId);
    setNickname(controller.getSnapshot().memberNames?.[libraryId]?.[controller.userId] ?? "");
  }, [controller, libraryId]);
  useEffect(() => registerCloudWorkspaceNavigator(({ libraryId: targetLibrary, itemId, anchor }) => useCloudWorkbenchStore.getState().openItem(itemId, { libraryId: targetLibrary, anchor })), []);
  useEffect(() => {
    const isCloud = activeTab?.kind === "cloud-file";
    setCloudWorkspaceActive(isCloud);
    if (!isCloud || !controller || !provider || activeTab.cloud.scope !== cloud.scope) { setCloudWorkspaceResource(null); return; }
    let cancelled = false;
    void provider.read(activeTab.cloud.libraryId, activeTab.cloud.itemId).then(resource => { if (!cancelled && useCloudWorkbenchStore.getState().controller === controller) setCloudWorkspaceResource(resource); }).catch(() => { if (!cancelled) setCloudWorkspaceResource(null); });
    return () => { cancelled = true; };
  }, [activeTab?.id, activeTab?.kind, activeCloudVersion, controller, provider, cloud.scope]);
  useEffect(() => {
    if (!controller || !libraryId) return;
    const item = new URL(window.location.href).searchParams.get("item"); const key = `${cloud.scope}:${libraryId}:${item}`;
    if (item && initialOpen.current !== key) { initialOpen.current = key; void run(() => useCloudWorkbenchStore.getState().openItem(item)); }
  }, [controller, libraryId, cloud.scope]);
  async function acceptPendingInvite() {
    if (!controller || !pendingInvite || pendingInvite.connectionId !== controller.connection.id || joiningInvite.current) return;
    const identity = controller; joiningInvite.current = true; setInviteState("joining");
    try {
      if (pendingInvite.accepted && pendingInvite.acceptedUserId !== identity.userId) throw new Error(t("cloud.invite.otherAccount"));
      const result = pendingInvite.accepted ? { libraryId: pendingInvite.libraryId } : await identity.acceptInvite(pendingInvite.token);
      if (controllerRef.current !== identity) return;
      if (result.libraryId !== pendingInvite.libraryId) throw new Error(t("cloud.invite.mismatch"));
      localStorage.setItem(INVITE_KEY, JSON.stringify({ ...pendingInvite, accepted: true, acceptedUserId: identity.userId }));
      const url = new URL(window.location.href); url.hash = ""; url.searchParams.delete("invite"); history.replaceState(null, "", url);
      await identity.refreshLibraries(); if (controllerRef.current !== identity) return;
      await useCloudWorkbenchStore.getState().selectLibrary(result.libraryId); setPendingInvite(null); localStorage.removeItem(INVITE_KEY);
    } catch (cause) { if (controllerRef.current === identity) { setInviteState("failed"); useCloudWorkbenchStore.getState().setError(cause); } }
    finally { if (controllerRef.current === identity) joiningInvite.current = false; }
  }
  useEffect(() => {
    if (!controller || !pendingInvite || pendingInvite.connectionId !== controller.connection.id) return;
    const attempt = JSON.stringify([controller.connection.id, controller.userId, pendingInvite.token]); if (inviteAttempt.current === attempt) return;
    inviteAttempt.current = attempt; void acceptPendingInvite();
    // One attempt per identity/token; failed attempts require the retry button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, pendingInvite]);

  if (!managementOpen) return <LocalUploadTargetDialog />;
  const snapshot = controller?.getSnapshot();
  return <div className={cn(UI_MODAL_OVERLAY_CLASS, "flex items-center justify-center p-4")} style={UI_MODAL_OVERLAY_STYLE} onMouseDown={event => { if (event.target === event.currentTarget) cloud.setManagementOpen(false); }}>
    <section role="dialog" aria-modal="true" aria-label={t("cloud.manage.title")} className={cn(UI_MODAL_PANEL_CLASS, "flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg")}>
      <header className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-medium">{t("cloud.manage.title")}</h2><Button variant="ghost" size="sm" aria-label={t("cloud.manage.close")} onClick={() => cloud.setManagementOpen(false)}><X className="size-4" /></Button></header>
      <div className="min-h-0 overflow-auto">
        <CloudConnectionPanel connections={connections} activeId={activeId} managedConnectionId={managedConnectionId} userId={controller?.userId} onInvitation={savePendingInvite} confirmation={emailConfirmation ? { tone: emailConfirmation.tone, message: t(emailConfirmation.messageKey) } : undefined}
          onSelect={id => { closeIdentity(); localStorage.setItem(ACTIVE_KEY, id); setActiveId(id); }}
          onSave={async connection => { const next = [...connections.filter(value => value.id !== connection.id), connection]; localStorage.setItem(CONFIG_KEY, JSON.stringify(next)); localStorage.setItem(ACTIVE_KEY, connection.id); setConnections(next); setActiveId(connection.id); }}
          onLogin={async (email, password) => { const auth = authRef.current; const connection = connections.find(value => value.id === activeId); if (!auth || !connection) throw new Error(t("cloud.connection.configureFirst")); closeIdentity(); const epoch = epochRef.current; const session = await auth.signIn(email, password); await bind(connection, auth, session.userId, epoch); }}
          onRegister={async (email, password) => { const connection = connections.find(value => value.id === activeId); if (!connection) throw new Error(t("cloud.connection.connectFirst")); return new SupabaseAuthRepository(connection).signUp(email, password); }}
          onResendConfirmation={async email => { const connection = connections.find(value => value.id === activeId); if (!connection) throw new Error(t("cloud.connection.connectFirst")); await new SupabaseAuthRepository(connection).resendConfirmation(email); }}
          onLogout={async () => { closeIdentity(); await authRef.current?.signOut(); }} />
        {error || status?.error ? <p role="alert" className="px-4 py-2 text-xs text-destructive">{error ?? status?.error}</p> : null}
        {pendingInvite ? <div role="status" className="flex items-center gap-2 border-b border-border p-3 text-xs"><span>{!controller ? t("cloud.invite.signIn") : inviteState === "joining" ? t("cloud.invite.joining") : inviteState === "failed" ? t("cloud.invite.failed") : t("cloud.invite.ready")}</span>{controller && inviteState === "failed" ? <Button size="sm" onClick={() => void acceptPendingInvite()}>{t("cloud.invite.retry")}</Button> : null}</div> : null}
        {controller ? <>
          {libraryId ? <form className="flex items-center gap-2 border-b border-border px-3 py-2" onSubmit={event => { event.preventDefault(); void run(async () => { await controller.setDisplayName(libraryId, nickname); if (members) setMembers(await controller.members(libraryId)); }); }}><label htmlFor="cloud-nickname" className="shrink-0 text-xs">{t("cloud.nickname")}</label><input id="cloud-nickname" aria-label={t("cloud.nickname.label")} className={`${field} flex-1`} value={nickname} maxLength={60} onChange={event => setNickname(event.target.value)} placeholder={t("cloud.nickname.placeholder")} required /><Button size="sm" type="submit" disabled={!nickname.trim()}>{t("cloud.nickname.save")}</Button></form> : null}
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3"><select aria-label={t("cloud.library")} className={field} value={libraryId} onChange={event => { setMembers(null); void run(() => cloud.selectLibrary(event.target.value)); }}><option value="">{t("cloud.selectLibrary")}</option>{cloud.libraries.map(library => <option value={library.id} key={library.id}>{library.name}</option>)}</select><Button size="sm" variant="ghost" onClick={() => setNewLibraryName("")}><Plus className="size-3" />{t("cloud.createLibrary")}</Button><Button size="sm" variant="ghost" aria-label={t("cloud.refresh")} onClick={() => void run(cloud.refresh)}><RefreshCw className="size-3" /></Button>{libraryId ? <Button size="sm" variant="ghost" aria-label={t("cloud.members.label")} onClick={() => void run(async () => { if (members) setMembers(null); else { setMembers(await controller.members(libraryId)); if (role && can(role, "member.manage")) setInvitations(await controller.invitations(libraryId)); } })}><Users className="size-3" /></Button> : null}</div>
          {newLibraryName !== null ? <form className="flex gap-2 border-b border-border p-3" onSubmit={event => { event.preventDefault(); void run(async () => { const library = await controller.createLibrary(newLibraryName); await cloud.selectLibrary(library.id); setNewLibraryName(null); }); }}><input aria-label={t("cloud.newName")} className={`${field} flex-1`} required value={newLibraryName} onChange={event => setNewLibraryName(event.target.value)} placeholder={t("cloud.namePlaceholder")} /><Button size="sm" type="submit">{t("cloud.create")}</Button><Button size="sm" type="button" variant="ghost" onClick={() => setNewLibraryName(null)}>{t("common.cancel")}</Button></form> : null}
          {members && role ? <MemberManagement members={members} currentUserId={controller.userId} viewerRole={role} onInvite={(email, inviteRole) => void run(async () => { const result = await controller.invite(libraryId, email, inviteRole); setInviteUrl(createCloudInviteShare(new URL("/library", window.location.href).toString(), controller.connection, libraryId, result.token)); setInvitations(await controller.invitations(libraryId)); })} onChangeRole={(userId, nextRole) => void run(async () => { await controller.changeMember(libraryId, userId, nextRole); setMembers(await controller.members(libraryId)); })} invitations={invitations} onRevokeInvitation={id => void run(async () => { await controller.revokeInvitation(libraryId, id); setInvitations(await controller.invitations(libraryId)); setInviteUrl(""); })} onSuspend={userId => void run(async () => { await controller.suspendMember(libraryId, userId); setMembers(await controller.members(libraryId)); })} onRevoke={userId => void run(async () => { await controller.changeMember(libraryId, userId); setMembers(await controller.members(libraryId)); })} /> : null}
          {inviteUrl ? <div className="flex gap-2 p-3"><input aria-label={t("cloud.invite.link")} readOnly value={inviteUrl} className={`${field} flex-1`} /><Button size="sm" onClick={() => void run(() => navigator.clipboard.writeText(inviteUrl))}>{t("cloud.invite.copy")}</Button></div> : null}
          {snapshot?.outbox.length ? <details className="border-t border-border p-3 text-xs"><summary>{t("cloud.sync.tasks", { count: snapshot.outbox.length })}</summary>{snapshot.outbox.map(operation => <div key={operation.id} className="mt-2 flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{snapshot.items.find(item => item.id === operation.itemId)?.title} · {t(`cloud.sync.state.${operation.state}`)} {operation.error}</span>{operation.state === "pending" ? <Button size="sm" variant="ghost" aria-label={t("cloud.sync.pause")} onClick={() => void run(() => controller.pause(operation.id))}><Pause className="size-3" /></Button> : operation.state !== "conflicted" ? <Button size="sm" variant="ghost" aria-label={t("cloud.sync.retry")} onClick={() => void run(async () => { await controller.retry(operation.id); await controller.sync(); })}><Play className="size-3" /></Button> : ["remote", "local", "copy"].map((choice, index) => <Button key={choice} size="sm" variant="outline" onClick={() => void run(async () => { await controller.resolveConflict(operation.id, choice as "remote" | "local" | "copy"); await controller.sync(); })}>{[t("cloud.conflict.remote"), t("cloud.conflict.local"), t("cloud.conflict.copy")][index]}</Button>)}</div>)}</details> : null}
        </> : null}
      </div>
    </section>
  </div>;
}

/** Historical cloud links enter the same application shell and retain invite data. */
export function CloudLibraryWorkspace({ initialLibraryId, initialItemId }: { initialLibraryId?: string; initialItemId?: string }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    const path = parseSharedLibraryPath(url.pathname);
    const libraryId = initialLibraryId && initialLibraryId !== "__index__" ? initialLibraryId : path.libraryId;
    const itemId = initialItemId && initialItemId !== "__index__" ? initialItemId : path.itemId;
    url.pathname = "/";
    if (libraryId) url.searchParams.set("library", libraryId);
    if (itemId) url.searchParams.set("item", itemId);
    url.searchParams.set("source", "cloud"); window.location.replace(url);
  }, [initialLibraryId, initialItemId]);
  return null;
}
