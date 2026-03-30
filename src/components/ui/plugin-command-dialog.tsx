"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  BookOpen,
  Command,
  RefreshCcw,
  Settings,
  Stethoscope,
  X,
  Zap,
} from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsStore } from "@/stores/settings-store";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { getRegisteredCommands, subscribePluginRegistry } from "@/lib/plugins/runtime";
import type { PluginCommand } from "@/lib/plugins/types";
import { cn } from "@/lib/utils";
import { resolveAppRoute } from "@/lib/app-route";

export interface PluginCommandDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
  onOpenPluginPanels?: () => void;
}

type CommandSource = "core" | "plugin";
type CommandCategory = "ai" | "system" | "docs" | "diagnostics" | "plugin";
type CommandSectionKey = "recent" | "suggested" | "plugins" | "results";
type CommandItem = PluginCommand & {
  source: CommandSource;
  category: CommandCategory;
  description: string;
  keywords?: string[];
  priority?: number;
  disabled?: boolean;
};

interface CommandSection {
  key: CommandSectionKey;
  label: string;
  items: CommandItem[];
}

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

function normalizeSearchValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function dedupeCommands(commands: CommandItem[]): CommandItem[] {
  const seen = new Set<string>();
  const deduped: CommandItem[] = [];
  commands.forEach((command) => {
    if (seen.has(command.id)) {
      return;
    }
    seen.add(command.id);
    deduped.push(command);
  });
  return deduped;
}

function compareCommandPriority(left: CommandItem, right: CommandItem): number {
  const leftPriority = left.priority ?? 50;
  const rightPriority = right.priority ?? 50;
  return leftPriority - rightPriority || left.title.localeCompare(right.title);
}

function getSourceLabel(source: CommandSource, language: string): string {
  const isZh = language !== "en-US";
  return source === "core" ? (isZh ? "内置" : "Built-in") : (isZh ? "插件" : "Plugin");
}

function getCategoryLabel(category: CommandCategory, language: string): string {
  const isZh = language !== "en-US";
  switch (category) {
    case "ai":
      return isZh ? "AI" : "AI";
    case "system":
      return isZh ? "系统" : "System";
    case "docs":
      return isZh ? "指南" : "Guide";
    case "diagnostics":
      return isZh ? "诊断" : "Diagnostics";
    default:
      return isZh ? "插件" : "Plugin";
  }
}

function getSectionLabel(section: CommandSectionKey, language: string): string {
  const isZh = language !== "en-US";
  switch (section) {
    case "recent":
      return isZh ? "最近使用" : "Recent";
    case "suggested":
      return isZh ? "全局命令" : "Global";
    case "plugins":
      return isZh ? "插件命令" : "Plugins";
    default:
      return isZh ? "匹配结果" : "Results";
  }
}

function getCommandDialogDescription(language: string): string {
  return language === "en-US"
    ? "Global actions, AI tools, docs, diagnostics, and plugin commands are unified here."
    : "全局动作、AI 工具、指南、诊断与插件命令统一收口在这里。";
}

function getCommandDisabledHint(language: string): string {
  return language === "en-US"
    ? "Plugin commands are hidden because plugins are disabled. Built-in commands still work."
    : "插件系统当前未启用，因此插件命令已隐藏；内置命令仍可直接使用。";
}

function getRefreshLabel(language: string): string {
  return language === "en-US" ? "Refresh command registry" : "刷新命令注册表";
}

function getRunCommandAriaLabel(language: string, title: string): string {
  return language === "en-US" ? `Run ${title}` : `运行 ${title}`;
}

function getCategoryIcon(category: CommandCategory) {
  switch (category) {
    case "ai":
      return Bot;
    case "system":
      return Settings;
    case "docs":
      return BookOpen;
    case "diagnostics":
      return Stethoscope;
    default:
      return Zap;
  }
}

function scoreCommand(command: CommandItem, query: string, recentIds: string[]): number {
  if (!query) {
    return 0;
  }

  const title = normalizeSearchValue(command.title);
  const id = normalizeSearchValue(command.id);
  const description = normalizeSearchValue(command.description);
  const shortcut = normalizeSearchValue(command.shortcut);
  const keywords = command.keywords?.map(normalizeSearchValue) ?? [];

  let score = 0;
  if (title === query) score += 1400;
  else if (title.startsWith(query)) score += 1000;
  else if (title.includes(query)) score += 760;

  if (id === query) score += 900;
  else if (id.startsWith(query)) score += 620;
  else if (id.includes(query)) score += 420;

  if (description.includes(query)) score += 260;
  if (shortcut.includes(query)) score += 220;
  if (keywords.some((keyword) => keyword.includes(query))) score += 300;

  const recentIndex = recentIds.indexOf(command.id);
  if (recentIndex >= 0) {
    score += Math.max(0, 140 - recentIndex * 20);
  }
  if (command.source === "core") {
    score += 40;
  }

  return score;
}

