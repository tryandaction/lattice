"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { X, PanelLeft } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsStore } from "@/stores/settings-store";
import { getRegisteredCommands, getRegisteredPanels, runPluginCommand, subscribePluginRegistry } from "@/lib/plugins/runtime";
import type { PluginCommand, PluginPanel, PluginPanelSchema } from "@/lib/plugins/types";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/renderers/markdown-renderer";
import { highlightMatch } from "@/components/ui/search-highlight";

export interface PluginPanelDockProps {
  onClose: () => void;
}

const MAX_RECENT_PANELS = 5;

type FormState = Record<string, Record<string, string>>;
type PanelListItem = { title?: string; description?: string; meta?: unknown };
type PanelFormField = {
  id: string;
  label?: string;
  type?: string;
  placeholder?: string;
  default?: string;
};
type PanelTableRow = Array<unknown>;

function renderPanelSchema(
  schema: PluginPanelSchema,
  formState: FormState,
  setFormState: Dispatch<SetStateAction<FormState>>,
  panelId: string
) {
  const props = schema.props ?? {};
  if (schema.type === "markdown") {
    const content = typeof props.content === "string" ? props.content : "";
    return <MarkdownRenderer content={content} />;
  }

  if (schema.type === "list") {
    const items = Array.isArray(props.items) ? (props.items as PanelListItem[]) : [];
    return (
      <div className="space-y-2">
        {items.map((item, index) => {
          const hasMeta = item?.meta !== undefined && item?.meta !== null;
          return (
            <div key={`${item?.title ?? "item"}-${index}`} className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium text-foreground">{item?.title ?? "Item"}</div>
              {item?.description && (
                <div className="text-xs text-muted-foreground mt-1">{item.description}</div>
              )}
              {hasMeta && (
                <div className="text-xs text-muted-foreground mt-1">{String(item.meta)}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (schema.type === "table") {
    const columns = Array.isArray(props.columns) ? (props.columns as string[]) : [];
    const rows = Array.isArray(props.rows) ? (props.rows as PanelTableRow[]) : [];
    return (
      <div className="overflow-auto border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              {columns.map((col: string) => (
                <th key={col} className="px-3 py-2 text-left font-medium">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`} className="border-t border-border">
                {row.map((cell, cellIndex) => (
                  <td key={`cell-${rowIndex}-${cellIndex}`} className="px-3 py-2">
                    {String(cell ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (schema.type === "form") {
    const fields = Array.isArray(props.fields) ? (props.fields as PanelFormField[]) : [];
    const panelForm = formState[panelId] ?? {};
    return (
      <div className="space-y-3">
        {fields.map((field) => (
          <label key={field.id} className="block">
            <div className="text-xs text-muted-foreground mb-1">{field.label ?? field.id}</div>
            <input
              type={field.type ?? "text"}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder={field.placeholder ?? ""}
              value={panelForm[field.id] ?? field.default ?? ""}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  [panelId]: {
                    ...prev[panelId],
                    [field.id]: event.target.value,
                  },
                }))
              }
            />
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="text-sm text-muted-foreground">
      Unsupported panel type.
    </div>
  );
}

export function PluginPanelDock({ onClose }: PluginPanelDockProps) {
  const { t } = useI18n();
  const lastActivePanelId = useSettingsStore((state) => state.settings.pluginPanelLastActiveId);
  const recentPanelIds = useSettingsStore((state) => state.settings.pluginPanelRecentIds);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const preferredPanelRef = useRef<string | null>(lastActivePanelId ?? null);
  const [panels, setPanels] = useState<PluginPanel[]>([]);
  const [commands, setCommands] = useState<PluginCommand[]>([]);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({});
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    preferredPanelRef.current = lastActivePanelId ?? null;
  }, [lastActivePanelId]);

  const panelById = useMemo(() => {
    return new Map(panels.map((panel) => [panel.id, panel]));
  }, [panels]);

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = useCallback((panel: PluginPanel) => {
    if (!normalizedQuery) return true;
    const title = String(panel.title ?? "");
    const id = String(panel.id ?? "");
    return (
      title.toLowerCase().includes(normalizedQuery) ||
      id.toLowerCase().includes(normalizedQuery)
    );
  }, [normalizedQuery]);

  const safeRecentIds = useMemo(
    () => (Array.isArray(recentPanelIds) ? recentPanelIds : []),
    [recentPanelIds]
  );

  const filteredRecentIds = useMemo(
    () => safeRecentIds.filter((id) => panelById.has(id)),
    [safeRecentIds, panelById]
  );

  const recentPanels = useMemo(
    () => filteredRecentIds.map((id) => panelById.get(id)).filter(Boolean) as PluginPanel[],
    [filteredRecentIds, panelById]
  );

  const filteredRecentPanels = useMemo(
    () => recentPanels.filter(matchesQuery),
    [recentPanels, matchesQuery]
  );

  const otherPanels = useMemo(() => {
    if (filteredRecentIds.length === 0) return panels;
    const recentSet = new Set(filteredRecentIds);
    return panels.filter((panel) => !recentSet.has(panel.id));
  }, [panels, filteredRecentIds]);

  const filteredOtherPanels = useMemo(
    () => otherPanels.filter(matchesQuery),
    [otherPanels, matchesQuery]
  );

  const panelList = useMemo(
    () => [...filteredRecentPanels, ...filteredOtherPanels],
    [filteredRecentPanels, filteredOtherPanels]
  );

  const hasResults = filteredRecentPanels.length + filteredOtherPanels.length > 0;

  useEffect(() => {
    const updateRegistry = () => {
      const current = getRegisteredPanels();
      const preferred = preferredPanelRef.current;
      setPanels(current);
      setCommands(getRegisteredCommands());
      setActivePanelId((prev) => {
        if (current.length === 0) return null;
        const candidate = prev ?? preferred;
        if (candidate && current.some((panel) => panel.id === candidate)) return candidate;
        return current[0].id;
      });
    };
    updateRegistry();
    const unsubscribe = subscribePluginRegistry(updateRegistry);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (panels.length === 0) return;
      const target = event.target as HTMLElement | null;
      const isInputTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (event.key === "Escape" && inputRef.current) {
        if (query.length > 0) {
          event.preventDefault();
          setQuery("");
        }
        return;
      }
      if (isInputTarget) return;
      if (event.key === "/" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f")) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panels.length, query.length]);

  useEffect(() => {
    if (!activePanelId) return;
    if (activePanelId === lastActivePanelId) return;
    void updateSetting("pluginPanelLastActiveId", activePanelId);
  }, [activePanelId, lastActivePanelId, updateSetting]);

  useEffect(() => {
    if (!activePanelId) return;
    if (panels.length === 0) return;
    const next = [
      activePanelId,
      ...filteredRecentIds.filter((id) => id !== activePanelId),
    ].slice(0, MAX_RECENT_PANELS);
    if (next.length === safeRecentIds.length && next.every((id, index) => id === safeRecentIds[index])) {
      return;
    }
    void updateSetting("pluginPanelRecentIds", next);
  }, [activePanelId, panels.length, filteredRecentIds, safeRecentIds, updateSetting]);

  const activePanel = useMemo(
    () => panels.find((panel) => panel.id === activePanelId) ?? null,
    [panels, activePanelId]
  );

  const commandsById = useMemo(() => {
    return new Map(commands.map((command) => [command.id, command]));
  }, [commands]);

  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <PanelLeft className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{t("panels.title")}</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          aria-label={t("common.close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-40 border-r border-border p-2 space-y-1 overflow-y-auto">
          <div className="px-2 pb-2">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("panels.search.placeholder")}
              ref={inputRef}
              onKeyDown={(event) => {
                if (panelList.length === 0) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const delta = event.key === "ArrowDown" ? 1 : -1;
                  const currentIndex = panelList.findIndex((panel) => panel.id === activePanelId);
                  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
                  const nextIndex = (baseIndex + delta + panelList.length) % panelList.length;
                  setActivePanelId(panelList[nextIndex].id);
                }
                if (event.key === "Enter" && !activePanelId) {
                  event.preventDefault();
                  setActivePanelId(panelList[0]?.id ?? null);
                }
                if (event.key === "Escape") {
                  if (query.length > 0) {
                    event.preventDefault();
                    setQuery("");
                  }
                }
              }}
              className={cn(
                "w-full rounded-md border border-border bg-background px-2 py-1 text-xs",
                "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            />
          </div>
          {panels.length === 0 && (
            <div className="text-xs text-muted-foreground px-2 py-2">
              {t("panels.empty")}
            </div>
          )}
          {panels.length > 0 && !hasResults && (
            <div className="text-xs text-muted-foreground px-2 py-2">
              {t("panels.search.empty")}
            </div>
          )}
          {filteredRecentPanels.length > 0 && (
            <div className="space-y-1">
              <div className="px-2 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("panels.recent")}
              </div>
              {filteredRecentPanels.map((panel) => (
                <button
                  key={`recent-${panel.id}`}
                  onClick={() => setActivePanelId(panel.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors",
                    activePanelId === panel.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="font-medium">{highlightMatch(panel.title ?? "", query)}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {highlightMatch(panel.id ?? "", query)}
                  </div>
                </button>
              ))}
            </div>
          )}
          {filteredOtherPanels.length > 0 && (
            <div className="space-y-1">
              {filteredRecentPanels.length > 0 && (
                <div className="px-2 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("panels.all")}
                </div>
              )}
              {filteredOtherPanels.map((panel) => (
                <button
                  key={panel.id}
                  onClick={() => setActivePanelId(panel.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors",
                    activePanelId === panel.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="font-medium">{highlightMatch(panel.title ?? "", query)}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {highlightMatch(panel.id ?? "", query)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 p-4 overflow-y-auto">
          {activePanel && (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium">{activePanel.title}</div>
                {activePanel.schema.description && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {activePanel.schema.description}
                  </div>
                )}
              </div>

              {renderPanelSchema(activePanel.schema, formState, setFormState, activePanel.id)}

              {activePanel.actions && activePanel.actions.length > 0 && (
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  {activePanel.actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => {
                        const command = commandsById.get(action.id);
                        if (!command) {
                          console.warn(`Command not found for action ${action.id}`);
                          return;
                        }
                        const payload = {
                          panelId: activePanel.id,
                          formData: formState[activePanel.id] ?? {},
                        };
                        void runPluginCommand(action.id, payload);
                      }}
                      className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      {action.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
