import { describe, expect, it } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import {
  decorationCoordinatorField,
  decorationCoordinatorExtension,
} from "../decoration-coordinator";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [decorationCoordinatorExtension],
  });
}

function collectHeadingMarkerRanges(state: EditorState): Array<{ from: number; to: number }> {
  const decorations = state.field(decorationCoordinatorField);
  const ranges: Array<{ from: number; to: number }> = [];

  decorations.between(0, state.doc.length, (from, to, decoration) => {
    if (decoration.spec.block) {
      return;
    }

    const isHeadingMarkerHide =
      from < to &&
      state.doc.sliceString(from, to).startsWith("#") &&
      decoration.spec.widget === undefined;

    if (isHeadingMarkerHide) {
      ranges.push({ from, to });
    }
  });

  return ranges;
}

function collectWidgetRangesForSource(
  state: EditorState,
  sourceSnippet: string,
): Array<{ from: number; to: number }> {
  const decorations = state.field(decorationCoordinatorField);
  const ranges: Array<{ from: number; to: number }> = [];

  decorations.between(0, state.doc.length, (from, to, decoration) => {
    if (!decoration.spec.widget) {
      return;
    }

    if (state.doc.sliceString(from, to) === sourceSnippet) {
      ranges.push({ from, to });
    }
  });

  return ranges;
}

describe("decoration coordinator cache", () => {
  it("recomputes heading marker positions after upstream edits shift line offsets", () => {
    let state = createState("prefix\n### Stable **Heading**\nbody");
    const initialRanges = collectHeadingMarkerRanges(state);
    const initialBoldRanges = collectWidgetRangesForSource(state, "**Heading**");

    expect(initialRanges).toEqual([{ from: 7, to: 11 }]);
    expect(state.doc.sliceString(7, 11)).toBe("### ");
    expect(initialBoldRanges).toEqual([{ from: 18, to: 29 }]);
    expect(state.doc.sliceString(18, 29)).toBe("**Heading**");

    state = state.update({
      changes: { from: 0, insert: "longer " },
      annotations: Transaction.userEvent.of("input"),
    }).state;

    const updatedRanges = collectHeadingMarkerRanges(state);
    const updatedBoldRanges = collectWidgetRangesForSource(state, "**Heading**");
    expect(updatedRanges).toEqual([{ from: 14, to: 18 }]);
    expect(state.doc.sliceString(14, 18)).toBe("### ");
    expect(updatedBoldRanges).toEqual([{ from: 25, to: 36 }]);
    expect(state.doc.sliceString(25, 36)).toBe("**Heading**");
  });
});
