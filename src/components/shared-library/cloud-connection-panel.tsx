"use client";

import { useI18n } from "@/hooks/use-i18n";
import type { TranslationKey } from "@/lib/i18n";

import { useEffect, useRef, useState } from "react";
import type { CloudLibraryConnection } from "@/lib/shared-library/connection";
import { parseCloudConnectionInput, resolveCloudConnection, validateCloudConnection } from "@/lib/shared-library/connection";
import { Button } from "@/components/ui/button";

const field = "min-w-0 rounded border border-border bg-background px-2 py-1.5 text-sm";
const emptyDraft = (): CloudLibraryConnection => ({ id: "", name: "", apiUrl: "", supabaseUrl: "", publicKey: "", maxFileBytes: 100 * 1024 * 1024 });

export interface CloudConnectionPanelProps {
  onInvitation?: (inviteToken: string, libraryId: string, connectionId: string) => void;
  connections: CloudLibraryConnection[]; activeId?: string; userId?: string;
  managedConnectionId?: string;
  onSelect: (id: string) => void; onSave: (connection: CloudLibraryConnection) => Promise<void>;
  onLogin: (email: string, password: string) => Promise<void>; onLogout: () => Promise<void>;
  onRegister?: (email: string, password: string) => Promise<{ confirmationRequired: boolean; confirmationSent?: boolean } | void>;
  onResendConfirmation?: (email: string) => Promise<void>;
  onVerifyEmailCode?: (email: string, code: string) => Promise<void>;
  onRequestPasswordReset?: (email: string) => Promise<void>;
  onResetPassword?: (password: string) => Promise<void>;
  onCancelPasswordRecovery?: () => void;
  passwordRecovery?: boolean;
  serviceUnavailable?: boolean;
  onRetry?: () => void | Promise<void>;
  onContinueLocal?: () => void;
  confirmation?: { tone: "pending" | "success" | "error"; message: string };
  startWithJoin?: boolean;
}

export function CloudConnectionPanel(props: CloudConnectionPanelProps) {
  const selected = props.connections.find(connection => connection.id === props.activeId);
  const identity = JSON.stringify([selected?.id, selected?.apiUrl, selected?.supabaseUrl]);
  return <CloudConnectionPanelContent key={`${identity}:${String(Boolean(props.startWithJoin))}`} {...props} />;
}

