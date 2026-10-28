import { describe, expect, it } from "vitest";
import { Compartment, EditorState } from "@codemirror/state";
import { decorationCoordinatorExtension, decorationCoordinatorField } from "@/components/editor/codemirror/live-preview/decoration-coordinator";
import { quantumMathEditingExtension, setQuantumMathEditRange } from "@/components/editor/codemirror/live-preview/quantum-math-editing";

function staticMathWidgets(state: EditorState): number {
  let count = 0;
  state.field(decorationCoordinatorField).between(0, state.doc.length, (_from, _to, decoration) => {
    if (decoration.spec.widget?.constructor.name === "MathWidget") count++;
  });
  return count;
}
describe("formula editor rendering boundary", () => {
  it("removes static formula replacement while editing and restores it on exit", () => {
    const doc = "$\\frac{}{}$";
    const initial = EditorState.create({ doc, extensions: [decorationCoordinatorExtension, quantumMathEditingExtension] });
    expect(staticMathWidgets(initial)).toBe(1);
    const editing = initial.update({ effects: setQuantumMathEditRange.of({ from: 0, to: doc.length, latex: "\\frac{}{}", displayMode: false }) }).state;
    expect(staticMathWidgets(editing)).toBe(0);
    const closed = editing.update({ effects: setQuantumMathEditRange.of(null) }).state;
    expect(staticMathWidgets(closed)).toBe(1);
  });

  it("restores native formula rendering when the editing extension is removed", () => {
    const plugin = new Compartment();
    const initial = EditorState.create({ doc: "$x$", extensions: [decorationCoordinatorExtension, plugin.of(quantumMathEditingExtension)] });
    const editing = initial.update({ effects: setQuantumMathEditRange.of({ from: 0, to: 3, latex: "x", displayMode: false }) }).state;
    expect(staticMathWidgets(editing)).toBe(0);
    const disabled = editing.update({ effects: plugin.reconfigure([]) }).state;
    expect(staticMathWidgets(disabled)).toBe(1);
  });
});