function buildBuiltinCommands(input: {
  language: string;
  navigate: (path: string) => void;
  toggleAiChat: () => void;
  aiChatOpen: boolean;
  onOpenSettings?: () => void;
  onOpenPluginPanels?: () => void;
}): CommandItem[] {
  const isZh = input.language !== "en-US";
  return [
    {
      id: "core.toggle-ai-chat-panel",
      title: isZh
        ? (input.aiChatOpen ? "关闭 AI Chat 面板" : "打开 AI Chat 面板")
        : (input.aiChatOpen ? "Close AI Chat Panel" : "Open AI Chat Panel"),
      description: isZh ? "切换右侧 AI 对话面板" : "Toggle the right-side AI chat panel.",
      source: "core",
      category: "ai",
      priority: 10,
      shortcut: "Ctrl+K",
      keywords: ["ai", "chat", "assistant", "panel", "dock"],
      run: async () => {
        input.toggleAiChat();
      },
    },
    {
      id: "core.open-settings",
      title: isZh ? "打开设置" : "Open Settings",
      description: isZh ? "进入应用设置面板" : "Open the application settings panel.",
      source: "core",
      category: "system",
      priority: 12,
      shortcut: "Ctrl+,",
      keywords: ["settings", "preferences", "config"],
      run: async () => {
        input.onOpenSettings?.();
      },
    },
    {
      id: "core.open-plugin-panels",
      title: isZh ? "打开插件中心" : "Open Plugin Center",
      description: isZh ? "打开右侧插件面板与工具中心" : "Open the right-side plugin panel center.",
      source: "core",
      category: "system",
      priority: 14,
      shortcut: "Ctrl+Shift+P",
      keywords: ["plugin", "panel", "extensions"],
      run: async () => {
        input.onOpenPluginPanels?.();
      },
    },
    {
      id: "core.open-live-preview-guide",
      title: isZh ? "打开使用指南" : "Open User Guide",
      description: isZh ? "查看产品说明与桌面使用指南" : "Open the product user guide.",
      source: "core",
      category: "docs",
      priority: 18,
      shortcut: "Ctrl+Shift+/",
      keywords: ["guide", "docs", "help"],
      run: async () => input.navigate(resolveAppRoute("/guide")),
    },
    {
      id: "core.open-live-preview-diagnostics",
      title: isZh ? "打开诊断中心" : "Open Diagnostics",
      description: isZh ? "打开综合诊断页进行功能回归检查" : "Open the main diagnostics workspace.",
      source: "core",
      category: "diagnostics",
      priority: 40,
      keywords: ["diagnostics", "debug", "health"],
      run: async () => input.navigate(resolveAppRoute("/diagnostics")),
    },
    {
      id: "core.open-runner-diagnostics",
      title: isZh ? "打开运行器诊断" : "Open Runner Diagnostics",
      description: isZh ? "检查运行器与执行环境状态" : "Inspect runner and execution environment health.",
      source: "core",
      category: "diagnostics",
      priority: 42,
      keywords: ["runner", "python", "diagnostics"],
      run: async () => input.navigate(resolveAppRoute("/diagnostics/runner")),
    },
  ];
}

