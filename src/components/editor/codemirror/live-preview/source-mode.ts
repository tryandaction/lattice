import { StateEffect, StateField, Transaction, EditorState, EditorSelection, type StateEffectType } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export type CodeBlockSourceModeRange = {
  from: number;
  to: number;
} | null;

export type MathSourceModeRange = {
  from: number;
  to: number;
} | null;

export const setCodeBlockSourceMode = StateEffect.define<CodeBlockSourceModeRange>();
export const setMathSourceMode = StateEffect.define<MathSourceModeRange>();

type SourceModeRange = NonNullable<CodeBlockSourceModeRange>;

function clampPosition(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dispatchSourceMode(
  view: EditorView,
  effect: StateEffectType<CodeBlockSourceModeRange>,
  range: SourceModeRange,
  anchor: number,
  head: number = anchor
): void {
  const safeAnchor = clampPosition(anchor, range.from, range.to);
  const safeHead = clampPosition(head, range.from, range.to);

  view.dispatch({
    effects: effect.of(range),
    selection: EditorSelection.single(safeAnchor, safeHead),
    scrollIntoView: true,
  });
  view.focus();
}

function findMathInnerStart(state: EditorState, range: SourceModeRange): number {
  const source = state.doc.sliceString(range.from, range.to);

  if (source.startsWith('$$')) {
    let offset = 2;
    if (source[offset] === '\n') offset += 1;
    return range.from + offset;
  }

  if (source.startsWith('\\[') || source.startsWith('\\(')) {
    return range.from + 2;
  }

  if (source.startsWith('$')) {
    return range.from + 1;
  }

  return range.from;
}

function findCodeBlockInnerStart(state: EditorState, range: SourceModeRange): number {
  const source = state.doc.sliceString(range.from, range.to);
  const newlineIndex = source.indexOf('\n');

  if (source.startsWith('```') || source.startsWith('~~~')) {
    if (newlineIndex >= 0) {
      return range.from + newlineIndex + 1;
    }
    return clampPosition(range.from + source.length, range.from, range.to);
  }

  return range.from;
}

export function enterMathSourceMode(view: EditorView, from: number, to: number): void {
  const range = { from: Math.min(from, to), to: Math.max(from, to) };
  dispatchSourceMode(view, setMathSourceMode, range, findMathInnerStart(view.state, range));
}

export function enterCodeBlockSourceMode(view: EditorView, from: number, to: number): void {
  const range = { from: Math.min(from, to), to: Math.max(from, to) };
  dispatchSourceMode(view, setCodeBlockSourceMode, range, findCodeBlockInnerStart(view.state, range));
}

function mapRangeThroughChanges(
  range: NonNullable<CodeBlockSourceModeRange>,
  tr: Transaction
): NonNullable<CodeBlockSourceModeRange> {
  const mappedFrom = tr.changes.mapPos(range.from, -1);
  const mappedTo = tr.changes.mapPos(range.to, 1);
  return {
    from: Math.min(mappedFrom, mappedTo),
    to: Math.max(mappedFrom, mappedTo),
  };
}

function selectionOverlapsRange(
  state: EditorState,
  range: NonNullable<CodeBlockSourceModeRange>
): boolean {
  const selection = state.selection.main;
  if (selection.empty) {
    return selection.head >= range.from && selection.head <= range.to;
  }
  return selection.from <= range.to && selection.to >= range.from;
}

export const codeBlockSourceModeField = StateField.define<CodeBlockSourceModeRange>({
  create: () => null,
  update(value, tr) {
    let next = value;

    if (next && tr.docChanged) {
      next = mapRangeThroughChanges(next, tr);
    }

    for (const effect of tr.effects) {
      if (effect.is(setCodeBlockSourceMode)) {
        next = effect.value;
      }
    }

    if (!next) {
      return null;
    }

    if (!selectionOverlapsRange(tr.state, next)) {
      return null;
    }

    return next;
  },
});

export const mathSourceModeField = StateField.define<MathSourceModeRange>({
  create: () => null,
  update(value, tr) {
    let next = value;

    if (next && tr.docChanged) {
      next = mapRangeThroughChanges(next, tr);
    }

    for (const effect of tr.effects) {
      if (effect.is(setMathSourceMode)) {
        next = effect.value;
      }
    }

    if (!next) {
      return null;
    }

    if (!selectionOverlapsRange(tr.state, next)) {
      return null;
    }

    return next;
  },
});

export function isCodeBlockSourceMode(
  state: EditorState,
  from: number,
  to: number
): boolean {
  const active = state.field(codeBlockSourceModeField, false);
  if (!active) {
    return false;
  }
  return active.from <= to && active.to >= from;
}

export function isMathSourceMode(
  state: EditorState,
  from: number,
  to: number
): boolean {
  const active = state.field(mathSourceModeField, false);
  if (!active) {
    return false;
  }
  return active.from <= to && active.to >= from;
}
