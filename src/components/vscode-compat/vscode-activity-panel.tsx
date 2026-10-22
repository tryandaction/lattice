"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Boxes,
  BugPlay,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Command,
  FileCode2,
  GitBranch,
  LoaderCircle,
  Power,
  RefreshCw,
  Search,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { ExplorerSidebar } from "@/components/explorer/explorer-sidebar";
import { WorkspaceSearchPanel } from "@/components/layout/workspace-search-panel";
import { useI18n } from "@/hooks/use-i18n";
import { readDesktopFileBytesRaw } from "@/lib/desktop-preview";
import { openDesktopTerminalAtPath } from "@/lib/desktop-openers";
import { readVSCodeConfigFromDetectedProfiles } from "@/lib/vscode-compat/auto-discovery";
import { normalizeVSCodeExtensionInventory } from "@/lib/vscode-compat/extensions";
import { importVSCodeSettingsFile } from "@/lib/vscode-compat/mapper";
import {
  buildVSCodeContributionRegistry,
  type VSCodeContributionContainer,
  type VSCodeContributionDiagnostic,
  type VSCodeContributionView,
} from "@/lib/vscode-extension-host/contribution-registry";
import { cn } from "@/lib/utils";
import type {
  VSCodeHostCommand,
  VSCodeHostSnapshot,
  VSCodeHostTreeContent,
  VSCodeHostTreeItem,
  VSCodeHostView,
  VSCodeHostWebviewContent,
} from "@/lib/vscode-extension-host/types";
import { useSettingsStore } from "@/stores/settings-store";
import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";
import { useVSCodeExtensionHostStore } from "@/stores/vscode-extension-host-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { VSCodeWebviewFrame } from "./vscode-webview-frame";
import { VSCodeSourceControlPanel } from "./vscode-source-control-panel";
import { VSCodeRunDebugPanel } from "./vscode-run-debug-panel";

type VSCodeToolId =
  | "explorer"
  | "search"
  | "source-control"
  | "run-debug"
  | "extensions"
  | "commands"
  | "terminal";

interface VSCodeToolDefinition {
  id: VSCodeToolId;
  labelKey:
    | "vscode.sidebar.explorer"
    | "vscode.sidebar.search"
    | "vscode.sidebar.sourceControl"
    | "vscode.sidebar.runDebug"
    | "vscode.sidebar.extensions"
    | "vscode.sidebar.commands"
    | "vscode.sidebar.terminal";
  icon: LucideIcon;
}

const TOOLS: VSCodeToolDefinition[] = [
  { id: "explorer", labelKey: "vscode.sidebar.explorer", icon: FileCode2 },
  { id: "search", labelKey: "vscode.sidebar.search", icon: Search },
  { id: "source-control", labelKey: "vscode.sidebar.sourceControl", icon: GitBranch },
  { id: "run-debug", labelKey: "vscode.sidebar.runDebug", icon: BugPlay },
  { id: "extensions", labelKey: "vscode.sidebar.extensions", icon: Boxes },
  { id: "commands", labelKey: "vscode.sidebar.commands", icon: Command },
  { id: "terminal", labelKey: "vscode.sidebar.terminal", icon: SquareTerminal },
];

function EmptyToolState({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-4 text-center text-xs text-muted-foreground">
      <span>{label}</span>
      {action}
    </div>
  );
}

function TerminalPanel({ workspaceRootPath }: { workspaceRootPath: string | null }) {
  const { t } = useI18n();
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openTerminal = useCallback(async () => {
    if (!workspaceRootPath || isOpening) return;
    setIsOpening(true);
    setError(null);
    try {
      await openDesktopTerminalAtPath(workspaceRootPath);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setIsOpening(false);
    }
  }, [isOpening, workspaceRootPath]);

  if (!workspaceRootPath) {
    return <EmptyToolState label={t("vscode.sidebar.terminalNoWorkspace")} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        <div className="truncate" title={workspaceRootPath}>{workspaceRootPath}</div>
      </div>
      {error ? (
        <div role="alert" className="border-b border-border px-3 py-2 text-[11px] text-destructive">
          {error}
        </div>
      ) : null}
      <div className="p-3">
        <button
          type="button"
          onClick={() => void openTerminal()}
          disabled={isOpening}
          className="flex h-8 w-full items-center justify-center gap-2 rounded border border-border bg-background px-3 text-xs text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
        >
          <SquareTerminal className="h-3.5 w-3.5" />
          <span>{isOpening ? t("vscode.sidebar.openingTerminal") : t("vscode.sidebar.openTerminal")}</span>
        </button>
      </div>
    </div>
  );
}

