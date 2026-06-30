/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuantumKeyboardEditor } from "../quantum-keyboard-editor";
import { useQuantumKeymapStore } from "@/stores/quantum-keymap-store";

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => (
      params?.key ? `${key} ${params.key}` : key
    ),
  }),
}));

describe("QuantumKeyboardEditor", () => {
  beforeEach(() => {
    localStorage.clear();
    useQuantumKeymapStore.getState().resetAll();
  });

  it("edits the selected key and layer mappings", () => {
    render(<QuantumKeyboardEditor />);

    expect(screen.getByText("quantum.keymap.title")).toBeTruthy();

    fireEvent.click(screen.getByText("quantum.keymap.ctrlLayer"));
    const latexInputs = screen.getAllByLabelText("quantum.keymap.latexField") as HTMLInputElement[];

    expect(latexInputs[0]?.value).toBe("I");

    fireEvent.change(latexInputs[0]!, { target: { value: "\\mathbf{J}" } });

    expect(
      useQuantumKeymapStore.getState().overrides.KeyI?.ctrl?.["ctrl-KeyI-1"]?.latex,
    ).toBe("\\mathbf{J}");
  });

  it("resets the selected key overrides", () => {
    useQuantumKeymapStore.getState().updateMeaning("KeyI", "base", "base-KeyI-1", {
      label: "custom integral",
      latex: "\\int_0^1",
    });

    render(<QuantumKeyboardEditor />);

    fireEvent.click(screen.getByText("quantum.keymap.resetKey I"));

    expect(useQuantumKeymapStore.getState().overrides.KeyI).toBeUndefined();
  });
});
