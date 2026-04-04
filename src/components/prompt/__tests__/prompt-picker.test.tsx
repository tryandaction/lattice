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

const store = {
  loadPromptState: vi.fn(async () => undefined),
  getTemplatesForSurface: vi.fn(() => [template]),
  getRecentTemplates: vi.fn(() => [template]),
  getRecentRuns: vi.fn(() => [
    {
      id: "run-1",
      templateId: "template-1",
      surface: "chat",
      renderedPrompt: "Rendered prompt",
      contextSummary: "Current File: ready",
      outputMode: "structured-chat",
      createdAt: 1,
    },
  ]),
  getTemplateById: vi.fn((templateId: string) => (templateId === "template-1" ? template : null)),
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

  it("shows recent runs using template titles and selects a template", () => {
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

    expect(screen.getAllByText("Paper Summary").length).toBeGreaterThan(0);
    expect(screen.getByText("prompt.picker.runs")).not.toBeNull();
    expect(screen.getAllByText("Paper Summary").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByText("prompt.picker.use")[0]!);
    expect(onSelectTemplate).toHaveBeenCalledWith(template);
  });
});
