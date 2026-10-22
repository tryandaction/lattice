/**
 * Generic item workspace model.
 *
 * A shared library contains items of many kinds (pdf, markdown, code,
 * notebook, image, web_snapshot, ...). Instead of forking the workspace for
 * each kind, an `ItemWorkspaceAdapter` contributes the kind-specific regions
 * (header strip, content viewer, tool panel) and the generic
 * `ItemWorkspaceShell` composes them. Existing viewers — e.g. the PDF item
 * workspace panel — are reused through an adapter rather than reimplemented.
 *
 * Authorization is UX-only here: real enforcement lives in RLS / the cloud
 * API (design section 12.2).
 */

import type { ReactNode } from "react";

export type ItemKind =
  | "pdf"
  | "markdown"
  | "code"
  | "notebook"
  | "docx"
  | "pptx"
  | "image"
  | "web_snapshot"
  | "data"
  | (string & {});

export interface ItemWorkspaceItem {
  id: string;
  kind: ItemKind;
  title: string;
  /** Optional local file backing (local-first reuse). */
  fileName?: string;
  filePath?: string;
  /** Optional cloud identifiers. */
  libraryId?: string;
  versionId?: string;
  /**
   * App-specific context the shell passes through to adapters (e.g.
   * `rootHandle`, `paneId`, `annotations` for the PDF adapter). Kept opaque
   * so the generic model never grows app concerns.
   */
  extras?: Record<string, unknown>;
}

export interface ItemWorkspaceAdapter {
  kind: ItemKind;
  label: string;
  supportsAnnotations?: boolean;
  supportsSearch?: boolean;
  supportsVersions?: boolean;
  /** Renders the item content region. */
  renderViewer(item: ItemWorkspaceItem): ReactNode;
  /** Optional header strip rendered above the content (e.g. PDF item panel). */
  renderHeader?(item: ItemWorkspaceItem): ReactNode;
  /** Optional right-hand tool panel (annotations / search / versions). */
  renderTools?(item: ItemWorkspaceItem): ReactNode;
}

export class ItemWorkspaceRegistry {
  private readonly adapters = new Map<string, ItemWorkspaceAdapter>();
  private fallback: ItemWorkspaceAdapter | undefined;

  register(adapter: ItemWorkspaceAdapter): this {
    this.adapters.set(adapter.kind, adapter);
    return this;
  }

  setFallback(adapter: ItemWorkspaceAdapter | undefined): this {
    this.fallback = adapter;
    return this;
  }

  get(kind: string): ItemWorkspaceAdapter | undefined {
    return this.adapters.get(kind) ?? this.fallback;
  }

  has(kind: string): boolean {
    return this.adapters.has(kind);
  }

  list(): ItemWorkspaceAdapter[] {
    return [...this.adapters.values()];
  }
}

const defaultRegistry = new ItemWorkspaceRegistry();

/** Process-wide default registry used by the Web/Desktop shell. */
export const itemWorkspaceRegistry: ItemWorkspaceRegistry = defaultRegistry;

export function registerItemWorkspaceAdapter(adapter: ItemWorkspaceAdapter): void {
  defaultRegistry.register(adapter);
}

export function getItemWorkspaceAdapter(kind: string): ItemWorkspaceAdapter | undefined {
  return defaultRegistry.get(kind);
}
