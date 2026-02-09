"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Command, RefreshCcw, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsStore } from "@/stores/settings-store";
import { getRegisteredCommands, subscribePluginRegistry } from "@/lib/plugins/runtime";
import type { PluginCommand } from "@/lib/plugins/types";
import { cn } from "@/lib/utils";

export interface PluginCommandDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const RECENT_COMMANDS_KEY = "lattice-command-recent";
const MAX_RECENT = 5;

export function PluginCommandDialog({ isOpen, onClose }: PluginCommandDialogProps) {
  const { t } = useI18n();
  const settings = useSettingsStore((state) => state.settings);
  const [commands, setCommands] = useState<PluginCommand[]>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const updateCommands = () => {
      setCommands(getRegisteredCommands());
    };
    updateCommands();
    setActiveIndex(0);
    try {
      const raw = localStorage.getItem(RECENT_COMMANDS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecentIds(parsed.filter((id) => typeof id === "string"));
        }
      }
    } catch (error) {
      console.warn("Failed to read recent commands:", error);
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    const unsubscribe = subscribePluginRegistry(updateCommands);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [isOpen, settings.pluginsEnabled, settings.enabledPlugins]);

  const handleRefresh = () => {
    setCommands(getRegisteredCommands());
  };

  const filteredCommands = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return commands;
    return commands.filter((command) => {
      return (
        command.title.toLowerCase().includes(keyword) ||
        command.id.toLowerCase().includes(keyword)
      );
    });
  }, [commands, query]);

  const recentCommands = useMemo(() => {
    if (recentIds.length === 0) return [];
    const map = new Map(commands.map((cmd) => [cmd.id, cmd]));
    return recentIds.map((id) => map.get(id)).filter(Boolean) as PluginCommand[];
  }, [commands, recentIds]);

  useEffect(() => {
    if (filteredCommands.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((prev) => Math.min(prev, filteredCommands.length - 1));
  }, [filteredCommands.length]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
          return;
        }
        if (!settings.pluginsEnabled || filteredCommands.length === 0) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const command = filteredCommands[activeIndex];
          if (command) {
            void command.run();
            const next = [command.id, ...recentIds.filter((id) => id !== command.id)].slice(0, MAX_RECENT);
            setRecentIds(next);
            localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
          }
        }
      }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Command className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">{t("commands.title")}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label={t("common.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t("commands.description")}</p>
            <button
              type="button"
              onClick={handleRefresh}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border",
                "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              )}
              disabled={!settings.pluginsEnabled}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              {t("commands.refresh")}
            </button>
          </div>

          <div className="text-xs text-muted-foreground">
            {t("commands.hint")}
          </div>

          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("commands.search.placeholder")}
            ref={inputRef}
            className={cn(
              "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm",
              "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
            disabled={!settings.pluginsEnabled}
          />

          {!settings.pluginsEnabled ? (
            <div className="text-sm text-muted-foreground">{t("commands.disabled")}</div>
          ) : commands.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t("commands.empty")}</div>
          ) : filteredCommands.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t("commands.search.empty")}</div>
          ) : (
            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
              {query.trim().length === 0 && recentCommands.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-2">
                    {t("commands.recent")}
                  </div>
                  <div className="space-y-2">
                    {recentCommands.map((command) => (
                      <div
                        key={command.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                      >
                        <div>
                          <div className="text-sm font-medium text-foreground">{command.title}</div>
                          <div className="text-xs text-muted-foreground">{command.id}</div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await command.run();
                              const next = [command.id, ...recentIds.filter((id) => id !== command.id)].slice(0, MAX_RECENT);
                              setRecentIds(next);
                              localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
                            } catch (error) {
                              console.error("Command failed:", error);
                            }
                          }}
                          className={cn(
                            "px-2 py-1 text-xs rounded-md border border-border",
                            "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          )}
                        >
                          {t("commands.run")}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {filteredCommands.map((command, index) => (
                <div
                  key={command.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2",
                    index === activeIndex && "border-primary/60 bg-primary/5"
                  )}
                >
                  <div>
                    <div className="text-sm font-medium text-foreground">{command.title}</div>
                    <div className="text-xs text-muted-foreground">{command.id}</div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await command.run();
                        const next = [command.id, ...recentIds.filter((id) => id !== command.id)].slice(0, MAX_RECENT);
                        setRecentIds(next);
                        localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
                      } catch (error) {
                        console.error("Command failed:", error);
                      }
                    }}
                    className={cn(
                      "px-2 py-1 text-xs rounded-md border border-border",
                      "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    )}
                  >
                    {t("commands.run")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