function ImportVSCodeProfileButton({ onImport, isImporting }: { onImport: () => void; isImporting: boolean }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={t("vscode.sidebar.importProfile")}
      disabled={isImporting}
      onClick={onImport}
      className="inline-flex h-8 items-center gap-2 border border-border px-3 text-xs text-foreground hover:bg-muted disabled:opacity-50"
    >
      {isImporting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      {isImporting ? t("vscode.sidebar.importingProfile") : t("vscode.sidebar.importProfile")}
    </button>
  );
}

function extensionIconMimeType(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".svg")) return "image/svg+xml";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function VSCodeExtensionIcon({ iconPath, label, className = "h-4 w-4" }: {
  iconPath?: string;
  label: string;
  className?: string;
}) {
  const [loadedIcon, setLoadedIcon] = useState<{ path: string; source: string } | null>(null);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    if (!iconPath) return;

    void readDesktopFileBytesRaw(iconPath)
      .then((bytes) => {
        if (disposed || bytes.byteLength === 0) return;
        const iconBytes = new Uint8Array(bytes.byteLength);
        iconBytes.set(bytes);
        objectUrl = URL.createObjectURL(new Blob([iconBytes.buffer], { type: extensionIconMimeType(iconPath) }));
        if (!disposed) setLoadedIcon({ path: iconPath, source: objectUrl });
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [iconPath]);

  const source = loadedIcon && loadedIcon.path === iconPath ? loadedIcon.source : null;
  return source ? (
    // Blob URLs are local extension resources and cannot use the Next image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={source} alt="" title={label} className={cn(className, "shrink-0 object-contain")} />
  ) : (
    <Boxes aria-hidden="true" className={cn(className, "shrink-0 text-muted-foreground")} />
  );
}

function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border">
      <h3 className="px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
        {title}
      </h3>
      <div className="pb-2">{children}</div>
    </section>
  );
}

function TreeItems({
  items,
  onCommand,
}: {
  items: VSCodeHostTreeItem[];
  onCommand: (command: NonNullable<VSCodeHostTreeItem["command"]>) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const renderItem = (item: VSCodeHostTreeItem, depth: number) => {
    const hasChildren = Boolean(item.children?.length);
    const isCollapsed = collapsed.has(item.id);
    return (
      <div key={item.id}>
        <button
          type="button"
          className="flex h-7 w-full min-w-0 items-center gap-1.5 px-2 text-left text-xs hover:bg-muted"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => {
            if (hasChildren) {
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              });
              return;
            }
            if (item.command) onCommand(item.command);
          }}
          title={item.tooltip || item.description || item.label}
        >
          {hasChildren ? (
            isCollapsed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className="truncate text-foreground">{item.label}</span>
          {item.description ? <span className="ml-auto truncate text-muted-foreground">{item.description}</span> : null}
        </button>
        {hasChildren && !isCollapsed ? renderItems(item.children ?? [], depth + 1) : null}
      </div>
    );
  };

  const renderItems = (nextItems: VSCodeHostTreeItem[], depth: number): React.ReactNode => (
    <>{nextItems.map((item) => renderItem(item, depth))}</>
  );

  return renderItems(items, 0);
}

