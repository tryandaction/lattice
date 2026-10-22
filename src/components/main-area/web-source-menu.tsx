"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Globe2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { normalizeWebAddress } from "@/components/renderers/web-address-bar";
import type { TabState } from "@/types/layout";
import { useI18n } from "@/hooks/use-i18n";

export function WebSourceMenu({ paneId, tabs, activeTabId, onSelect, onClose }: { paneId: string; tabs: TabState[]; activeTabId?: string; onSelect: (index: number) => void; onClose: (index: number) => void }) {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const [address, setAddress] = useState("");
  const [invalid, setInvalid] = useState(false);
  const openWeb = useWorkspaceStore(state => state.openWebUrlInPane);
  const webTabs = tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => tab.kind === "web");
  const activeWebTab = webTabs.find(({ tab }) => tab.id === activeTabId)?.tab;
  useEffect(() => {
    if (!anchor) return;
    const closeOutside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) setAnchor(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setAnchor(null); buttonRef.current?.focus(); } };
    const resize = () => setAnchor(null);
    document.addEventListener("pointerdown", closeOutside, true); document.addEventListener("keydown", key); window.addEventListener("resize", resize);
    menuRef.current?.querySelector("input")?.focus();
    return () => { document.removeEventListener("pointerdown", closeOutside, true); document.removeEventListener("keydown", key); window.removeEventListener("resize", resize); };
  }, [anchor]);
  const submit = (event: FormEvent) => {
    event.preventDefault(); const url = normalizeWebAddress(address); setInvalid(!url);
    if (url) { openWeb(paneId, url); setAddress(""); setAnchor(null); }
  };
  return <>
    <button ref={buttonRef} type="button" aria-label={t("viewer.web.source.entry")} aria-expanded={Boolean(anchor)} title={activeWebTab ? `${t("viewer.web.source.title")}: ${activeWebTab.fileName}` : t("viewer.web.source.title")} data-desktop-webview-safe-zone="true" className={cn("mx-1 flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs hover:bg-accent hover:text-foreground", activeWebTab ? "bg-accent text-foreground" : "text-muted-foreground")} onClick={() => {
      if (anchor) { setAnchor(null); return; }
      const rect = buttonRef.current!.getBoundingClientRect(); setAnchor({ left: Math.max(8, Math.min(rect.right - 320, window.innerWidth - 328)), top: rect.bottom + 4 });
    }}><Globe2 className="h-3.5 w-3.5" /><span>{t("viewer.web.source.entry")}</span>{webTabs.length > 0 && <span className="text-[10px]">{webTabs.length}</span>}{activeWebTab && <span className="max-w-28 truncate border-l pl-1">{activeWebTab.fileName}</span>}</button>
    {anchor && createPortal(<div ref={menuRef} role="dialog" aria-label={t("viewer.web.source.dialog")} data-desktop-webview-safe-zone="true" className="fixed z-[100] w-80 max-w-[calc(100vw-16px)] rounded-md border border-border bg-background p-2 shadow-lg" style={anchor}>
      <form onSubmit={submit} className="flex gap-1">
        <input aria-label={t("viewer.web.source.address")} value={address} aria-invalid={invalid || undefined} onChange={event => { setAddress(event.target.value); setInvalid(false); }} placeholder={t("viewer.web.source.placeholder")} className="h-8 min-w-0 flex-1 rounded border border-border bg-muted/30 px-2 text-xs outline-none focus:border-ring aria-invalid:border-destructive" autoComplete="off" spellCheck={false} />
        <button type="submit" className="rounded bg-accent px-2 text-xs">{t("viewer.web.source.open")}</button>
      </form>
      {invalid && <p role="alert" className="pt-1 text-xs text-destructive">{t("viewer.web.address.invalid")}</p>}
      {webTabs.length > 0 ? <div className="mt-2 max-h-64 overflow-y-auto border-t pt-1">{webTabs.map(({ tab, index }) => <div key={tab.id} className={cn("flex items-center rounded hover:bg-accent", tab.id === activeTabId && "bg-accent/60")}><button type="button" aria-current={tab.id === activeTabId ? "page" : undefined} onClick={() => { onSelect(index); setAnchor(null); }} className="min-w-0 flex-1 px-2 py-1.5 text-left"><span className="block truncate text-xs">{tab.fileName}</span><span className="block truncate text-[10px] text-muted-foreground">{tab.filePath}</span></button><button type="button" aria-label={`${t("tab.context.close")}: ${tab.fileName}`} className="mr-1 shrink-0 rounded p-1 hover:bg-muted" onClick={() => onClose(index)}><X className="h-3.5 w-3.5" /></button></div>)}</div> : <p className="pt-2 text-xs text-muted-foreground">{t("viewer.web.source.empty")}</p>}
    </div>, document.body)}
  </>;
}
