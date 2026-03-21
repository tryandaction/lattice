"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Command, RefreshCcw, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsStore } from "@/stores/settings-store";
import { getRegisteredCommands, subscribePluginRegistry } from "@/lib/plugins/runtime";
import type { PluginCommand } from "@/lib/plugins/types";
import { cn } from "@/lib/utils";
import { resolveAppRoute } from "@/lib/app-route";

export interface PluginCommandDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type CommandSource = "core" | "plugin";
type CommandItem = PluginCommand & { source: CommandSource };

const RECENT_COMMANDS_KEY = "lattice-command-recent";
const MAX_RECENT = 5;

function readRecentCommandIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(RECENT_COMMANDS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch (error) {
    console.warn("Failed to read recent commands:", error);
    return [];
  }
}

function getBuiltinCommands(language: string): CommandItem[] {
  const isZh = language !== "en-US";
  return [
    {
      id: "core.open-live-preview-guide",
      title: isZh ? "打开实时预览指南" : "Open Live Preview Guide",
      shortcut: "Ctrl+Shift+/",
      source: "core",
      run: () => {
        if (typeof window !== "undefined") {
          window.location.assign(resolveAppRoute("/guide"));
        }
      },
    },
    {
      id: "core.open-live-preview-diagnostics",
      title: isZh ? "打开 Live Preview 自检面板" : "Open Live Preview Diagnostics",
      source: "core",
      run: () => {
        if (typeof window !== "undefined") {
          window.location.assign(resolveAppRoute("/diagnostics"));
        }
      },
    },
    {
      id: "core.open-runner-diagnostics",
      title: isZh ? "打开运行器诊断面板" : "Open Runner Diagnostics",
      source: "core",
      run: () => {
        if (typeof window !== "undefined") {
          window.location.assign(resolveAppRoute("/diagnostics/runner"));
        }
      },
    },
  ];
}

function getSourceLabel(source: CommandSource, language: string): string {
  const isZh = language !== "en-US";
  return source === "core" ? (isZh ? "内置" : "Built-in") : (isZh ? "插件" : "Plugin");
}

function getCommandDialogDescription(language: string): string {
  return language === "en-US"
    ? "Built-in product actions and plugin commands appear here for quick access."
    : "这里会同时显示产品内置动作和插件命令，便于快速访问。";
}

function getCommandDisabledHint(language: string): string {
  return language === "en-US"
    ? "Plugin commands are unavailable because plugins are disabled, but built-in commands still work."
    : "插件系统当前未启用，但内置命令仍然可用。";
}

function getRefreshLabel(language: string): string {
  return language === "en-US" ? "Refresh plugin commands" : "刷新插件命令";
}

function getRunCommandAriaLabel(language: string, title: string): string {
  return language === "en-US" ? `Run ${title}` : `运行 ${title}`;
}

export function PluginCommandDialog({ isOpen, onClose }: PluginCommandDialogProps) {
  const { t } = useI18n();
  const settings = useSettingsStore((state) => state.settings);
  const language = settings.language || "zh-CN";
  const [pluginCommands, setPluginCommands] = useState<PluginCommand[]>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecentCommandIds());
  const inputRef = useRef<HTMLInputElement | null>(null);

  const builtinCommands = useMemo(() => getBuiltinCommands(language), [language]);
  const allCommands = useMemo<CommandItem[]>(() => {
    const plugins = pluginCommands.map((command) => ({ ...command, source: "plugin" as const }));
    return [...builtinCommands, ...plugins];
  }, [builtinCommands, pluginCommands]);

  useEffect(() => {
    if (!isOpen) return;
    const updateCommands = () => {
      try {
        setPluginCommands(getRegisteredCommands());
      } catch (err) {
        console.error("Failed to get registered commands:", err);
      }
    };
    updateCommands();
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    const unsubscribe = subscribePluginRegistry(updateCommands);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [isOpen]);

  const handleRefresh = () => {
    setPluginCommands(getRegisteredCommands());
  };

  const filteredCommands = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return allCommands;
    return allCommands.filter((command) => {
      return (
        command.title.toLowerCase().includes(keyword) ||
        command.id.toLowerCase().includes(keyword) ||
        (command.shortcut || "").toLowerCase().includes(keyword)
      );
    });
  }, [allCommands, query]);

  const recentCommands = useMemo(() => {
    if (recentIds.length === 0) return [];
    const map = new Map(allCommands.map((cmd) => [cmd.id, cmd]));
    return recentIds.map((id) => map.get(id)).filter(Boolean) as CommandItem[];
  }, [allCommands, recentIds]);
  const effectiveActiveIndex = filteredCommands.length === 0
    ? 0
    : Math.min(activeIndex, filteredCommands.length - 1);

  const runCommand = async (command: CommandItem) => {
    try {
      await command.run();
      const next = [command.id, ...recentIds.filter((id) => id !== command.id)].slice(0, MAX_RECENT);
      setRecentIds(next);
      localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
      onClose();
    } catch (error) {
      console.error("Command failed:", error);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
          return;
        }
        if (filteredCommands.length === 0) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((prev) => Math.max(prev - 1, 0));
        } else if (event.key === "Enter") {
          event.preventDefault();
          const command = filteredCommands[effectiveActiveIndex];
          if (command) {
            void runCommand(command);
          }
        }
      }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Command className="h-4 w-4 text-muted-foreground" />
            <div>
              <h2 className="text-base font-semibold">{t("commands.title")}</h2>
              <p className="text-xs text-muted-foreground">{getCommandDialogDescription(language)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors hover:bg-muted"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">{t("commands.hint")}</div>
            <button
              type="button"
              onClick={handleRefresh}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs",
                "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              )}
              aria-label={getRefreshLabel(language)}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              {t("commands.refresh")}
            </button>
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
          />

          {!settings.pluginsEnabled && (
            <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              {getCommandDisabledHint(language)}
            </div>
          )}

          {filteredCommands.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t("commands.search.empty")}</div>
          ) : (
            <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {query.trim().length === 0 && recentCommands.length > 0 && (
                <div>
                  <div className="mb-2 text-xs text-muted-foreground">{t("commands.recent")}</div>
                  <div className="space-y-2">
                    {recentCommands.map((command) => (
                      <div
                        key={`recent-${command.id}`}
                        data-command-id={command.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-sm font-medium text-foreground">{command.title}</div>
                            <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {getSourceLabel(command.source, language)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {command.id}{command.shortcut ? ` · ${command.shortcut}` : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void runCommand(command)}
                          aria-label={getRunCommandAriaLabel(language, command.title)}
                          className={cn(
                            "rounded-md border border-border px-2 py-1 text-xs",
                            "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                  data-command-id={command.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2",
                    index === effectiveActiveIndex && "border-primary/60 bg-primary/5"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-medium text-foreground">{command.title}</div>
                      <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {getSourceLabel(command.source, language)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {command.id}{command.shortcut ? ` · ${command.shortcut}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void runCommand(command)}
                    aria-label={getRunCommandAriaLabel(language, command.title)}
                    className={cn(
                      "rounded-md border border-border px-2 py-1 text-xs",
                      "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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


