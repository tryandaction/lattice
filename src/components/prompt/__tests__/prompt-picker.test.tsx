/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptPicker } from "../prompt-picker";
import type { PromptTemplate } from "@/lib/prompt/types";

const template: PromptTemplate = {
  id: "template-1",
  title: "Paper Summary",
  description: "Summarize current paper",
  category: "reading",
  userPrompt: "Summarize this paper",
  surfaces: ["chat"],
  outputMode: "structured-chat",
  requiredContext: [],
  optionalContext: [],
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

const recentTemplate: PromptTemplate = {
  ...template,
  id: "template-recent",
  title: "Recent Matrix",
  description: "Build a comparison matrix",
};

const store = {
  loadPromptState: vi.fn(async () => undefined),
  getTemplatesForSurface: vi.fn(() => [template]),
  getRecentTemplates: vi.fn(() => [recentTemplate]),
};

vi.mock("@/stores/prompt-template-store", () => ({
  usePromptTemplateStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("PromptPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects a template directly from the compact picker", () => {
    const onSelectTemplate = vi.fn();

    render(
      <PromptPicker
        isOpen
        surface="chat"
        workspaceKey="web:workspace"
        workspaceRootPath="C:/workspace"
        currentInput=""
        onClose={() => {}}
        onSelectTemplate={onSelectTemplate}
        onCreateTemplate={() => {}}
        onEditTemplate={() => {}}
      />,
    );

    expect(screen.getByText("Recent Matrix")).not.toBeNull();
    expect(screen.getByText("Paper Summary")).not.toBeNull();
    expect(screen.queryByText("prompt.picker.runs")).toBeNull();
    expect(screen.queryByText("prompt.picker.use")).toBeNull();

    fireEvent.click(screen.getByText("Paper Summary"));
    expect(onSelectTemplate).toHaveBeenCalledWith(template);
  });

  it("selects recent templates in one click and keeps edit separate", () => {
    const onSelectTemplate = vi.fn();
    const onEditTemplate = vi.fn();

    render(
      <PromptPicker
        isOpen
        surface="chat"
        currentInput=""
        onClose={() => {}}
        onSelectTemplate={onSelectTemplate}
        onCreateTemplate={() => {}}
        onEditTemplate={onEditTemplate}
      />,
    );

    fireEvent.click(screen.getByText("Recent Matrix"));
    expect(onSelectTemplate).toHaveBeenCalledWith(recentTemplate);

    fireEvent.click(screen.getAllByTitle("common.edit")[0]!);
    expect(onEditTemplate).toHaveBeenCalledWith(recentTemplate);
    expect(onSelectTemplate).toHaveBeenCalledTimes(1);
  });
});
