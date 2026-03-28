import { describe, expect, it } from "vitest";
import { renderPromptTemplate } from "@/lib/prompt/render";
import type { PromptTemplate } from "@/lib/prompt/types";

const template: PromptTemplate = {
  id: "template-1",
  title: "Summarize",
  description: "Summarize current content",
  category: "reading",
  systemPrompt: "You are a helper for {{current_file}}.",
  userPrompt: "Content:\n{{current_file_content}}\n\nSelection:\n{{selected_text}}",
  surfaces: ["chat"],
  outputMode: "structured-chat",
  requiredContext: ["current_file_content"],
  optionalContext: ["selected_text", "current_file"],
  builtin: false,
  pinned: false,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe("renderPromptTemplate", () => {
  it("renders available context slots and reports missing optional slots", () => {
    const rendered = renderPromptTemplate(template, {
      current_file: "notes.md",
      current_file_content: "Main body",
    });

    expect(rendered.renderedSystemPrompt).toContain("notes.md");
    expect(rendered.renderedPrompt).toContain("Main body");
    expect(rendered.missingRequiredContext).toEqual([]);
    expect(rendered.missingOptionalContext).toEqual(["selected_text"]);
    expect(rendered.contextSummary).toContain("Current File: ready");
  });

  it("blocks execution when required context is missing", () => {
    const rendered = renderPromptTemplate(template, {
      current_file: "notes.md",
    });

    expect(rendered.missingRequiredContext).toEqual(["current_file_content"]);
  });
});
