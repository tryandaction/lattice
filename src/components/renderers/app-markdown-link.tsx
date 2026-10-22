"use client";

import { useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { navigateLinkWithFeedback } from "@/lib/link-router/navigate-link-with-feedback";
import { parseLinkTarget } from "@/lib/link-router/parse-link-target";
import {
  citationNavigationHref,
  classifyStrictAiLink,
  type CitationContract,
} from "@/lib/ai/citation-contract";
import type { PaneId } from "@/types/layout";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useI18n } from "@/hooks/use-i18n";
import type { EvidenceRef } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

interface AppMarkdownLinkProps extends Omit<ComponentPropsWithoutRef<"a">, "children"> {
  paneId?: PaneId;
  rootHandle?: FileSystemDirectoryHandle | null;
  currentFilePath?: string;
  children?: ReactNode;
  linkPolicy?: "workspace" | "strict-ai";
  citationContracts?: CitationContract[];
  onCitationNavigate?: (ref: EvidenceRef) => void;
  'data-ai-citation-number'?: number | string;
}

export function AppMarkdownLink({
  href,
  className,
  paneId,
  rootHandle,
  currentFilePath,
  children,
  linkPolicy = "workspace",
  citationContracts = [],
  onCitationNavigate,
  'data-ai-citation-number': citationNumber,
  ...anchorProps
}: AppMarkdownLinkProps) {
  const { t } = useI18n();
  const fallbackPaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const fallbackRootHandle = useWorkspaceStore((state) => state.rootHandle);
  const strictClassification = useMemo(
    () => (linkPolicy === "strict-ai"
      ? classifyStrictAiLink(href ?? "", citationContracts)
      : null),
    [citationContracts, href, linkPolicy],
  );
  const effectiveHref = useMemo(
    () => {
      if (!strictClassification || strictClassification.kind === "external_url") {
        return strictClassification?.href ?? href;
      }
      if (strictClassification.kind === "plain_text") return undefined;
      return citationNavigationHref(strictClassification.citation) ?? strictClassification.href;
    },
    [href, strictClassification],
  );
  const parsedTarget = useMemo(
    () => (effectiveHref ? parseLinkTarget(effectiveHref, { currentFilePath }) : null),
    [currentFilePath, effectiveHref],
  );
  const isAppLink = Boolean(parsedTarget?.target);
  const effectivePaneId = paneId ?? fallbackPaneId;
  const effectiveRootHandle = rootHandle ?? fallbackRootHandle;
  const citation = strictClassification && "citation" in strictClassification ? strictClassification.citation : null;

  if (linkPolicy === "strict-ai" && strictClassification?.kind === "plain_text") {
    if (href?.startsWith("citation:")) {
      return <span className="text-muted-foreground" title={t("chat.citation.unresolvedDetail")} data-ai-citation-unresolved="true">{children}<span className="ml-1 text-[10px]">({t("chat.citation.unresolved")})</span></span>;
    }
    return <span>{children}</span>;
  }

  return (
    <a
      href={effectiveHref}
      className={cn(className, citation && "mx-0.5 inline-flex min-h-[1.45em] min-w-[1.45em] items-center justify-center rounded-full border border-primary/45 bg-primary/5 px-1 align-baseline text-[0.85em] font-medium leading-none no-underline hover:bg-primary/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary")}
      target={isAppLink ? undefined : "_blank"}
      rel={isAppLink ? undefined : "noopener noreferrer"}
      {...anchorProps}
      title={strictClassification && "citation" in strictClassification
        ? [strictClassification.citation.basename, strictClassification.citation.page ? `p.${strictClassification.citation.page}` : "", strictClassification.citation.boundedQuote].filter(Boolean).join(" · ")
        : anchorProps.title}
      data-ai-citation={strictClassification && "citation" in strictClassification ? "true" : undefined}
      onClick={(event) => {
        if (onCitationNavigate && strictClassification && "citation" in strictClassification) {
          event.preventDefault();
          event.stopPropagation();
          onCitationNavigate(strictClassification.citation.evidenceRef);
          return;
        }
        if (!effectiveHref || !isAppLink || !effectivePaneId) {
          anchorProps.onClick?.(event);
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        anchorProps.onClick?.(event);
        void navigateLinkWithFeedback(effectiveHref, {
          paneId: effectivePaneId,
          rootHandle: effectiveRootHandle,
          currentFilePath,
          ...(linkPolicy === "strict-ai" ? { pathMode: "workspace" as const } : {}),
          ...(strictClassification && "citation" in strictClassification
            ? { evidenceAnchor: strictClassification.citation.evidenceRef.anchor }
            : {}),
          externalUrlMode: (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            ? "external"
            : "internal",
        });
      }}
    >
      {citation ? <><span aria-hidden="true">{citationNumber ?? "↗"}</span><span className="sr-only">{children ?? citation.displayTitle}</span></> : children}
    </a>
  );
}

export default AppMarkdownLink;
