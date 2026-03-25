"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search, Loader2, FileText, ChevronRight } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { isDirectoryNode, isFileNode, type FileNode, type TreeNode } from "@/types/file-system";
import { useI18n } from "@/hooks/use-i18n";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { useSettingsStore } from "@/stores/settings-store";

interface SearchMatch {
  id: string;
  matchType: "name" | "content";
  lineNumber?: number;
  snippet?: string;
}

interface SearchResultGroup {
  path: string;
  name: string;
  extension: string;
  handle: FileSystemFileHandle;
  matches: SearchMatch[];
  rank: number;
}

type SearchScope = "all" | "current";
type SearchMode = "name_and_content" | "file_name_only";
type SearchSort = "relevance" | "name";

const SEARCHABLE_EXTENSIONS = new Set([
  "md",
  "txt",
  "py",
  "js",
  "jsx",
  "ts",
  "tsx",
  "json",
  "css",
  "html",
]);

const LINE_NAVIGABLE_EXTENSIONS = new Set([
  "md",
  "txt",
  "py",
  "js",
  "jsx",
  "ts",
  "tsx",
  "json",
  "css",
]);

const MAX_GROUPS = 18;
const MAX_MATCHES_PER_FILE = 6;
const MAX_TOTAL_MATCHES = 48;

function collectFiles(node: TreeNode | null): FileNode[] {
  if (!node) return [];
  if (isFileNode(node)) {
    const children = node.children?.flatMap((child) => collectFiles(child)) ?? [];
    return [node, ...children];
  }
  if (isDirectoryNode(node)) {
    return node.children.flatMap((child) => collectFiles(child));
  }
  return [];
}

function buildLineMatches(text: string, keyword: string): Array<{ lineNumber: number; snippet: string }> {
  const results: Array<{ lineNumber: number; snippet: string }> = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = line.toLowerCase();
    if (!normalized.includes(keyword)) {
      continue;
    }

    const snippet = line.trim().slice(0, 220);
    results.push({
      lineNumber: index + 1,
      snippet: snippet || line.slice(0, 220),
    });

    if (results.length >= MAX_MATCHES_PER_FILE) {
      break;
    }
  }

  return results;
}

function renderHighlightedText(text: string, keyword: string): ReactNode {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return text;
  }

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "ig");
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (part.toLowerCase() === trimmed.toLowerCase()) {
      return (
        <mark key={`${part}:${index}`} className="rounded bg-primary/15 px-0.5 text-foreground">
          {part}
        </mark>
      );
    }

    return <span key={`${part}:${index}`}>{part}</span>;
  });
}

