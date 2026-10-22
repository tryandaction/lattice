import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

const MAX_MINIMAP_ROWS = 180;

export interface CodeMinimapRow {
  top: number;
  width: number;
}

export function buildCodeMinimapRows(doc: { lines: number; line: (number: number) => { text: string } }): CodeMinimapRow[] {
  const rows = Math.min(doc.lines, MAX_MINIMAP_ROWS);
  if (rows === 0) {
    return [];
  }

  return Array.from({ length: rows }, (_, index) => {
    const sourceLine = Math.min(doc.lines, Math.floor((index * doc.lines) / rows) + 1);
    const textLength = doc.line(sourceLine).text.trim().length;
    return {
      top: (index / rows) * 100,
      width: Math.max(12, Math.min(100, (textLength / 96) * 100)),
    };
  });
}

function createMinimapElement(view: EditorView): HTMLButtonElement {
  const minimap = document.createElement("button");
  minimap.type = "button";
  minimap.className = "cm-lattice-minimap";
  minimap.setAttribute("aria-label", "Code minimap");
  minimap.dataset.testid = "code-minimap";

  minimap.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const bounds = minimap.getBoundingClientRect();
    if (bounds.height <= 0) {
      return;
    }
    const ratio = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    const maximumScrollTop = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
    view.scrollDOM.scrollTop = ratio * maximumScrollTop;
    view.focus();
  });

  return minimap;
}

function updateMinimap(minimap: HTMLButtonElement, view: EditorView): void {
  const rows = buildCodeMinimapRows(view.state.doc);
  minimap.replaceChildren();
  minimap.dataset.lineCount = String(view.state.doc.lines);

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const mark = document.createElement("span");
    mark.className = "cm-lattice-minimap-line";
    mark.style.top = `${row.top}%`;
    mark.style.width = `${row.width}%`;
    fragment.append(mark);
  }

  const firstVisibleLine = view.state.doc.lineAt(view.viewport.from).number;
  const lastVisibleLine = view.state.doc.lineAt(Math.max(view.viewport.from, view.viewport.to - 1)).number;
  const viewport = document.createElement("span");
  viewport.className = "cm-lattice-minimap-viewport";
  viewport.style.top = `${((firstVisibleLine - 1) / view.state.doc.lines) * 100}%`;
  viewport.style.height = `${Math.max(3, ((lastVisibleLine - firstVisibleLine + 1) / view.state.doc.lines) * 100)}%`;
  fragment.append(viewport);
  minimap.append(fragment);
}

class CodeMinimapPlugin {
  private readonly minimap: HTMLButtonElement;

  constructor(view: EditorView) {
    this.minimap = createMinimapElement(view);
    view.dom.append(this.minimap);
    updateMinimap(this.minimap, view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      updateMinimap(this.minimap, update.view);
    }
  }

  destroy(): void {
    this.minimap.remove();
  }
}

export const codeMinimapExtension: Extension = [
  ViewPlugin.fromClass(CodeMinimapPlugin),
  EditorView.baseTheme({
    ".cm-editor": {
      position: "relative",
    },
    ".cm-scroller": {
      paddingRight: "92px",
    },
    ".cm-lattice-minimap": {
      position: "absolute",
      top: "8px",
      right: "8px",
      bottom: "8px",
      zIndex: "2",
      width: "72px",
      minHeight: "48px",
      margin: "0",
      padding: "4px",
      overflow: "hidden",
      border: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
      borderRadius: "3px",
      background: "color-mix(in srgb, var(--background) 86%, transparent)",
      cursor: "pointer",
      opacity: "0.8",
    },
    ".cm-lattice-minimap:hover": {
      opacity: "1",
    },
    ".cm-lattice-minimap-line": {
      position: "absolute",
      left: "4px",
      height: "1px",
      maxWidth: "calc(100% - 8px)",
      background: "color-mix(in srgb, var(--foreground) 55%, transparent)",
    },
    ".cm-lattice-minimap-viewport": {
      position: "absolute",
      right: "3px",
      left: "3px",
      minHeight: "4px",
      border: "1px solid color-mix(in srgb, var(--primary) 78%, transparent)",
      background: "color-mix(in srgb, var(--primary) 14%, transparent)",
      pointerEvents: "none",
    },
  }),
];