function CloudConnectionPanelContent({ connections, activeId, managedConnectionId, onSelect, onSave, onLogin, onLogout, onRegister, onResendConfirmation, onVerifyEmailCode, onRequestPasswordReset, onResetPassword, onCancelPasswordRecovery, passwordRecovery, serviceUnavailable, onRetry, onContinueLocal, confirmation, userId, onInvitation, startWithJoin }: CloudConnectionPanelProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState<CloudLibraryConnection>(emptyDraft);
  const [pasted, setPasted] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatedPassword, setRepeatedPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invalidInput, setInvalidInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [joining, setJoining] = useState(Boolean(startWithJoin));
  const [registering, setRegistering] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [notice, setNotice] = useState<TranslationKey | "">("");
  const [confirmationState, setConfirmationState] = useState<"sent" | "unconfirmed" | "unknown" | null>(null);
  const selected = connections.find(connection => connection.id === activeId);
  const managedSelected = Boolean(selected && selected.id === managedConnectionId);
  const showAdvancedForm = advanced || editing;
  const unavailable = serviceUnavailable || !selected;
  const codeFlow = Boolean(onVerifyEmailCode);
  const registrationEmailSent = confirmationState === "sent";
  const confirmationTitle = registrationEmailSent ? "cloud.account.confirmationTitle" : confirmationState === "unknown" ? "cloud.account.confirmationUnknownTitle" : "cloud.account.confirmationNeededTitle";
  const confirmationHint = registrationEmailSent ? "cloud.account.confirmationHint" : confirmationState === "unknown" ? "cloud.account.confirmationUnknownHint" : codeFlow ? "cloud.account.confirmationNeededHint" : "cloud.account.confirmationLegacyHint";
  const showRegistrationConfirmation = confirmationState !== null && !userId && !passwordRecovery && !forgotPassword && !registering && Boolean(email.trim());
  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  function changeAccountMode(mode: "login" | "register" | "forgot") {
    setRegistering(mode === "register");
    setForgotPassword(mode === "forgot");
    setConfirmationState(null);
    setVerificationCode("");
    setError(null); setInvalidInput(false); setNotice(""); setPassword(""); setRepeatedPassword("");
  }

  async function execute(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(null); setInvalidInput(false);
    try { await action(); } catch (cause) {
      if ((cause as { code?: string })?.code === "email_not_confirmed") {
        setError(t(codeFlow ? "cloud.account.confirmationNeededNotice" : "cloud.account.confirmationLegacyNotice")); setConfirmationState("unconfirmed"); setPassword("");
      } else if ((cause as { code?: string })?.code === "email_verified_connection_failed") {
        setConfirmationState(null); setVerificationCode(""); setNotice(""); setPassword("");
        setError(t("cloud.otp.connectionFailed"));
      } else setError(cause instanceof Error ? cause.message : String(cause));
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function resend() {
    if (!onResendConfirmation || (codeFlow && resendSeconds > 0)) return;
    await execute(async () => {
      await onResendConfirmation(email.trim());
      if (codeFlow) { setVerificationCode(""); setResendSeconds(60); }
      setConfirmationState("unknown"); setNotice(codeFlow ? "cloud.otp.resent" : "cloud.connection.resendNotice"); setPassword("");
    });
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
      {selected ? managedSelected ? <span className="text-sm font-medium">{selected.name}</span> : <label className="flex items-center gap-2 text-xs">{t("cloud.connection.label")}<select aria-label={t("cloud.connection.selectLabel")} className={field} value={activeId ?? ""} onChange={event => onSelect(event.target.value)} disabled={busy}>
        <option value="">{t("cloud.connection.select")}</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
      </select></label> : <span className="text-sm font-medium">{t("cloud.account.title")}</span>}
      {userId ? <><span className="min-w-0 truncate text-xs text-muted-foreground" title={userId}>{t("cloud.connection.connected")}</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => void execute(onLogout)}>{t("cloud.connection.logout")}</Button></> : !unavailable && !passwordRecovery ? <span className="text-xs text-muted-foreground">{t("cloud.connection.signInHint")}</span> : null}
    </div>

    {unavailable && !passwordRecovery ? <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
      <p className="text-sm font-medium">{t("cloud.account.unavailable")}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("cloud.account.unavailableHint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onRetry ? <Button size="sm" disabled={busy} onClick={() => void execute(async () => { await onRetry(); })}>{busy ? t("cloud.connection.connecting") : t("cloud.account.retry")}</Button> : null}
        {onContinueLocal ? <Button size="sm" variant="outline" onClick={onContinueLocal}>{t("cloud.account.continueLocal")}</Button> : null}
      </div>
    </div> : null}

    {joining && !showAdvancedForm ? <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <label className="min-w-0 flex-1 text-xs"><span className="sr-only">{t("cloud.connection.inviteInput")}</span><textarea aria-label={t("cloud.connection.inviteInput")} value={pasted} onChange={event => setPasted(event.target.value)} placeholder={t("cloud.connection.invitePlaceholder")} rows={2} className={`${field} w-full resize-y`} /></label>
      <Button size="sm" className="self-end sm:self-start" disabled={busy || !pasted.trim()} onClick={() => void execute(parseAndSave)}>{busy ? t("cloud.connection.connecting") : t("cloud.connection.connect")}</Button>
    </div> : null}

    {showRegistrationConfirmation ? <section className="mt-3 grid gap-3 rounded-md border border-border bg-muted/20 p-3" aria-labelledby="cloud-confirmation-title">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("cloud.account.confirmationStep")}</p><h3 id="cloud-confirmation-title" className="mt-1 text-sm font-medium">{t(confirmationTitle)}</h3></div>{registrationEmailSent ? <span className="text-xs text-muted-foreground">{t("cloud.account.confirmationStepCount")}</span> : null}</div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t(codeFlow ? "cloud.otp.hint" : confirmationHint)}</p>
      <p className="rounded border border-border/70 bg-background px-2 py-1.5 text-sm" data-testid="cloud-confirmation-email">{email}</p>
      {onVerifyEmailCode ? <form className="grid gap-2" onSubmit={event => { event.preventDefault(); if (busyRef.current) return; const code = verificationCode.trim(); if (!/^\d{8}$/u.test(code)) { setError(t("cloud.otp.invalid")); return; } void execute(async () => { await onVerifyEmailCode(email.trim(), code); setVerificationCode(""); setNotice("cloud.otp.verified"); }); }}>
        <label className="grid gap-1 text-xs">{t("cloud.otp.label")}<input className={`${field} tracking-[0.25em]`} aria-label={t("cloud.otp.label")} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} value={verificationCode} onChange={event => setVerificationCode(event.target.value)} disabled={busy} required /></label>
        <Button size="sm" type="submit" disabled={busy || !verificationCode.trim()}>{busy ? t("cloud.connection.processing") : t("cloud.otp.verify")}</Button>
      </form> : null}
      <div className="flex flex-wrap items-center gap-2">
        {onResendConfirmation ? <Button type="button" size="sm" disabled={busy || (codeFlow && resendSeconds > 0)} onClick={() => void resend()}>{busy ? t("cloud.connection.processing") : codeFlow && resendSeconds > 0 ? t("cloud.otp.cooldown", { seconds: resendSeconds }) : t("cloud.connection.resend")}</Button> : null}
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setConfirmationState(null); setVerificationCode(""); setNotice(""); setPassword(""); }}>{t("cloud.account.returnToLogin")}</Button>
        {codeFlow ? <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => changeAccountMode("register")}>{t("cloud.otp.changeEmail")}</Button> : null}
      </div>
      {registrationEmailSent ? <p className="text-xs text-muted-foreground">{t("cloud.account.confirmationNext")}</p> : null}
    </section> : null}
    {((!unavailable && !userId) || passwordRecovery) && !showAdvancedForm && !showRegistrationConfirmation ? <form className="mt-3 grid gap-3" onSubmit={event => { event.preventDefault(); setNotice("");
      if (passwordRecovery && (password.length < 8 || password !== repeatedPassword)) { setError(t(password.length < 8 ? "cloud.account.passwordLength" : "cloud.account.passwordMismatch")); return; }
      void execute(async () => {
      if (passwordRecovery && onResetPassword) {
        await onResetPassword(password); setPassword(""); setRepeatedPassword(""); setNotice("cloud.account.resetSuccess"); return;
      }
      if (forgotPassword && onRequestPasswordReset) {
        await onRequestPasswordReset(email.trim()); setNotice("cloud.account.resetMailNotice"); return;
      }
      if (registering && onRegister) {
        const result = await onRegister(email.trim(), password);
        setConfirmationState(result?.confirmationRequired === false ? null : result?.confirmationSent === true ? "sent" : "unknown");
        if (codeFlow && result?.confirmationSent === true) setResendSeconds(60);
        setRegistering(false); setNotice(result?.confirmationRequired === false ? "cloud.connection.createdNotice" : result?.confirmationSent === true ? codeFlow ? "cloud.otp.sent" : "cloud.account.confirmationSentNotice" : "cloud.account.confirmationUnknownNotice");
      } else await onLogin(email.trim(), password);
      setPassword("");
    }); }}>
      {registering ? <div className="rounded border border-border/70 bg-muted/20 px-3 py-2"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("cloud.account.signupStep")}</p><p className="mt-1 text-xs text-muted-foreground">{t("cloud.account.signupHint")}</p></div> : null}
      {passwordRecovery || forgotPassword ? <div><p className="text-sm font-medium">{t(passwordRecovery ? "cloud.account.resetTitle" : "cloud.account.forgotTitle")}</p><p className="mt-1 text-xs text-muted-foreground">{t(passwordRecovery ? "cloud.account.resetHint" : "cloud.account.forgotHint")}</p></div> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {!passwordRecovery ? <label className="grid gap-1 text-xs">{t("cloud.connection.email")}<input aria-label={t("cloud.connection.email")} className={field} type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} placeholder={t("cloud.connection.emailPlaceholder")} required disabled={busy} /></label> : null}
        {!forgotPassword ? <label className="grid gap-1 text-xs">{t(passwordRecovery ? "cloud.account.newPassword" : "cloud.connection.password")}<input aria-label={t(passwordRecovery ? "cloud.account.newPassword" : "cloud.connection.password")} className={field} type="password" autoComplete={registering || passwordRecovery ? "new-password" : "current-password"} minLength={registering || passwordRecovery ? 8 : undefined} value={password} onChange={event => setPassword(event.target.value)} placeholder={registering || passwordRecovery ? t("cloud.connection.newPasswordPlaceholder") : t("cloud.connection.passwordPlaceholder")} required disabled={busy} /></label> : null}
        {passwordRecovery ? <label className="grid gap-1 text-xs">{t("cloud.account.repeatPassword")}<input aria-label={t("cloud.account.repeatPassword")} className={field} type="password" autoComplete="new-password" minLength={8} value={repeatedPassword} onChange={event => setRepeatedPassword(event.target.value)} required disabled={busy} /></label> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || (passwordRecovery && !onResetPassword)}>{busy ? t("cloud.connection.processing") : passwordRecovery ? t("cloud.account.savePassword") : forgotPassword ? t("cloud.account.sendReset") : registering ? t("cloud.connection.signup") : t("cloud.connection.login")}</Button>
        {!passwordRecovery && onRegister && !forgotPassword ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => changeAccountMode(registering ? "login" : "register")}>{registering ? t("cloud.connection.backToLogin") : t("cloud.connection.createAccount")}</Button> : null}
        {!passwordRecovery && onRequestPasswordReset && !registering ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => changeAccountMode(forgotPassword ? "login" : "forgot")}>{t(forgotPassword ? "cloud.connection.backToLogin" : "cloud.account.forgotPassword")}</Button> : null}
        {passwordRecovery && onCancelPasswordRecovery ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancelPasswordRecovery}>{t("cloud.connection.backToLogin")}</Button> : null}
        {!passwordRecovery && !forgotPassword && onResendConfirmation && !registering && (confirmationState !== null || confirmation?.tone === "error") ? <Button type="button" variant="ghost" size="sm" disabled={busy || !email.trim() || (codeFlow && resendSeconds > 0)} onClick={() => void resend()}>{codeFlow && resendSeconds > 0 ? t("cloud.otp.cooldown", { seconds: resendSeconds }) : t("cloud.connection.resend")}</Button> : null}
      </div>
    </form> : null}
    {notice ? <p role="status" className="mt-2 text-xs text-muted-foreground">{t(notice)}</p> : null}

    {!passwordRecovery ? <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-3">
      <button type="button" disabled={busy} className="text-xs text-muted-foreground underline-offset-4 hover:underline" aria-expanded={joining} onClick={() => { setJoining(value => !value); setPasted(""); setAdvanced(false); setEditing(false); }}>{t("cloud.connection.joinOther")}</button>
      <button type="button" disabled={busy} className="text-xs text-muted-foreground underline-offset-4 hover:underline" aria-expanded={showAdvancedForm} onClick={() => { if (managedSelected) setDraft(emptyDraft()); setAdvanced(value => !value); }}>{managedSelected ? t("cloud.connection.selfHosted") : t("cloud.connection.advanced")}</button>
      {selected && !managedSelected ? <button type="button" disabled={busy} className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={beginEdit}>{t("cloud.connection.settings")}</button> : null}
    </div> : null}
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
