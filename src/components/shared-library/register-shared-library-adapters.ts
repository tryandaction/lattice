"use client";

import { registerPdfItemWorkspaceAdapter } from "./pdf-item-workspace-adapter";
import { SharedLibraryContentViewer } from "./content-viewer";
import { createElement } from "react";
import { registerItemWorkspaceAdapter } from "@/lib/shared-library/item-workspace";

let registered = false;

/**
 * Registers the default item workspace adapters once. Called by the `/library`
 * layout so the Web library shell can host PDF items reusing the existing PDF
 * item workspace panel.
 */
export function registerSharedLibraryAdapters(): void {
  if (registered) {
    return;
  }
  registered = true;
  registerPdfItemWorkspaceAdapter();
  for (const kind of ["markdown", "code", "notebook", "docx", "pptx", "image", "web_snapshot", "data"] as const) {
    registerItemWorkspaceAdapter({
      kind,
      label: kind,
      supportsSearch: true,
      supportsVersions: true,
      renderViewer: (item) => createElement(SharedLibraryContentViewer, { item }),
    });
  }
}
