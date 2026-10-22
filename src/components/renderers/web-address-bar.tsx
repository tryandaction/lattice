"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, RotateCw, X } from "lucide-react";
import { canOpenUrlInternally } from "@/lib/web-document";
import { useI18n } from "@/hooks/use-i18n";

export function normalizeWebAddress(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(text) && !/^localhost:\d/i.test(text) ? text : `https://${text}`;
  try { return canOpenUrlInternally(candidate) ? new URL(candidate).href : null; } catch { return null; }
}

interface WebAddressBarProps {
  url: string;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onExternal: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onStop?: () => void;
  loading?: boolean;
}

export function WebAddressBar({ url, onNavigate, onBack, onForward, onReload, onExternal, canGoBack, canGoForward, onStop, loading }: WebAddressBarProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState({ source: url, value: url, invalid: false });
  const address = draft.source === url ? draft.value : url;
  const error = draft.source === url && draft.invalid;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = normalizeWebAddress(address);
    if (!next) {
      setDraft({ source: url, value: address, invalid: true });
      return;
    }
    setDraft({ source: next, value: next, invalid: false });
    onNavigate(next);
  };
  const buttonClass = "shrink-0 rounded p-1.5 hover:bg-accent disabled:opacity-30";
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-2 py-1" data-desktop-webview-safe-zone="true">
      <button type="button" aria-label={t("viewer.web.command.back")} title={t("viewer.web.command.back")} disabled={canGoBack === false} onClick={onBack} className={buttonClass}><ArrowLeft className="h-3.5 w-3.5" /></button>
      <button type="button" aria-label={t("viewer.web.command.forward")} title={t("viewer.web.command.forward")} disabled={canGoForward === false} onClick={onForward} className={buttonClass}><ArrowRight className="h-3.5 w-3.5" /></button>
      {loading && onStop
        ? <button type="button" aria-label={t("viewer.web.command.stop")} onClick={onStop} className={buttonClass}><X className="h-3.5 w-3.5" /></button>
        : <button type="button" aria-label={t("viewer.web.command.reload")} onClick={onReload} className={buttonClass}><RotateCw className="h-3.5 w-3.5" /></button>}
      <form onSubmit={submit} className="min-w-0 flex-1">
        <input aria-label={t("viewer.web.address")} aria-invalid={error || undefined} title={error ? t("viewer.web.address.invalid") : url} value={address} onChange={event => setDraft({ source: url, value: event.target.value, invalid: false })} onKeyDown={event => { if (event.key === "Escape") { setDraft({ source: url, value: url, invalid: false }); event.currentTarget.blur(); } }} className="h-7 w-full rounded border border-border bg-muted/30 px-2 text-xs outline-none focus:border-ring aria-invalid:border-destructive" spellCheck={false} autoComplete="off" />
      </form>
      <button type="button" aria-label={t("viewer.web.command.openExternal")} title={t("viewer.web.command.openExternal")} onClick={onExternal} className={buttonClass}><ExternalLink className="h-3.5 w-3.5" /></button>
    </div>
  );
}
