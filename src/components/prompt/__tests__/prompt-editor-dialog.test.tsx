/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptEditorDialog } from "../prompt-editor-dialog";

const store = {
  upsertTemplate: vi.fn(),
};

vi.mock("@/stores/prompt-template-store", () => ({
  usePromptTemplateStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("PromptEditorDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps advanced template fields collapsed by default and saves basic edits", () => {
    render(
      <PromptEditorDialog
        isOpen
        surface="chat"
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("prompt.editor.field.title")).not.toBeNull();
    expect(screen.getByText("prompt.editor.field.userPrompt")).not.toBeNull();
    expect(screen.queryByText("prompt.editor.field.outputMode")).toBeNull();
    expect(screen.queryByText("prompt.editor.field.requiredContext")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("prompt.editor.field.titlePlaceholder"), {
      target: { value: "Reading digest" },
    });
    fireEvent.change(screen.getByPlaceholderText("prompt.editor.field.descriptionPlaceholder"), {
      target: { value: "Summarize a paper" },
    });
    fireEvent.change(screen.getByPlaceholderText("prompt.editor.field.userPromptPlaceholder"), {
      target: { value: "Summarize {{current_file}}" },
    });
    fireEvent.click(screen.getByText("common.save"));

    expect(store.upsertTemplate).toHaveBeenCalledWith(expect.objectContaining({
      title: "Reading digest",
      description: "Summarize a paper",
      userPrompt: "Summarize {{current_file}}",
      surfaces: ["chat"],
      outputMode: "chat",
    }));
  });

  it("reveals advanced template fields on demand", () => {
    render(
      <PromptEditorDialog
        isOpen
        surface="chat"
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("prompt.editor.advanced"));

    expect(screen.getByText("prompt.editor.field.category")).not.toBeNull();
    expect(screen.getByText("prompt.editor.field.surfaces")).not.toBeNull();
    expect(screen.getByText("prompt.editor.field.outputMode")).not.toBeNull();
    expect(screen.getByText("prompt.editor.field.requiredContext")).not.toBeNull();
    expect(screen.getByText("prompt.editor.field.preferredModel")).not.toBeNull();
  });
});