export function PluginCommandDialog({
  isOpen,
  onClose,
  onOpenSettings,
  onOpenPluginPanels,
}: PluginCommandDialogProps) {
  const { t } = useI18n();
  const router = useRouter();
  const settings = useSettingsStore((state) => state.settings);
  const aiChatOpen = useAiChatStore((state) => state.isOpen);
  const toggleAiChat = useAiChatStore((state) => state.toggleOpen);
  const language = settings.language || "zh-CN";
  const [pluginCommands, setPluginCommands] = useState<PluginCommand[]>([]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecentCommandIds());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleClose = () => {
    setQuery("");
    setActiveIndex(0);
    onClose();
  };

  const builtinCommands = useMemo(
    () => buildBuiltinCommands({
      language,
      navigate: (path) => router.push(path),
      toggleAiChat,
      aiChatOpen,
      onOpenSettings,
      onOpenPluginPanels,
    }),
    [aiChatOpen, language, onOpenPluginPanels, onOpenSettings, router, toggleAiChat],
  );

  const allCommands = useMemo<CommandItem[]>(() => {
    const pluginItems = settings.pluginsEnabled
      ? pluginCommands.map((command) => ({
          ...command,
          source: "plugin" as const,
          category: "plugin" as const,
          description: language === "en-US"
            ? `Plugin command · ${command.id}`
            : `插件命令 · ${command.id}`,
          keywords: [command.id, command.shortcut ?? ""],
          priority: 80,
        }))
      : [];

    return dedupeCommands([...builtinCommands, ...pluginItems]);
  }, [builtinCommands, language, pluginCommands, settings.pluginsEnabled]);

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

  const rankedResults = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(deferredQuery);
    if (!normalizedQuery) {
      return [];
    }

    return [...allCommands]
      .map((command) => ({
        command,
        score: scoreCommand(command, normalizedQuery, recentIds),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) =>
        right.score - left.score ||
        compareCommandPriority(left.command, right.command))
      .map((entry) => entry.command);
  }, [allCommands, deferredQuery, recentIds]);

  const recentCommands = useMemo(() => {
    if (recentIds.length === 0) return [];
    const map = new Map(allCommands.map((cmd) => [cmd.id, cmd]));
    return recentIds.map((id) => map.get(id)).filter(Boolean) as CommandItem[];
  }, [allCommands, recentIds]);

  const sections = useMemo<CommandSection[]>(() => {
    if (deferredQuery.trim()) {
      return rankedResults.length > 0
        ? [{ key: "results", label: getSectionLabel("results", language), items: rankedResults }]
        : [];
    }

    const recentIdsSet = new Set(recentCommands.map((command) => command.id));
    const suggested = allCommands
      .filter((command) => command.source === "core" && !recentIdsSet.has(command.id))
      .sort(compareCommandPriority);
    const plugins = allCommands
      .filter((command) => command.source === "plugin" && !recentIdsSet.has(command.id))
      .sort(compareCommandPriority);

    const nextSections: CommandSection[] = [];
    if (recentCommands.length > 0) {
      nextSections.push({
        key: "recent",
        label: getSectionLabel("recent", language),
        items: recentCommands,
      });
    }
    if (suggested.length > 0) {
      nextSections.push({
        key: "suggested",
        label: getSectionLabel("suggested", language),
        items: suggested,
      });
    }
    if (plugins.length > 0) {
      nextSections.push({
        key: "plugins",
        label: getSectionLabel("plugins", language),
        items: plugins,
      });
    }
    return nextSections;
  }, [allCommands, deferredQuery, language, rankedResults, recentCommands]);

  const visibleCommands = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  );

  const effectiveActiveIndex = visibleCommands.length === 0
    ? 0
    : Math.min(activeIndex, visibleCommands.length - 1);

  useEffect(() => {
    const activeCommand = visibleCommands[effectiveActiveIndex];
    if (!activeCommand) {
      return;
    }

    const activeNode = itemRefs.current[activeCommand.id];
    if (activeNode && typeof activeNode.scrollIntoView === "function") {
      activeNode.scrollIntoView({
        block: "nearest",
      });
    }
  }, [effectiveActiveIndex, visibleCommands]);

  const runCommand = async (command: CommandItem) => {
    if (command.disabled) {
      return;
    }

    try {
      await command.run();
      const next = [command.id, ...recentIds.filter((id) => id !== command.id)].slice(0, MAX_RECENT);
      setRecentIds(next);
      localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
      handleClose();
    } catch (error) {
      console.error("Command failed:", error);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[180] flex items-start justify-center overflow-y-auto px-4 pb-4 pt-6 md:pt-20"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          handleClose();
          return;
        }
        if (visibleCommands.length === 0) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((prev) => Math.min(prev + 1, visibleCommands.length - 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((prev) => Math.max(prev - 1, 0));
        } else if (event.key === "Enter") {
          event.preventDefault();
          const command = visibleCommands[effectiveActiveIndex];
          if (command) {
            void runCommand(command);
          }
        }
      }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative z-10 flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-6rem)]">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Command className="h-4 w-4 text-muted-foreground" />
            <div>
              <h2 className="text-base font-semibold">{t("commands.title")}</h2>
              <p className="text-xs text-muted-foreground">{getCommandDialogDescription(language)}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 transition-colors hover:bg-muted"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {t("commands.hint")} · {visibleCommands.length}
            </div>
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

          {sections.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              {t("commands.search.empty")}
            </div>
          ) : (
            <div className="space-y-4 pr-1">
              {sections.map((section) => (
                <section key={section.key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {section.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{section.items.length}</div>
                  </div>
                  <div className="space-y-2">
                    {section.items.map((command) => {
                      const commandIndex = visibleCommands.findIndex((item) => item.id === command.id);
                      const isActive = commandIndex === effectiveActiveIndex;
                      const CategoryIcon = getCategoryIcon(command.category);

                      return (
                        <div
                          key={command.id}
                          ref={(node) => {
                            itemRefs.current[command.id] = node;
                          }}
                          data-command-id={command.id}
                          onMouseEnter={() => setActiveIndex(commandIndex)}
                          onClick={() => void runCommand(command)}
                          className={cn(
                            "flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-3 transition-colors",
                            isActive
                              ? "border-primary/60 bg-primary/5"
                              : "border-border hover:border-border/80 hover:bg-muted/40",
                            command.disabled && "opacity-50",
                          )}
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <div className={cn(
                              "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                              isActive ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground",
                            )}>
                              <CategoryIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="truncate text-sm font-medium text-foreground">{command.title}</div>
                                <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  {getCategoryLabel(command.category, language)}
                                </span>
                                <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  {getSourceLabel(command.source, language)}
                                </span>
                              </div>
                              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                {command.description}
                              </div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                {command.id}{command.shortcut ? ` · ${command.shortcut}` : ""}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void runCommand(command);
                            }}
                            disabled={command.disabled}
                            aria-label={getRunCommandAriaLabel(language, command.title)}
                            className={cn(
                              "shrink-0 rounded-md border border-border px-2 py-1 text-xs",
                              "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                            )}
                          >
                            {t("commands.run")}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
