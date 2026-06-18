"use client";

import { memo, useMemo, useState, useSyncExternalStore } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, FileText, GitBranch, Link2, MoveUpRight, Paperclip, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
import {
  getWorkspaceMarkdownBacklinks,
  getWorkspaceMarkdownBrokenLinks,
  getWorkspaceMarkdownFiles,
  getWorkspaceMarkdownLocalGraph,
  getWorkspaceMarkdownLinkIndex,
  getWorkspaceMarkdownOutgoingLinks,
  getWorkspaceMarkdownUnlinkedMentions,
  subscribeWorkspaceMarkdownLinkIndex,
  type MarkdownUnlinkedMention,
} from "@/lib/markdown/workspace-link-index";
import type { IndexedMarkdownLink, MarkdownBacklink } from "@/lib/markdown/link-index";
import type { MarkdownGraph } from "@/lib/markdown/graph";
import type { MarkdownAttachmentCleanupCandidate } from "@/lib/markdown/attachment-cleanup";

type LinkPanelSectionId = "backlinks" | "unlinked" | "outgoing" | "broken" | "attachments" | "graph";

type CollapsedSections = Partial<Record<LinkPanelSectionId, boolean>>;

const COLLAPSED_SECTIONS_STORAGE_KEY = "lattice-markdown-links-panel-collapsed";

interface MarkdownLinksPanelProps {
  filePath?: string;
  onNavigate: (target: string) => void;
  onNavigateToSource: (file: string, line: number) => void;
  onCreateMissingNote?: (link: IndexedMarkdownLink) => void;
  onLinkUnlinkedMention?: (mention: MarkdownUnlinkedMention) => void;
  onLinkUnlinkedMentions?: (mentions: MarkdownUnlinkedMention[]) => void;
  onIgnoreUnlinkedMention?: (mention: MarkdownUnlinkedMention) => void;
  onRepairBrokenLink?: (link: IndexedMarkdownLink, targetFile: string) => void;
  onConvertMarkdownLinkToWiki?: (link: IndexedMarkdownLink) => void;
  attachmentCleanupCandidates?: MarkdownAttachmentCleanupCandidate[];
  onReviewUnreferencedAttachment?: (candidate: MarkdownAttachmentCleanupCandidate) => void;
  className?: string;
}

function getSnapshotVersion(): number {
  return getWorkspaceMarkdownLinkIndex().lastScan;
}

function getServerSnapshotVersion(): number {
  return 0;
}

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function formatTarget(link: IndexedMarkdownLink): string {
  return link.displayText || link.rawTarget;
}

function formatBacklink(backlink: MarkdownBacklink): string {
  return backlink.displayText || backlink.rawTarget;
}

function loadCollapsedSections(): CollapsedSections {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY);
    return raw ? JSON.parse(raw) as CollapsedSections : {};
  } catch {
    return {};
  }
}

function saveCollapsedSections(collapsedSections: CollapsedSections): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(collapsedSections));
  } catch {
    // UI preferences should never break the links panel.
  }
}

function matchesFilter(values: Array<string | undefined>, filter: string): boolean {
  if (!filter) {
    return true;
  }
  return values.some((value) => value?.toLowerCase().includes(filter));
}

function EmptyState({ label }: { label: string }) {
  return <div className="px-3 py-1.5 text-xs text-muted-foreground">{label}</div>;
}

function PanelSection({
  sectionId,
  title,
  count,
  collapsed,
  onToggle,
  children,
}: {
  sectionId: LinkPanelSectionId;
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: (sectionId: LinkPanelSectionId) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="py-2">
      <button
        type="button"
        onClick={() => onToggle(sectionId)}
        className={cn(
          "flex w-full items-center justify-between px-3 py-1 text-left",
          "hover:bg-accent/40 focus:outline-none focus:ring-1 focus:ring-primary/50",
        )}
        aria-expanded={!collapsed}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
        </span>
        <span className="text-xs text-muted-foreground">{count}</span>
      </button>
      {!collapsed && <div className="px-1">{children}</div>}
    </section>
  );
}

