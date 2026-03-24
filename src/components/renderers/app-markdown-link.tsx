"use client";

import { useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { parseLinkTarget } from "@/lib/link-router/parse-link-target";
import type { PaneId } from "@/types/layout";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface AppMarkdownLinkProps extends Omit<ComponentPropsWithoutRef<"a">, "children"> {
  paneId?: PaneId;
  rootHandle?: FileSystemDirectoryHandle | null;
  currentFilePath?: string;
  children?: ReactNode;
}

export function AppMarkdownLink({
  href,
  className,
  paneId,
  rootHandle,
  currentFilePath,
  children,
  ...anchorProps
}: AppMarkdownLinkProps) {
  const fallbackPaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const fallbackRootHandle = useWorkspaceStore((state) => state.rootHandle);
  const parsedTarget = useMemo(
    () => (href ? parseLinkTarget(href, { currentFilePath }) : null),
    [currentFilePath, href],
  );
  const isAppLink = Boolean(parsedTarget?.target && parsedTarget.target.type !== "external_url");
  const effectivePaneId = paneId ?? fallbackPaneId;
  const effectiveRootHandle = rootHandle ?? fallbackRootHandle;

  return (
    <a
      href={href}
      className={className}
      target={isAppLink ? undefined : "_blank"}
      rel={isAppLink ? undefined : "noopener noreferrer"}
      {...anchorProps}
      onClick={(event) => {
        if (!href || !isAppLink || !effectivePaneId) {
          anchorProps.onClick?.(event);
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        anchorProps.onClick?.(event);
        void navigateLink(href, {
          paneId: effectivePaneId,
          rootHandle: effectiveRootHandle,
          currentFilePath,
        });
      }}
    >
      {children}
    </a>
  );
}

export default AppMarkdownLink;
