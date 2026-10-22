"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, LoaderCircle, Search, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { UI_MODAL_OVERLAY_CLASS, UI_MODAL_OVERLAY_STYLE, UI_MODAL_PANEL_CLASS } from "@/lib/ui-layers";
import { cn } from "@/lib/utils";
import { useVSCodeExtensionHostStore } from "@/stores/vscode-extension-host-store";

export function VSCodeHostInteractionDialog() {
  const { t } = useI18n();
  const interaction = useVSCodeExtensionHostStore((state) => state.pendingInteraction);
  const resolveInteraction = useVSCodeExtensionHostStore((state) => state.resolveInteraction);
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialFocusRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery("");
    setValue(interaction?.value ?? "");
    setSelectedIds(new Set(interaction?.items?.filter((item) => item.picked).map((item) => item.id) ?? []));
    setBusy(false);
    setError(null);
    const frame = window.requestAnimationFrame(() => initialFocusRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [interaction?.id, interaction?.items, interaction?.value]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return interaction?.items ?? [];
    }
    return (interaction?.items ?? []).filter((item) =>
      `${item.label} ${item.description ?? ""} ${item.detail ?? ""}`.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [interaction?.items, query]);

  if (!interaction) {
    return null;
  }

  const title = interaction.title || (interaction.type === "quickPick" ? t("common.select") : "VS Code");

  const submit = async (response: { cancelled: boolean; selectedIds?: string[]; value?: string }) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resolveInteraction({ interactionId: interaction.id, ...response });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const chooseItem = (itemId: string) => {
    if (!interaction.canPickMany) {
      void submit({ cancelled: false, selectedIds: [itemId] });
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void submit({ cancelled: true });
    }
  };

  return createPortal(
    <div
      className={cn(UI_MODAL_OVERLAY_CLASS, "flex items-center justify-center p-4")}
      style={UI_MODAL_OVERLAY_STYLE}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={t("common.cancel")}
        onClick={() => void submit({ cancelled: true })}
        disabled={busy || interaction.ignoreFocusOut}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("flex max-h-[min(38rem,90vh)] w-full max-w-xl flex-col overflow-hidden rounded-lg", UI_MODAL_PANEL_CLASS)}
      >
        <header className="flex min-h-12 items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label={t("common.close")}
            onClick={() => void submit({ cancelled: true })}
            disabled={busy}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {interaction.type === "quickPick" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <label className="relative m-3 mb-2 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={initialFocusRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={interaction.placeHolder || t("common.select")}
                aria-label={interaction.placeHolder || t("common.select")}
                className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
                disabled={busy}
              />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" role="listbox" aria-multiselectable={interaction.canPickMany || undefined}>
              {visibleItems.map((item) => {
                const selected = selectedIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => chooseItem(item.id)}
                    disabled={busy}
                    className={cn(
                      "flex min-h-11 w-full items-start gap-3 rounded-md px-3 py-2 text-left hover:bg-muted disabled:opacity-50",
                      selected && "bg-primary/10",
                    )}
                  >
                    <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border border-border", interaction.canPickMany ? "rounded-sm" : "rounded-full")}>
                      {selected && <Check className="h-3 w-3 text-primary" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{item.label}</span>
                      {item.description && <span className="block truncate text-xs text-muted-foreground">{item.description}</span>}
                      {item.detail && <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span>}
                    </span>
                  </button>
                );
              })}
              {visibleItems.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">{interaction.placeHolder || t("common.select")}</p>
              )}
            </div>
            {interaction.canPickMany && (
              <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
                <button type="button" className="h-8 rounded-md border border-border px-3 text-xs hover:bg-muted" onClick={() => void submit({ cancelled: true })} disabled={busy}>
                  {t("common.cancel")}
                </button>
                <button type="button" className="h-8 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50" onClick={() => void submit({ cancelled: false, selectedIds: Array.from(selectedIds) })} disabled={busy}>
                  {busy && <LoaderCircle className="mr-1 inline h-3.5 w-3.5 animate-spin" />}
                  {t("common.confirm")}
                </button>
              </footer>
            )}
          </div>
        ) : (
          <form className="p-4" onSubmit={(event) => { event.preventDefault(); void submit({ cancelled: false, value }); }}>
            {interaction.prompt && <label htmlFor="vscode-host-input" className="mb-2 block text-sm text-foreground">{interaction.prompt}</label>}
            <input
              ref={initialFocusRef}
              id="vscode-host-input"
              type={interaction.password ? "password" : "text"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={interaction.placeHolder}
              aria-label={interaction.prompt || interaction.placeHolder || title}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
              disabled={busy}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="h-8 rounded-md border border-border px-3 text-xs hover:bg-muted" onClick={() => void submit({ cancelled: true })} disabled={busy}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="h-8 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={busy}>
                {busy && <LoaderCircle className="mr-1 inline h-3.5 w-3.5 animate-spin" />}
                {t("common.confirm")}
              </button>
            </div>
          </form>
        )}

        {error && <p role="alert" className="border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</p>}
      </section>
    </div>,
    document.body,
  );
}
