import {
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  type DecorationSet,
} from "@codemirror/view";
import type { DebugSourceBreakpoint } from "./desktop";

export interface DebugEditorSnapshot {
  breakpoints: DebugSourceBreakpoint[];
  activeLine: number | null;
}

export interface DebugEditorExtensionOptions {
  filePath: string;
  getSnapshot: () => DebugEditorSnapshot;
  subscribe: (listener: () => void) => () => void;
  onToggle: (filePath: string, line: number) => void;
}

interface DebugEditorRenderState {
  snapshot: DebugEditorSnapshot;
  markers: RangeSet<GutterMarker>;
  decorations: DecorationSet;
}

const setDebugEditorSnapshot = StateEffect.define<DebugEditorSnapshot>();

class DebugBreakpointMarker extends GutterMarker {
  constructor(
    readonly line: number,
    readonly verified: boolean,
    readonly message?: string,
  ) {
    super();
  }

  override eq(other: DebugBreakpointMarker): boolean {
    return this.line === other.line
      && this.verified === other.verified
      && this.message === other.message;
  }

  override toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = this.verified
      ? "cm-debug-breakpoint cm-debug-breakpoint-verified"
      : "cm-debug-breakpoint cm-debug-breakpoint-unverified";
    marker.dataset.line = String(this.line);
    marker.setAttribute("role", "button");
    marker.setAttribute("aria-label", `Breakpoint at line ${this.line}`);
    marker.title = this.message
      ?? `${this.verified ? "Verified" : "Unverified"} breakpoint at line ${this.line}`;
    return marker;
  }
}

function buildRenderState(
  viewState: Parameters<StateField<DebugEditorRenderState>["init"]>[0] extends never
    ? never
    : import("@codemirror/state").EditorState,
  snapshot: DebugEditorSnapshot,
): DebugEditorRenderState {
  const markerBuilder = new RangeSetBuilder<GutterMarker>();
  const breakpoints = [...snapshot.breakpoints].sort((left, right) => left.line - right.line);
  for (const breakpoint of breakpoints) {
    if (breakpoint.line <= 0 || breakpoint.line > viewState.doc.lines) continue;
    const line = viewState.doc.line(breakpoint.line);
    markerBuilder.add(
      line.from,
      line.from,
      new DebugBreakpointMarker(
        breakpoint.line,
        breakpoint.verified === true,
        breakpoint.message,
      ),
    );
  }

  const activeLine = snapshot.activeLine;
  const decorations = activeLine && activeLine > 0 && activeLine <= viewState.doc.lines
    ? Decoration.set([
        Decoration.line({
          class: "cm-debug-active-line",
          attributes: { "data-debug-active-line": String(activeLine) },
        }).range(viewState.doc.line(activeLine).from),
      ])
    : Decoration.none;

  return {
    snapshot,
    markers: markerBuilder.finish(),
    decorations,
  };
}

export function createDebugEditorExtension(options: DebugEditorExtensionOptions): Extension {
  const renderState = StateField.define<DebugEditorRenderState>({
    create: (state) => buildRenderState(state, options.getSnapshot()),
    update: (current, transaction) => {
      const effect = transaction.effects.find((candidate) => candidate.is(setDebugEditorSnapshot));
      if (effect) return buildRenderState(transaction.state, effect.value);
      if (transaction.docChanged) return buildRenderState(transaction.state, current.snapshot);
      return current;
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });

  const breakpointGutter = gutter({
    class: "cm-debug-gutter",
    markers: (view) => view.state.field(renderState).markers,
    domEventHandlers: {
      mousedown: (view, line, event) => {
        const mouseEvent = event as MouseEvent;
        if (mouseEvent.button !== 0) return false;
        mouseEvent.preventDefault();
        const target = mouseEvent.target instanceof HTMLElement ? mouseEvent.target : null;
        const marker = target?.closest<HTMLElement>(".cm-debug-breakpoint[data-line]");
        const markerLine = Number(marker?.dataset.line);
        const lineNumber = Number.isInteger(markerLine) && markerLine > 0
          ? markerLine
          : view.state.doc.lineAt(line.from).number;
        options.onToggle(options.filePath, lineNumber);
        return true;
      },
    },
  });

  const subscription = ViewPlugin.fromClass(class {
    private readonly unsubscribe: () => void;

    constructor(private readonly view: EditorView) {
      this.unsubscribe = options.subscribe(() => {
        this.view.dispatch({
          effects: setDebugEditorSnapshot.of(options.getSnapshot()),
        });
      });
    }

    destroy(): void {
      this.unsubscribe();
    }
  });

  const theme = EditorView.baseTheme({
    ".cm-debug-gutter": {
      width: "16px",
      cursor: "pointer",
    },
    ".cm-debug-gutter .cm-gutterElement": {
      width: "16px",
      minWidth: "16px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    ".cm-debug-breakpoint": {
      width: "9px",
      height: "9px",
      display: "block",
      borderRadius: "50%",
      boxSizing: "border-box",
    },
    ".cm-debug-breakpoint-verified": {
      backgroundColor: "#d13438",
    },
    ".cm-debug-breakpoint-unverified": {
      border: "1px solid #d13438",
      backgroundColor: "transparent",
    },
    ".cm-debug-active-line": {
      backgroundColor: "rgba(255, 204, 0, 0.14)",
      boxShadow: "inset 2px 0 0 #d6a700",
    },
  });

  return [renderState, breakpointGutter, subscription, theme];
}