function BacklinkRow({
  backlink,
  onNavigateToSource,
}: {
  backlink: MarkdownBacklink;
  onNavigateToSource: (file: string, line: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigateToSource(backlink.sourceFile, backlink.sourceLine)}
      className={cn(
        "w-full rounded px-2 py-1.5 text-left text-sm transition-colors",
        "hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-primary/50",
      )}
      title={`${backlink.sourceFile}:${backlink.sourceLine}`}
    >
      <div className="flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{getFileName(backlink.sourceFile)}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">L{backlink.sourceLine}</span>
      </div>
      <div className="mt-0.5 truncate pl-5 text-xs text-muted-foreground">
        {formatBacklink(backlink)}
      </div>
    </button>
  );
}

function UnlinkedMentionRow({
  mention,
  linkLabel,
  ignoreLabel,
  onNavigateToSource,
  onLinkUnlinkedMention,
  onIgnoreUnlinkedMention,
}: {
  mention: MarkdownUnlinkedMention;
  linkLabel: string;
  ignoreLabel: string;
  onNavigateToSource: (file: string, line: number) => void;
  onLinkUnlinkedMention?: (mention: MarkdownUnlinkedMention) => void;
  onIgnoreUnlinkedMention?: (mention: MarkdownUnlinkedMention) => void;
}) {
  return (
    <div className="rounded px-2 py-1.5 text-sm">
      <button
        type="button"
        onClick={() => onNavigateToSource(mention.sourceFile, mention.sourceLine)}
        className={cn(
          "w-full rounded text-left transition-colors",
          "hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-primary/50",
        )}
        title={`${mention.sourceFile}:${mention.sourceLine}`}
      >
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{getFileName(mention.sourceFile)}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">L{mention.sourceLine}</span>
        </div>
        <div className="mt-0.5 truncate pl-5 text-xs text-muted-foreground">
          {mention.context}
        </div>
      </button>
      <div className="mt-1 ml-5 flex items-center gap-1">
        {onLinkUnlinkedMention && (
          <button
            type="button"
            onClick={() => onLinkUnlinkedMention(mention)}
            className={cn(
              "rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors",
              "hover:bg-accent/50 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50",
            )}
          >
            {linkLabel}
          </button>
        )}
        {onIgnoreUnlinkedMention && (
          <button
            type="button"
            onClick={() => onIgnoreUnlinkedMention(mention)}
            className={cn(
              "rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors",
              "hover:bg-accent/50 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50",
            )}
          >
            {ignoreLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function OutgoingRow({
  link,
  onNavigate,
}: {
  link: IndexedMarkdownLink;
  onNavigate: (target: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(link.rawTarget)}
      className={cn(
        "w-full rounded px-2 py-1.5 text-left text-sm transition-colors",
        "hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-primary/50",
      )}
      title={link.rawTarget}
    >
      <div className="flex items-center gap-2">
        <MoveUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{formatTarget(link)}</span>
      </div>
      {link.resolvedPath && (
        <div className="mt-0.5 truncate pl-5 text-xs text-muted-foreground">{link.resolvedPath}</div>
      )}
    </button>
  );
}

function BrokenRow({
  link,
  createLabel,
  repairLabel,
  repairTargetLabel,
  convertLabel,
  repairTargets,
  onCreateMissingNote,
  onRepairBrokenLink,
  onConvertMarkdownLinkToWiki,
}: {
  link: IndexedMarkdownLink;
  createLabel: string;
  repairLabel: string;
  repairTargetLabel: string;
  convertLabel: string;
  repairTargets: string[];
  onCreateMissingNote?: (link: IndexedMarkdownLink) => void;
  onRepairBrokenLink?: (link: IndexedMarkdownLink, targetFile: string) => void;
  onConvertMarkdownLinkToWiki?: (link: IndexedMarkdownLink) => void;
}) {
  const [selectedTarget, setSelectedTarget] = useState("");
  return (
    <div
      className="rounded px-2 py-1.5 text-sm"
      title={`${link.sourceFile}: ${link.rawTarget}`}
    >
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{link.displayText || link.rawTarget}</span>
      </div>
      <div className="mt-0.5 truncate pl-5 text-xs text-muted-foreground">
        {getFileName(link.sourceFile)}
      </div>
      {onCreateMissingNote && (
        <button
          type="button"
          onClick={() => onCreateMissingNote(link)}
          className={cn(
            "mt-1 ml-5 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors",
            "hover:bg-accent/50 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50",
          )}
        >
          {createLabel}
        </button>
      )}
      {onConvertMarkdownLinkToWiki && (
        <button
          type="button"
          onClick={() => onConvertMarkdownLinkToWiki(link)}
          className={cn(
            "mt-1 ml-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors",
            "hover:bg-accent/50 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50",
          )}
        >
          {convertLabel}
        </button>
      )}
      {onRepairBrokenLink && repairTargets.length > 0 && (
        <div className="mt-1 ml-5 flex min-w-0 items-center gap-1">
          <select
            aria-label={repairTargetLabel}
            value={selectedTarget}
            onChange={(event) => setSelectedTarget(event.target.value)}
            className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
          >
            <option value="">{repairTargetLabel}</option>
            {repairTargets.map((target) => (
              <option key={target} value={target}>{target}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selectedTarget}
            onClick={() => {
              if (selectedTarget) {
                onRepairBrokenLink(link, selectedTarget);
              }
            }}
            className={cn(
              "rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors",
              "hover:bg-accent/50 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50",
              !selectedTarget && "cursor-not-allowed opacity-50",
            )}
          >
            {repairLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function AttachmentCleanupRow({
  candidate,
  reviewLabel,
  onReview,
}: {
  candidate: MarkdownAttachmentCleanupCandidate;
  reviewLabel: string;
  onReview?: (candidate: MarkdownAttachmentCleanupCandidate) => void;
}) {
  return (
    <div className="rounded px-2 py-1.5 text-sm" title={candidate.displayPath}>
      <div className="flex items-center gap-2">
        <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{candidate.path}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          {candidate.extension}
        </span>
      </div>
      {onReview && (
        <button
          type="button"
          onClick={() => onReview(candidate)}
          className={cn(
            "mt-1 ml-5 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors",
            "hover:bg-accent/50 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50",
          )}
        >
          {reviewLabel}
        </button>
      )}
    </div>
  );
}

function buildGraphNodePosition(index: number, total: number): { x: number; y: number } {
  if (total <= 0) {
    return { x: 80, y: 48 };
  }
  const angle = (-Math.PI / 2) + (index / total) * Math.PI * 2;
  return {
    x: 80 + Math.cos(angle) * 48,
    y: 48 + Math.sin(angle) * 28,
  };
}

function LocalGraphPreview({
  centerLabel,
  neighbors,
  onNavigate,
  title,
}: {
  centerLabel: string;
  neighbors: MarkdownGraph["nodes"];
  onNavigate: (target: string) => void;
  title: string;
}) {
  const visibleNeighbors = neighbors.slice(0, 8);
  const overflowCount = Math.max(0, neighbors.length - visibleNeighbors.length);

  return (
    <div className="mx-2 mb-2 rounded border border-border bg-background px-2 py-2" title={title}>
      <svg
        viewBox="0 0 160 96"
        role="img"
        aria-label={title}
        className="h-24 w-full text-muted-foreground"
      >
        {visibleNeighbors.map((node, index) => {
          const position = buildGraphNodePosition(index, visibleNeighbors.length);
          return (
            <line
              key={`edge-${node.id}`}
              x1="80"
              y1="48"
              x2={position.x}
              y2={position.y}
              className="stroke-border"
              strokeWidth="1"
            />
          );
        })}
        <circle cx="80" cy="48" r="13" className="fill-primary/15 stroke-primary" strokeWidth="1.5" />
        <text x="80" y="51" textAnchor="middle" className="fill-foreground text-[8px] font-medium">
          {centerLabel.slice(0, 14)}
        </text>
        {visibleNeighbors.map((node, index) => {
          const position = buildGraphNodePosition(index, visibleNeighbors.length);
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`${title}: ${node.path}`}
              onClick={() => onNavigate(node.path)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onNavigate(node.path);
                }
              }}
              className="cursor-pointer focus:outline-none"
            >
              <circle
                cx={position.x}
                cy={position.y}
                r="9"
                className="fill-muted stroke-border transition-colors hover:fill-accent"
                strokeWidth="1"
              />
              <text
                x={position.x}
                y={position.y + 3}
                textAnchor="middle"
                className="pointer-events-none fill-muted-foreground text-[7px]"
              >
                {node.label.slice(0, 8)}
              </text>
            </g>
          );
        })}
        {overflowCount > 0 && (
          <text x="150" y="90" textAnchor="end" className="fill-muted-foreground text-[8px]">
            +{overflowCount}
          </text>
        )}
      </svg>
      <div className="mt-1 grid grid-cols-2 gap-1">
        {visibleNeighbors.map((node) => (
          <button
            key={`nav-${node.id}`}
            type="button"
            onClick={() => onNavigate(node.path)}
            className={cn(
              "truncate rounded px-1.5 py-0.5 text-left text-xs text-muted-foreground transition-colors",
              "hover:bg-accent/50 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50",
            )}
            title={node.path}
          >
            {node.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LocalGraphRow({
  centerLabel,
  neighbors,
  edgeCountLabel,
  previewLabel,
  onNavigate,
}: {
  centerLabel: string;
  neighbors: MarkdownGraph["nodes"];
  edgeCountLabel: string;
  previewLabel: string;
  onNavigate: (target: string) => void;
}) {
  if (neighbors.length === 0) {
    return null;
  }

  return (
    <div className="px-2 py-1.5">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        <span>{edgeCountLabel}</span>
      </div>
      <LocalGraphPreview
        centerLabel={centerLabel}
        neighbors={neighbors}
        onNavigate={onNavigate}
        title={previewLabel}
      />
      <div className="space-y-1">
        {neighbors.map((node) => (
          <button
            key={node.id}
            type="button"
            onClick={() => onNavigate(node.path)}
            className={cn(
              "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm transition-colors",
              "hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-primary/50",
            )}
            title={node.path}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{node.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{node.degree}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function getLocalGraphNeighbors(graph: MarkdownGraph, filePath: string): MarkdownGraph["nodes"] {
  const neighborIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === filePath) neighborIds.add(edge.target);
    if (edge.target === filePath) neighborIds.add(edge.source);
  }
  return graph.nodes.filter((node) => neighborIds.has(node.id) && !node.broken);
}

function MarkdownLinksPanelComponent({
  filePath,
  onNavigate,
  onNavigateToSource,
  onCreateMissingNote,
  onLinkUnlinkedMention,
  onLinkUnlinkedMentions,
  onIgnoreUnlinkedMention,
  onRepairBrokenLink,
  onConvertMarkdownLinkToWiki,
  attachmentCleanupCandidates = [],
  onReviewUnreferencedAttachment,
  className,
}: MarkdownLinksPanelProps) {
  const { t } = useI18n();
  const [filterText, setFilterText] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<CollapsedSections>(() => loadCollapsedSections());
  useSyncExternalStore(
    subscribeWorkspaceMarkdownLinkIndex,
    getSnapshotVersion,
    getServerSnapshotVersion,
  );

  const backlinks = useMemo(
    () => (filePath ? getWorkspaceMarkdownBacklinks(filePath) : []),
    [filePath],
  );
  const outgoing = useMemo(
    () => (filePath ? getWorkspaceMarkdownOutgoingLinks(filePath) : []),
    [filePath],
  );
  const unlinkedMentions = useMemo(
    () => (filePath ? getWorkspaceMarkdownUnlinkedMentions(filePath) : []),
    [filePath],
  );
  const broken = useMemo(
    () => (filePath ? getWorkspaceMarkdownBrokenLinks().filter((link) => link.sourceFile === filePath) : []),
    [filePath],
  );
  const localGraph = useMemo(
    () => (filePath ? getWorkspaceMarkdownLocalGraph(filePath, 1) : { nodes: [], edges: [] }),
    [filePath],
  );
  const localGraphNeighbors = useMemo(
    () => (filePath ? getLocalGraphNeighbors(localGraph, filePath) : []),
    [filePath, localGraph],
  );
  const localGraphCenterLabel = useMemo(
    () => localGraph.nodes.find((node) => node.path === filePath)?.label ?? (filePath ? getFileName(filePath) : ""),
    [filePath, localGraph.nodes],
  );
  const repairTargets = useMemo(
    () => getWorkspaceMarkdownFiles().filter((target) => target !== filePath),
    [filePath],
  );
  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredBacklinks = useMemo(
    () => backlinks.filter((backlink) => matchesFilter([
      backlink.sourceFile,
      backlink.rawTarget,
      backlink.displayText,
      String(backlink.sourceLine),
    ], normalizedFilter)),
    [backlinks, normalizedFilter],
  );
  const filteredUnlinkedMentions = useMemo(
    () => unlinkedMentions.filter((mention) => matchesFilter([
      mention.sourceFile,
      mention.context,
      mention.mention,
    ], normalizedFilter)),
    [unlinkedMentions, normalizedFilter],
  );
  const filteredOutgoing = useMemo(
    () => outgoing.filter((link) => matchesFilter([
      link.rawTarget,
      link.displayText,
      link.resolvedPath,
    ], normalizedFilter)),
    [outgoing, normalizedFilter],
  );
  const filteredBroken = useMemo(
    () => broken.filter((link) => matchesFilter([
      link.sourceFile,
      link.rawTarget,
      link.displayText,
    ], normalizedFilter)),
    [broken, normalizedFilter],
  );
  const filteredAttachmentCleanupCandidates = useMemo(
    () => attachmentCleanupCandidates.filter((candidate) => matchesFilter([
      candidate.path,
      candidate.displayPath,
      candidate.extension,
    ], normalizedFilter)),
    [attachmentCleanupCandidates, normalizedFilter],
  );
  const filteredGraphNeighbors = useMemo(
    () => localGraphNeighbors.filter((node) => matchesFilter([
      node.path,
      node.label,
    ], normalizedFilter)),
    [localGraphNeighbors, normalizedFilter],
  );
  const toggleSection = (sectionId: LinkPanelSectionId) => {
    setCollapsedSections((current) => {
      const next = { ...current, [sectionId]: !current[sectionId] };
      saveCollapsedSections(next);
      return next;
    });
  };

  return (
    <div className={cn("markdown-links-panel h-full overflow-auto bg-muted/20", className)}>
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <span>{t("markdown.links.title")}</span>
        </div>
        {filePath && <div className="mt-1 truncate text-xs text-muted-foreground">{filePath}</div>}
        <label className="mt-2 flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-xs">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder={t("markdown.links.filter")}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <PanelSection
        sectionId="backlinks"
        title={t("markdown.links.backlinks")}
        count={filteredBacklinks.length}
        collapsed={Boolean(collapsedSections.backlinks)}
        onToggle={toggleSection}
      >
        {filteredBacklinks.length > 0 ? (
          filteredBacklinks.map((backlink, index) => (
            <BacklinkRow
              key={`${backlink.sourceFile}-${backlink.sourceLine}-${index}`}
              backlink={backlink}
              onNavigateToSource={onNavigateToSource}
            />
          ))
        ) : (
          <EmptyState label={t("markdown.links.noBacklinks")} />
        )}
      </PanelSection>

      <PanelSection
        sectionId="unlinked"
        title={t("markdown.links.unlinkedMentions")}
        count={filteredUnlinkedMentions.length}
        collapsed={Boolean(collapsedSections.unlinked)}
        onToggle={toggleSection}
      >
        {filteredUnlinkedMentions.length > 1 && onLinkUnlinkedMentions && (
          <div className="px-2 pb-1">
            <button
              type="button"
              onClick={() => onLinkUnlinkedMentions(filteredUnlinkedMentions)}
              className={cn(
                "rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors",
                "hover:bg-accent/50 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50",
              )}
            >
              {t("markdown.links.linkAllVisible")}
            </button>
          </div>
        )}
        {filteredUnlinkedMentions.length > 0 ? (
          filteredUnlinkedMentions.map((mention, index) => (
            <UnlinkedMentionRow
              key={`${mention.sourceFile}-${mention.sourceLine}-${index}`}
              mention={mention}
              linkLabel={t("markdown.links.linkMention")}
              ignoreLabel={t("markdown.links.ignoreMention")}
              onNavigateToSource={onNavigateToSource}
              onLinkUnlinkedMention={onLinkUnlinkedMention}
              onIgnoreUnlinkedMention={onIgnoreUnlinkedMention}
            />
          ))
        ) : (
          <EmptyState label={t("markdown.links.noUnlinkedMentions")} />
        )}
      </PanelSection>

      <PanelSection
        sectionId="outgoing"
        title={t("markdown.links.outgoing")}
        count={filteredOutgoing.length}
        collapsed={Boolean(collapsedSections.outgoing)}
        onToggle={toggleSection}
      >
        {filteredOutgoing.length > 0 ? (
          filteredOutgoing.map((link, index) => (
            <OutgoingRow key={`${link.rawTarget}-${index}`} link={link} onNavigate={onNavigate} />
          ))
        ) : (
          <EmptyState label={t("markdown.links.noOutgoing")} />
        )}
      </PanelSection>

      <PanelSection
        sectionId="broken"
        title={t("markdown.links.broken")}
        count={filteredBroken.length}
        collapsed={Boolean(collapsedSections.broken)}
        onToggle={toggleSection}
      >
        {filteredBroken.length > 0 ? (
          filteredBroken.map((link, index) => (
            <BrokenRow
              key={`${link.rawTarget}-${index}`}
              link={link}
              createLabel={t("markdown.links.createNote")}
              repairLabel={t("markdown.links.repairLink")}
              repairTargetLabel={t("markdown.links.repairTarget")}
              convertLabel={t("markdown.links.convertToWiki")}
              repairTargets={repairTargets}
              onCreateMissingNote={onCreateMissingNote}
              onRepairBrokenLink={onRepairBrokenLink}
              onConvertMarkdownLinkToWiki={onConvertMarkdownLinkToWiki}
            />
          ))
        ) : (
          <EmptyState label={t("markdown.links.noBroken")} />
        )}
      </PanelSection>

      <PanelSection
        sectionId="attachments"
        title={t("markdown.links.attachments")}
        count={filteredAttachmentCleanupCandidates.length}
        collapsed={Boolean(collapsedSections.attachments)}
        onToggle={toggleSection}
      >
        {filteredAttachmentCleanupCandidates.length > 0 ? (
          filteredAttachmentCleanupCandidates.map((candidate) => (
            <AttachmentCleanupRow
              key={candidate.path}
              candidate={candidate}
              reviewLabel={t("markdown.links.reviewAttachment")}
              onReview={onReviewUnreferencedAttachment}
            />
          ))
        ) : (
          <EmptyState label={t("markdown.links.noUnreferencedAttachments")} />
        )}
      </PanelSection>

      <PanelSection
        sectionId="graph"
        title={t("markdown.links.localGraph")}
        count={filteredGraphNeighbors.length}
        collapsed={Boolean(collapsedSections.graph)}
        onToggle={toggleSection}
      >
        {filePath && filteredGraphNeighbors.length > 0 ? (
          <LocalGraphRow
            centerLabel={localGraphCenterLabel}
            neighbors={filteredGraphNeighbors}
            edgeCountLabel={t("markdown.links.localGraph.edgeCount", { count: localGraph.edges.length })}
            previewLabel={t("markdown.links.localGraph.preview")}
            onNavigate={onNavigate}
          />
        ) : (
          <EmptyState label={t("markdown.links.noLocalGraph")} />
        )}
      </PanelSection>
    </div>
  );
}

export const MarkdownLinksPanel = memo(MarkdownLinksPanelComponent);
MarkdownLinksPanel.displayName = "MarkdownLinksPanel";