function CommandsPanel({ onImportProfile, isImporting }: { onImportProfile: () => void; isImporting: boolean }) {
  const { t } = useI18n();
  const snapshotCommands = useVSCodeExtensionHostStore((state) => state.snapshot.commands);
  const manifestCommands = useVSCodeExtensionHostStore((state) => state.manifestCommands);
  const runCommand = useVSCodeExtensionHostStore((state) => state.runCommand);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const commands = useMemo(() => {
    const byId = new Map(manifestCommands.map((command) => [command.id, command]));
    for (const command of snapshotCommands) {
      byId.set(command.id, command);
    }
    const normalizedQuery = query.toLowerCase();
    return Array.from(byId.values())
      .filter((command) => (
        `${command.title} ${command.category ?? ""} ${command.id}`.toLowerCase().includes(normalizedQuery)
      ))
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [manifestCommands, query, snapshotCommands]);

  if (manifestCommands.length === 0 && snapshotCommands.length === 0) {
    return (
      <EmptyToolState
        label={t("vscode.sidebar.commandsEmpty")}
        action={<ImportVSCodeProfileButton onImport={onImportProfile} isImporting={isImporting} />}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("vscode.sidebar.filterCommands")}
          className="h-8 w-full border border-border bg-background px-2 text-xs outline-none focus:border-primary"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {commands.map((command: VSCodeHostCommand) => (
          <button
            key={command.id}
            type="button"
            aria-label={command.title}
            onClick={() => {
              setError(null);
              void runCommand(command.id).catch((nextError) => {
                setError(nextError instanceof Error ? nextError.message : String(nextError));
              });
            }}
            className="flex min-h-9 w-full min-w-0 flex-col justify-center px-3 text-left hover:bg-muted"
          >
            <span className="truncate text-xs text-foreground">{command.title}</span>
            <span className="truncate text-[10px] text-muted-foreground">{command.category || command.extensionId}</span>
          </button>
        ))}
      </div>
      {error ? <div className="border-t border-border px-3 py-2 text-[11px] text-destructive">{error}</div> : null}
    </div>
  );
}

function ExtensionsPanel({
  onImportProfile,
  isImporting,
  diagnostics,
  containers,
}: {
  onImportProfile: () => void;
  isImporting: boolean;
  diagnostics: VSCodeContributionDiagnostic[];
  containers: VSCodeContributionContainer[];
}) {
  const { t } = useI18n();
  const importedExtensions = useVSCodeCompatStore((state) => state.extensions);
  const snapshot = useVSCodeExtensionHostStore((state) => state.snapshot);
  const resolveTree = useVSCodeExtensionHostStore((state) => state.resolveTree);
  const resolveView = useVSCodeExtensionHostStore((state) => state.resolveView);
  const postViewMessage = useVSCodeExtensionHostStore((state) => state.postViewMessage);
  const drainViewMessages = useVSCodeExtensionHostStore((state) => state.drainViewMessages);
  const runCommand = useVSCodeExtensionHostStore((state) => state.runCommand);
  const activateExtension = useVSCodeExtensionHostStore((state) => state.activateExtension);
  const [selectedView, setSelectedView] = useState<VSCodeHostView | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<VSCodeContributionContainer | null>(null);
  const [treeContent, setTreeContent] = useState<VSCodeHostTreeContent | null>(null);
  const [webviews, setWebviews] = useState<Record<string, VSCodeHostWebviewContent>>({});
  const [loadingViewId, setLoadingViewId] = useState<string | null>(null);
  const [activatingExtensionId, setActivatingExtensionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const extensionTools = useMemo(() => {
    const extensionById = new Map(importedExtensions.map((extension) => [extension.id, extension]));
    const tools = new Map<string, VSCodeContributionContainer>();

    for (const container of containers) {
      const extension = extensionById.get(container.extensionId);
      const existing = tools.get(container.extensionId);
      if (!existing) {
        tools.set(container.extensionId, {
          id: `extension:${container.extensionId}`,
          title: extension?.displayName || container.extensionLabel,
          extensionId: container.extensionId,
          extensionLabel: extension?.displayName || container.extensionLabel,
          ...(extension?.icon || container.icon ? { icon: extension?.icon ?? container.icon } : {}),
          ...(extension?.path || container.extensionPath ? { extensionPath: extension?.path ?? container.extensionPath } : {}),
          status: container.status,
          views: [...container.views],
          commands: [...container.commands],
        });
        continue;
      }

      const viewIds = new Set(existing.views.map((view) => view.id));
      const commandIds = new Set(existing.commands.map((command) => command.id));
      existing.views.push(...container.views.filter((view) => !viewIds.has(view.id)));
      existing.commands.push(...container.commands.filter((command) => !commandIds.has(command.id)));
    }

    return Array.from(tools.values());
  }, [containers, importedExtensions]);
  const contributedExtensionIds = new Set(extensionTools.map((tool) => tool.extensionId));
  const runnableExtensions = importedExtensions.filter((extension) =>
    !contributedExtensionIds.has(extension.id) && snapshot.extensions.some((item) => item.id === extension.id),
  );
  const importedOnlyExtensions = importedExtensions.filter((extension) =>
    !snapshot.extensions.some((item) => item.id === extension.id),
  );
  const groupedViewIds = new Set(extensionTools.flatMap((tool) => tool.views.map((view) => view.id)));
  const ungroupedViews = snapshot.views.filter((view) => !groupedViewIds.has(view.id));

  const activateImportedExtension = async (extensionId: string) => {
    setActivatingExtensionId(extensionId);
    setError(null);
    try {
      await activateExtension(extensionId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setActivatingExtensionId(null);
    }
  };

  const selectView = async (view: VSCodeHostView) => {
    setSelectedView(view);
    setLoadingViewId(view.id);
    setError(null);
    try {
      if (view.kind === "tree") {
        setTreeContent(await resolveTree(view.id));
      } else {
        const content = await resolveView(view.id);
        setWebviews((current) => ({ ...current, [view.id]: content }));
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoadingViewId(null);
    }
  };

  if (selectedContainer) {
    return (
      <ExtensionContainerPanel
        container={selectedContainer}
        onClose={() => setSelectedContainer(null)}
      />
    );
  }

  if (selectedView) {
    const activeWebview = webviews[selectedView.id];
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
          <button
            type="button"
            aria-label={t("common.back")}
            onClick={() => setSelectedView(null)}
            className="flex h-7 w-7 items-center justify-center hover:bg-muted"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
          </button>
          <span className="truncate text-xs font-medium">{selectedView.title}</span>
          {loadingViewId === selectedView.id ? <LoaderCircle className="ml-auto h-3.5 w-3.5 animate-spin" /> : null}
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          {error ? <div className="p-3 text-xs text-destructive">{error}</div> : null}
          {selectedView.kind === "tree" && treeContent?.viewId === selectedView.id ? (
            <TreeItems
              items={treeContent.items}
              onCommand={(command) => void runCommand(command.command, command.arguments)}
            />
          ) : null}
          {selectedView.kind !== "tree" && activeWebview ? (
            <VSCodeWebviewFrame
              content={activeWebview}
              onMessage={postViewMessage}
              drainMessages={drainViewMessages}
            />
          ) : null}
        </div>
      </div>
    );
  }

  if (importedExtensions.length === 0 && snapshot.views.length === 0) {
    return (
      <EmptyToolState
        label={t("vscode.sidebar.extensionsEmpty")}
        action={<ImportVSCodeProfileButton onImport={onImportProfile} isImporting={isImporting} />}
      />
    );
  }

  return (
    <div className="h-full min-h-0 overflow-auto">
      {snapshot.status === "error" && snapshot.lastError ? <div className="border-b border-border px-3 py-2 text-[11px] text-destructive">{snapshot.lastError}</div> : null}
      {diagnostics.length > 0 ? (
        <SidebarSection title={t("vscode.sidebar.compatibilityDiagnostics")}>
          {diagnostics.map((diagnostic, index) => (
            <div key={`${diagnostic.extensionId}:${diagnostic.code ?? diagnostic.status}:${index}`} className="space-y-1 px-3 py-2 text-[11px]">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                <span className="truncate font-medium text-foreground">{diagnostic.extensionLabel}</span>
                <span className="ml-auto text-muted-foreground">{diagnostic.status}</span>
              </div>
              {diagnostic.error ? <div className="break-words text-destructive">{diagnostic.error}</div> : null}
              {diagnostic.missingApi.map((api) => (
                <code key={api} className="block break-all text-muted-foreground">{api}</code>
              ))}
            </div>
          ))}
        </SidebarSection>
      ) : null}
      {extensionTools.length > 0 ? (
        <SidebarSection title={t("vscode.sidebar.contributedViews")}>
          {extensionTools.map((tool) => (
            <button
              key={tool.extensionId}
              type="button"
              aria-label={tool.title}
              onClick={() => setSelectedContainer(tool)}
              className="flex min-h-10 w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
            >
              <VSCodeExtensionIcon iconPath={tool.icon} label={tool.title} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-foreground">{tool.title}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {tool.views.length > 0 ? `${tool.views.length} views` : `${tool.commands.length} commands`}
                </div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </SidebarSection>
      ) : null}
      <SidebarSection title={t("vscode.sidebar.runnableExtensions")}>
        {runnableExtensions.map((extension) => {
          const hostState = snapshot.extensions.find((item) => item.id === extension.id);
          const isActivating = activatingExtensionId === extension.id;
          const statusLabel = hostState?.status === "active"
            ? t("vscode.sidebar.extensionStatus.active")
            : hostState?.status === "failed"
              ? t("vscode.sidebar.extensionStatus.failed")
              : t("vscode.sidebar.extensionStatus.onDemand");
          return (
            <div key={extension.id} className="flex min-h-11 items-center gap-2 border-b border-border/60 px-3 py-1.5 last:border-b-0">
              {hostState?.status === "active" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <VSCodeExtensionIcon iconPath={extension.icon} label={extension.displayName || extension.id} />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-foreground">{extension.displayName || extension.id}</div>
                <div className={cn("truncate text-[10px]", hostState?.status === "failed" ? "text-destructive" : "text-muted-foreground")} title={hostState?.error}>
                  {statusLabel}
                  {hostState?.commandCount || hostState?.viewCount ? ` · ${hostState.commandCount} commands · ${hostState.viewCount} views` : ""}
                </div>
              </div>
              {hostState?.status !== "active" ? (
                <button
                  type="button"
                  onClick={() => void activateImportedExtension(extension.id)}
                  disabled={isActivating || snapshot.status !== "ready"}
                  className="flex h-7 items-center gap-1 px-2 text-[10px] text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  title={hostState?.status === "failed" ? t("vscode.sidebar.retryExtension") : t("vscode.sidebar.activateExtension")}
                >
                  {isActivating ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
                  <span>{hostState?.status === "failed" ? t("vscode.sidebar.retry") : t("vscode.sidebar.activate")}</span>
                </button>
              ) : null}
            </div>
          );
        })}
      </SidebarSection>
      {importedOnlyExtensions.length > 0 ? (
        <details className="border-b border-border">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-muted-foreground hover:bg-muted">
            {t("vscode.sidebar.importedOnlyExtensions")} ({importedOnlyExtensions.length})
          </summary>
          {importedOnlyExtensions.map((extension) => (
            <div key={extension.id} className="flex min-h-9 items-center gap-2 px-3 py-1.5 text-xs">
              <VSCodeExtensionIcon iconPath={extension.icon} label={extension.displayName || extension.id} className="h-3.5 w-3.5" />
              <div className="min-w-0">
                <div className="truncate text-foreground">{extension.displayName || extension.id}</div>
                <div className="truncate text-[10px] text-muted-foreground">{t("vscode.sidebar.extensionStatus.metadataOnly")}</div>
              </div>
            </div>
          ))}
        </details>
      ) : null}
      {ungroupedViews.length > 0 ? (
        <SidebarSection title={t("vscode.sidebar.contributedViews")}>
          {ungroupedViews.map((view) => (
            <button
              key={view.id}
              type="button"
              aria-label={view.title}
              onClick={() => void selectView(view)}
              className="flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-xs hover:bg-muted"
            >
              {view.kind === "tree" ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <Boxes className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{view.title}</span>
            </button>
          ))}
        </SidebarSection>
      ) : null}
    </div>
  );
}

function ExtensionContainerPanel({
  container,
  onClose,
}: {
  container: VSCodeContributionContainer;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const activateExtension = useVSCodeExtensionHostStore((state) => state.activateExtension);
  const activateView = useVSCodeExtensionHostStore((state) => state.activateView);
  const resolveTree = useVSCodeExtensionHostStore((state) => state.resolveTree);
  const resolveView = useVSCodeExtensionHostStore((state) => state.resolveView);
  const postViewMessage = useVSCodeExtensionHostStore((state) => state.postViewMessage);
  const drainViewMessages = useVSCodeExtensionHostStore((state) => state.drainViewMessages);
  const runCommand = useVSCodeExtensionHostStore((state) => state.runCommand);
  const [selectedView, setSelectedView] = useState<VSCodeHostView | null>(null);
  const [treeContent, setTreeContent] = useState<VSCodeHostTreeContent | null>(null);
  const [webviewContent, setWebviewContent] = useState<VSCodeHostWebviewContent | null>(null);
  const [loadingViewId, setLoadingViewId] = useState<string | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoOpenedViewRef = useRef<string | null>(null);

  const openView = useCallback(async (
    viewId: string,
    sourceSnapshot: VSCodeHostSnapshot = useVSCodeExtensionHostStore.getState().snapshot,
  ) => {
    setLoadingViewId(viewId);
    setError(null);
    setSelectedView(null);
    setTreeContent(null);
    setWebviewContent(null);
    try {
      let nextSnapshot = sourceSnapshot;
      let hostView = nextSnapshot.views.find((view) => view.id === viewId);
      if (!hostView) {
        nextSnapshot = await activateView(viewId);
        hostView = nextSnapshot.views.find((view) => view.id === viewId);
      }
      if (!hostView) {
        throw new Error(`VS Code view did not register after activation: ${viewId}`);
      }
      setSelectedView(hostView);
      if (hostView.kind === "tree") {
        setTreeContent(await resolveTree(viewId));
        setWebviewContent(null);
      } else if (hostView.kind === "webview") {
        setWebviewContent(await resolveView(viewId));
        setTreeContent(null);
      } else {
        throw new Error(`Unsupported VS Code view kind: ${hostView.kind}`);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoadingViewId(null);
    }
  }, [activateView, resolveTree, resolveView]);

  const primaryViewId = container.views[0]?.id;

  const activateAndOpenPrimaryView = useCallback(async () => {
    setIsActivating(true);
    setError(null);
    try {
      if (!primaryViewId) {
        throw new Error(t("vscode.sidebar.extensionViewsEmpty"));
      }
      const currentSnapshot = useVSCodeExtensionHostStore.getState().snapshot;
      const hostState = currentSnapshot.extensions.find((extension) => extension.id === container.extensionId);
      const nextSnapshot = hostState?.status === "active"
        ? currentSnapshot
        : await activateExtension(container.extensionId);
      await openView(primaryViewId, nextSnapshot);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsActivating(false);
    }
  }, [activateExtension, container.extensionId, openView, primaryViewId, t]);

  useEffect(() => {
    const autoOpenKey = `${container.extensionId}:${primaryViewId ?? "none"}`;
    if (autoOpenedViewRef.current === autoOpenKey) return;
    autoOpenedViewRef.current = autoOpenKey;
    void activateAndOpenPrimaryView();
  }, [activateAndOpenPrimaryView, container.extensionId, primaryViewId]);

  const activeViewId = selectedView?.id ?? loadingViewId ?? primaryViewId;
  const isLoading = isActivating || loadingViewId !== null;
  const panelTitle = container.id.startsWith("builtin:") && selectedView
    ? selectedView.title
    : container.title;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        {onClose ? (
          <button
            type="button"
            aria-label={t("common.back")}
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center hover:bg-muted"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
          </button>
        ) : null}
        <VSCodeExtensionIcon iconPath={container.icon} label={panelTitle} className="h-3.5 w-3.5" />
        <span className="truncate text-xs font-medium">{panelTitle}</span>
        {isLoading ? <LoaderCircle aria-label={t("common.loading")} className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
      </header>

      {container.views.length > 1 ? (
        <div
          role="tablist"
          aria-label={container.title}
          className="flex h-8 shrink-0 overflow-x-auto border-b border-border px-1"
        >
          {container.views.map((view) => (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={activeViewId === view.id}
              aria-label={view.title}
              disabled={isLoading && loadingViewId !== view.id}
              onClick={() => void openView(view.id)}
              className={cn(
                "relative h-8 max-w-40 shrink-0 truncate px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50",
                activeViewId === view.id && "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary",
              )}
            >
              {view.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {error ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div className="max-w-full break-words text-xs text-destructive">{error}</div>
            <button
              type="button"
              onClick={() => void activateAndOpenPrimaryView()}
              className="inline-flex h-8 items-center gap-2 border border-border px-3 text-xs text-foreground hover:bg-muted"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("vscode.sidebar.retry")}
            </button>
          </div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center">
            <LoaderCircle aria-label={t("common.loading")} className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : selectedView?.kind === "tree" && treeContent ? (
          <div className="h-full overflow-auto">
            <TreeItems
              items={treeContent.items}
              onCommand={(command) => void runCommand(command.command, command.arguments)}
            />
          </div>
        ) : selectedView?.kind === "webview" && webviewContent ? (
          <VSCodeWebviewFrame
            content={webviewContent}
            onMessage={postViewMessage}
            drainMessages={drainViewMessages}
          />
        ) : null}
      </div>
    </div>
  );
}

function BuiltInToolPanel({
  title,
  views,
  children,
}: {
  title: string;
  views: VSCodeContributionView[];
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [showExtensionViews, setShowExtensionViews] = useState(false);

  if (showExtensionViews) {
    return (
      <ExtensionContainerPanel
        container={{
          id: `builtin:${title}`,
          title,
          extensionId: views[0]?.extensionId ?? "builtin",
          extensionLabel: title,
          status: "ready",
          views,
          commands: [],
        }}
        onClose={() => setShowExtensionViews(false)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      {views.length > 0 ? (
        <button
          type="button"
          aria-label={`${t("vscode.sidebar.extensionViews")} (${views.length})`}
          onClick={() => setShowExtensionViews(true)}
          className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-left text-xs text-foreground hover:bg-muted"
        >
          <Boxes className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t("vscode.sidebar.extensionViews")}</span>
          <span className="ml-auto text-[10px] text-muted-foreground">{views.length}</span>
        </button>
      ) : null}
    </div>
  );
}

export function VSCodeActivityPanel() {
  const { t } = useI18n();
  const [activeTool, setActiveTool] = useState<VSCodeToolId>("explorer");
  const enabled = useSettingsStore((state) => state.settings.vscodeCompatEnabled);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const settings = useVSCodeCompatStore((state) => state.settings);
  const extensions = useVSCodeCompatStore((state) => state.extensions);
  const replaceVSCodeCompatState = useVSCodeCompatStore((state) => state.replaceState);
  const syncWithCompat = useVSCodeExtensionHostStore((state) => state.syncWithCompat);
  const hostSnapshot = useVSCodeExtensionHostStore((state) => state.snapshot);
  const [isImportingProfile, setIsImportingProfile] = useState(false);
  const [profileImportError, setProfileImportError] = useState<string | null>(null);
  const staleExtensionRefreshAttempted = useRef(false);
  const contributionRegistry = useMemo(
    () => buildVSCodeContributionRegistry(extensions, hostSnapshot),
    [extensions, hostSnapshot],
  );
  const importProfile = useCallback(async () => {
    setIsImportingProfile(true);
    setProfileImportError(null);
    try {
      const result = await readVSCodeConfigFromDetectedProfiles();
      const imported = importVSCodeSettingsFile(result.config);
      await replaceVSCodeCompatState({
        settings: imported.settings,
        keybindings: imported.keybindings,
        snippets: imported.snippets,
        tasks: imported.tasks,
        launches: imported.launches,
        extensions: normalizeVSCodeExtensionInventory(imported.extensions),
        importedAt: Date.now(),
        sourceLabel: result.sourceLabel,
        warnings: [...imported.warnings, ...result.warnings],
      });
    } catch (error) {
      setProfileImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsImportingProfile(false);
    }
  }, [replaceVSCodeCompatState]);

  useEffect(() => {
    const hasMovedExtensionEntry = hostSnapshot.extensions.some((extension) =>
      extension.status === "failed" && /Extension entry not found:/i.test(extension.error ?? ""),
    );
    if (!enabled || !hasMovedExtensionEntry || staleExtensionRefreshAttempted.current) {
      return;
    }
    staleExtensionRefreshAttempted.current = true;
    void importProfile();
  }, [enabled, hostSnapshot.extensions, importProfile]);

  useEffect(() => {
    void syncWithCompat({
      enabled,
      workspaceRootPath,
      extensions,
      settings,
    }).catch(() => undefined);
  }, [enabled, extensions, settings, syncWithCompat, workspaceRootPath]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-card" data-testid="vscode-activity-panel">
      <header className="flex h-10 shrink-0 items-center border-b border-border px-3">
        <h2 className="truncate text-xs font-semibold uppercase text-foreground">
          {t("vscode.sidebar.title")}
        </h2>
      </header>
      {profileImportError ? (
        <div role="alert" className="border-b border-border px-3 py-2 text-[11px] text-destructive">
          {profileImportError}
        </div>
      ) : null}

      <nav className="flex h-10 shrink-0 overflow-x-auto border-b border-border" aria-label={t("vscode.sidebar.title")}>
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const label = t(tool.labelKey);
          const active = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              aria-label={label}
              aria-pressed={active}
              title={label}
              onClick={() => {
                setActiveTool(tool.id);
              }}
              className={cn(
                "relative flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground transition-colors",
                "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50",
                active && "bg-muted text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTool === "explorer" ? (
          <BuiltInToolPanel
            title={t("vscode.sidebar.explorer")}
            views={contributionRegistry.builtInViews.explorer ?? []}
          >
            <ExplorerSidebar />
          </BuiltInToolPanel>
        ) : null}
        {activeTool === "search" ? <WorkspaceSearchPanel /> : null}
        {activeTool === "source-control" ? (
          <BuiltInToolPanel
            title={t("vscode.sidebar.sourceControl")}
            views={contributionRegistry.builtInViews.scm ?? []}
          >
            <VSCodeSourceControlPanel />
          </BuiltInToolPanel>
        ) : null}
        {activeTool === "run-debug" ? (
          <BuiltInToolPanel
            title={t("vscode.sidebar.runDebug")}
            views={contributionRegistry.builtInViews.debug ?? []}
          >
            <VSCodeRunDebugPanel onImportProfile={() => void importProfile()} isImporting={isImportingProfile} />
          </BuiltInToolPanel>
        ) : null}
        {activeTool === "extensions" ? (
          <ExtensionsPanel
            onImportProfile={() => void importProfile()}
            isImporting={isImportingProfile}
            diagnostics={contributionRegistry.diagnostics}
            containers={contributionRegistry.containers}
          />
        ) : null}
        {activeTool === "commands" ? <CommandsPanel onImportProfile={() => void importProfile()} isImporting={isImportingProfile} /> : null}
        {activeTool === "terminal" ? <TerminalPanel workspaceRootPath={workspaceRootPath} /> : null}
      </div>
    </section>
  );
}
