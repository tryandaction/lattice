"use client";

import { useI18n } from "@/hooks/use-i18n";
import type { TranslationKey } from "@/lib/i18n";

import { useState } from "react";
import type { CloudLibraryConnection } from "@/lib/shared-library/connection";
import { parseCloudConnectionInput, resolveCloudConnection, validateCloudConnection } from "@/lib/shared-library/connection";
import { Button } from "@/components/ui/button";

const field = "min-w-0 rounded border border-border bg-background px-2 py-1.5 text-sm";
const emptyDraft = (): CloudLibraryConnection => ({ id: "", name: "", apiUrl: "", supabaseUrl: "", publicKey: "", maxFileBytes: 100 * 1024 * 1024 });

export function CloudConnectionPanel({ connections, activeId, managedConnectionId, onSelect, onSave, onLogin, onLogout, onRegister, onResendConfirmation, confirmation, userId, onInvitation }: {
  onInvitation?: (inviteToken: string, libraryId: string, connectionId: string) => void;
  connections: CloudLibraryConnection[]; activeId?: string; userId?: string;
  managedConnectionId?: string;
  onSelect: (id: string) => void; onSave: (connection: CloudLibraryConnection) => Promise<void>;
  onLogin: (email: string, password: string) => Promise<void>; onLogout: () => Promise<void>;
  onRegister?: (email: string, password: string) => Promise<{ confirmationRequired: boolean } | void>;
  onResendConfirmation?: (email: string) => Promise<void>;
  confirmation?: { tone: "pending" | "success" | "error"; message: string };
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState<CloudLibraryConnection>(emptyDraft);
  const [pasted, setPasted] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invalidInput, setInvalidInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [notice, setNotice] = useState<TranslationKey | "">("");
  const [confirmationNeeded, setConfirmationNeeded] = useState(false);
  const selected = connections.find(connection => connection.id === activeId);
  const managedSelected = Boolean(selected && selected.id === managedConnectionId);
  const showAdvancedForm = advanced || editing;

  async function execute(action: () => Promise<void>) {
    setBusy(true); setError(null); setInvalidInput(false);
    try { await action(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      if ((cause as { code?: string })?.code === "email_not_confirmed") setConfirmationNeeded(true);
    } finally { setBusy(false); }
  }

  
  function beginEdit() { if (selected) { setDraft(selected); setEditing(true); setAdvanced(true); } }
  async function parseAndSave() {
    const parsed = parseCloudConnectionInput(pasted);
    if (!parsed) { setInvalidInput(true); return; }
    const connection = resolveCloudConnection(parsed, connections);
    await onSave(connection);
    if (parsed.inviteToken && parsed.libraryId) onInvitation?.(parsed.inviteToken, parsed.libraryId, connection.id);
    setPasted(""); setJoining(false);
  }

  return <div className="shrink-0 border-b border-border p-3" data-testid="cloud-connection-panel">
    {confirmation && !notice ? <p role={confirmation.tone === "error" ? "alert" : "status"} className={`mb-2 text-xs ${confirmation.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>{confirmation.message}</p> : null}
    <div className="flex flex-wrap items-center gap-2">
      {managedSelected ? <span className="text-sm font-medium">{selected!.name}</span> : <label className="flex items-center gap-2 text-xs">{t("cloud.connection.label")}<select aria-label={t("cloud.connection.selectLabel")} className={field} value={activeId ?? ""} onChange={event => onSelect(event.target.value)} disabled={busy}>
        <option value="">{t("cloud.connection.select")}</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
      </select></label>}
      <Button size="sm" variant="outline" onClick={() => { setJoining(true); setPasted(""); setAdvanced(false); setEditing(false); }}>{t("cloud.connection.joinOther")}</Button>
      {selected && !managedSelected ? <Button size="sm" variant="ghost" onClick={beginEdit}>{t("cloud.connection.settings")}</Button> : null}
      {userId ? <><span className="min-w-0 truncate text-xs text-muted-foreground" title={userId}>{t("cloud.connection.connected")}</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => void execute(onLogout)}>{t("cloud.connection.logout")}</Button></> : <span className="text-xs text-muted-foreground">{managedSelected ? t("cloud.connection.signInHint") : t("cloud.connection.inviteSignInHint")}</span>}
    </div>

    {((!userId && !managedSelected) || joining) && !showAdvancedForm ? <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <label className="min-w-0 flex-1 text-xs"><span className="sr-only">{t("cloud.connection.inviteInput")}</span><textarea aria-label={t("cloud.connection.inviteInput")} value={pasted} onChange={event => setPasted(event.target.value)} placeholder={t("cloud.connection.invitePlaceholder")} rows={2} className={`${field} w-full resize-y`} /></label>
      <Button size="sm" className="self-end sm:self-start" disabled={busy || !pasted.trim()} onClick={() => void execute(parseAndSave)}>{busy ? t("cloud.connection.connecting") : t("cloud.connection.connect")}</Button>
    </div> : null}

    {activeId && !userId && !showAdvancedForm ? <form className="mt-2 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setNotice(""); void execute(async () => {
      if (registering && onRegister) {
        const result = await onRegister(email, password);
        setConfirmationNeeded(result?.confirmationRequired !== false);
        setRegistering(false); setNotice(result?.confirmationRequired === false ? "cloud.connection.createdNotice" : "cloud.connection.confirmationNotice");
      } else await onLogin(email, password);
      setPassword("");
    }); }}>
      <input aria-label={t("cloud.connection.email")} className={field} type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} placeholder={t("cloud.connection.emailPlaceholder")} required />
      <input aria-label={t("cloud.connection.password")} className={field} type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 8 : undefined} value={password} onChange={event => setPassword(event.target.value)} placeholder={registering ? t("cloud.connection.newPasswordPlaceholder") : t("cloud.connection.passwordPlaceholder")} required />
      <Button type="submit" size="sm" disabled={busy}>{busy ? t("cloud.connection.processing") : registering ? t("cloud.connection.signup") : t("cloud.connection.login")}</Button>
      {onRegister ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setRegistering(value => !value); setError(null); setInvalidInput(false); setNotice(""); setPassword(""); }}>{registering ? t("cloud.connection.backToLogin") : t("cloud.connection.createAccount")}</Button> : null}
      {onResendConfirmation && !registering && (confirmationNeeded || confirmation?.tone === "error") ? <Button type="button" variant="ghost" size="sm" disabled={busy || !email.trim()} onClick={() => void execute(async () => { await onResendConfirmation(email.trim()); setNotice("cloud.connection.resendNotice"); setPassword(""); })}>{t("cloud.connection.resend")}</Button> : null}
    </form> : null}
    {notice && !userId ? <p role="status" className="mt-2 text-xs text-muted-foreground">{t(notice)}</p> : null}

    <button type="button" className="mt-2 text-xs text-muted-foreground underline-offset-4 hover:underline" aria-expanded={showAdvancedForm} onClick={() => { if (managedSelected) setDraft(emptyDraft()); setAdvanced(value => !value); }}>{managedSelected ? t("cloud.connection.selfHosted") : t("cloud.connection.advanced")}</button>
    {showAdvancedForm ? <form className="mt-3 grid gap-2 rounded border border-border/70 bg-muted/10 p-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void execute(async () => { await onSave(validateCloudConnection({ ...draft, id: draft.id || crypto.randomUUID() })); setEditing(false); setAdvanced(false); }); }}>
      <label className="grid gap-1 text-xs">{t("cloud.connection.name")}<input className={field} aria-label={t("cloud.connection.name")} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required /></label>
      <label className="grid gap-1 text-xs">{t("cloud.connection.workerUrl")}<input className={field} aria-label={t("cloud.connection.workerUrl")} value={draft.apiUrl} onChange={event => setDraft({ ...draft, apiUrl: event.target.value })} type="url" required /></label>
      <label className="grid gap-1 text-xs">{t("cloud.connection.projectUrl")}<input className={field} aria-label={t("cloud.connection.projectUrl")} value={draft.supabaseUrl} onChange={event => setDraft({ ...draft, supabaseUrl: event.target.value })} type="url" required /></label>
      <label className="grid gap-1 text-xs">{t("cloud.connection.publicKey")}<input className={field} aria-label={t("cloud.connection.publicKeyLabel")} value={draft.publicKey} onChange={event => setDraft({ ...draft, publicKey: event.target.value })} required /></label>
      <label className="grid gap-1 text-xs">{t("cloud.connection.maxSize")}<input className={field} aria-label={t("cloud.connection.maxSizeLabel")} type="number" min="1" max="100" value={draft.maxFileBytes / 1024 / 1024} onChange={event => setDraft({ ...draft, maxFileBytes: Number(event.target.value) * 1024 * 1024 })} /></label>
      <div className="flex items-end justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setAdvanced(false); }}>{t("common.cancel")}</Button><Button size="sm" type="submit" disabled={busy}>{t("cloud.connection.save")}</Button></div>
      <p className="text-xs text-muted-foreground sm:col-span-2">{t("cloud.connection.setupHint")}</p>
    </form> : null}
    {invalidInput || error ? <p role="alert" className="mt-2 text-xs text-destructive">{invalidInput ? t("cloud.connection.invalidInput") : error}</p> : null}
  </div>;
}
