import { afterEach, describe, expect, it } from "vitest";
import { getActiveInputTarget, getLastActiveInputTarget, setActiveInputTarget, setActiveInputTargetFromElement, insertFormulaAtCursor } from "@/lib/unified-input-handler";

afterEach(() => { document.body.replaceChildren(); setActiveInputTarget(null); });

describe("plugin controls preserve the real insertion target", () => {
  it("never inserts into a plugin settings textarea", () => {
    const editor = document.createElement("textarea");
    editor.value = "f=";
    document.body.append(editor);
    editor.focus();
    editor.setSelectionRange(2, 2);
    setActiveInputTargetFromElement(editor);
    const panel = document.createElement("section");
    panel.dataset.quantumKeyboard = "true";
    const setting = document.createElement("textarea");
    panel.append(setting);
    document.body.append(panel);
    setting.focus();
    expect(setActiveInputTargetFromElement(setting)).toBe(null);
    expect(getActiveInputTarget()?.element).toBe(editor);
    expect(insertFormulaAtCursor({ latex: "\\alpha" }).handled).toBe(true);
    expect(editor.value).toContain("\\alpha");
    expect(setting.value).toBe("");
  });

  it("does not retain an editor that has been closed", () => {
    const editor = document.createElement("textarea");
    document.body.append(editor);
    setActiveInputTargetFromElement(editor);
    editor.remove();
    expect(getLastActiveInputTarget()).toBe(null);
  });
});