export function WorkspaceSearchPanel() {
  const { t } = useI18n();
  const fileTree = useWorkspaceStore((state) => state.fileTree);
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);
  const searchPanelScope = useSettingsStore((state) => state.settings.searchPanelScope);
  const searchPanelMode = useSettingsStore((state) => state.settings.searchPanelMode);
  const searchPanelSort = useSettingsStore((state) => state.settings.searchPanelSort);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const [query, setQuery] = useState("");
  const normalizedKeyword = query.trim();
  const [results, setResults] = useState<SearchResultGroup[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const scope: SearchScope = searchPanelScope;
  const mode: SearchMode = searchPanelMode;
  const sortBy: SearchSort = searchPanelSort;
  const files = useMemo(() => collectFiles(fileTree.root), [fileTree.root]);

  useEffect(() => {
    const keyword = query.trim().toLowerCase();
    if (keyword.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    void (async () => {
      const groups: SearchResultGroup[] = [];
      let totalMatches = 0;

      for (const file of files) {
        if (groups.length >= MAX_GROUPS || totalMatches >= MAX_TOTAL_MATCHES) {
          break;
        }

        const matches: SearchMatch[] = [];

        if (file.name.toLowerCase().includes(keyword)) {
          matches.push({
            id: `${file.path}:name`,
            matchType: "name",
          });
          totalMatches += 1;
        }

        if (mode === "name_and_content" && SEARCHABLE_EXTENSIONS.has(file.extension)) {
          try {
            const blob = await file.handle.getFile();
            const text = await blob.text();
            const lineMatches = buildLineMatches(text, keyword);
            for (const match of lineMatches) {
              if (totalMatches >= MAX_TOTAL_MATCHES || matches.length >= MAX_MATCHES_PER_FILE + 1) {
                break;
              }
              matches.push({
                id: `${file.path}:line:${match.lineNumber}`,
                matchType: "content",
                lineNumber: match.lineNumber,
                snippet: match.snippet,
              });
              totalMatches += 1;
            }
          } catch {
            // Ignore unreadable files in search results.
          }
        }

        if (matches.length > 0) {
          const nameMatchBonus = matches.some((match) => match.matchType === "name") ? 100 : 0;
          groups.push({
            path: file.path,
            name: file.name,
            extension: file.extension,
            handle: file.handle,
            matches,
            rank: nameMatchBonus + matches.length,
          });
        }
      }

      if (!cancelled) {
        groups.sort((left, right) => right.rank - left.rank || left.name.localeCompare(right.name));
        setResults(groups);
        setIsSearching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files, mode, query]);

  const openGroupFile = async (group: SearchResultGroup) => {
    openFileInActivePane(group.handle, group.path);
  };

  const visibleResults = useMemo(() => (
    scope === "current" && activeTab?.filePath
      ? results.filter((group) => group.path === activeTab.filePath)
      : results
  ), [activeTab?.filePath, results, scope]);

  const sortedVisibleResults = useMemo(() => {
    const next = [...visibleResults];
    next.sort((left, right) => {
      if (sortBy === "name") {
        return left.name.localeCompare(right.name);
      }
      return right.rank - left.rank || left.name.localeCompare(right.name);
    });
    return next;
  }, [sortBy, visibleResults]);

  const visibleResultCount = useMemo(
    () => sortedVisibleResults.reduce((sum, group) => sum + group.matches.length, 0),
    [sortedVisibleResults],
  );

  const openMatch = async (group: SearchResultGroup, match: SearchMatch) => {
    if (match.lineNumber && LINE_NAVIGABLE_EXTENSIONS.has(group.extension) && rootHandle) {
      const success = await navigateLink(`${group.path}#line=${match.lineNumber}`, {
        paneId: activePaneId,
        rootHandle,
      });
      if (success) {
        return;
      }
    }

    openFileInActivePane(group.handle, group.path);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("workbench.search.title")}
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("workbench.search.placeholder")}
            className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => void updateSetting("searchPanelScope", "all")}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${scope === "all" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("workbench.search.scope.all")}
            </button>
            <button
              type="button"
              onClick={() => void updateSetting("searchPanelScope", "current")}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${scope === "current" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("workbench.search.scope.current")}
            </button>
          </div>

          <div className="flex items-center rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => void updateSetting("searchPanelMode", "name_and_content")}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${mode === "name_and_content" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("workbench.search.mode.all")}
            </button>
            <button
              type="button"
              onClick={() => void updateSetting("searchPanelMode", "file_name_only")}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${mode === "file_name_only" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("workbench.search.mode.name")}
            </button>
          </div>

          <div className="flex items-center rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => void updateSetting("searchPanelSort", "relevance")}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${sortBy === "relevance" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("workbench.search.sort.relevance")}
            </button>
            <button
              type="button"
              onClick={() => void updateSetting("searchPanelSort", "name")}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${sortBy === "name" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("workbench.search.sort.name")}
            </button>
          </div>

          {query.trim().length >= 2 ? (
            <div className="rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
              {t("workbench.search.results")}: {visibleResultCount}
            </div>
          ) : null}
        </div>

        {query.trim().length < 2 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            {t("workbench.search.hint")}
          </div>
        ) : null}

        {query.trim().length >= 2 && !isSearching && sortedVisibleResults.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            {scope === "current" ? t("workbench.search.emptyCurrent") : t("workbench.search.empty")}
          </div>
        ) : null}

        <div className="space-y-3">
          {sortedVisibleResults.map((group) => (
            <div key={group.path} className="rounded-md border border-border bg-background">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{renderHighlightedText(group.name, normalizedKeyword)}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{group.path}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void openGroupFile(group)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {t("workbench.search.openFile")}
                </button>
                <span className="shrink-0 rounded border border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
                  {group.matches.length}
                </span>
              </div>

              <div className="p-2">
                {group.matches.map((match) => (
                  <button
                    key={match.id}
                    type="button"
                    onClick={() => void openMatch(group, match)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        <span>
                          {match.matchType === "name"
                            ? t("workbench.search.match.name")
                            : t("workbench.search.match.content")}
                        </span>
                        {typeof match.lineNumber === "number" ? (
                          <span>{t("workbench.search.line", { line: match.lineNumber })}</span>
                        ) : null}
                      </div>
                      {match.snippet ? (
                        <div className="mt-1 text-sm text-foreground/85">{renderHighlightedText(match.snippet, normalizedKeyword)}</div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default WorkspaceSearchPanel;
