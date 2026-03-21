import { describe, expect, it } from "vitest";
import { buildAiResultViewModel } from "@/lib/ai/result-view-model";
import type { ChatMessage } from "@/stores/ai-chat-store";

function createAssistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "Conclusion\n\nStable result",
    timestamp: Date.now(),
    evidenceRefs: [
      {
        kind: "heading",
        label: "notes/paper.md#Method",
        locator: "notes/paper.md#Method",
        preview: "Method summary",
      },
    ],
    promptContext: {
      nodes: [],
      prompt: "context",
      evidenceRefs: [],
      truncated: false,
    },
    followUpActions: [
      { id: "draft", label: "保存为草稿", kind: "create_draft" },
    ],
    ...overrides,
  };
}

describe("AiResultViewModel", () => {
  it("creates fallback sections when response is not structured", () => {
    const model = buildAiResultViewModel(createAssistantMessage({
      content: "A plain assistant answer",
    }));

    expect(model.sections[0]?.kind).toBe("conclusion");
    expect(model.sections.some((section) => section.kind === "evidence")).toBe(true);
    expect(model.sections.some((section) => section.kind === "next_actions")).toBe(true);
  });

  it("preserves structured sections when present", () => {
    const model = buildAiResultViewModel(createAssistantMessage({
      content: [
        "## Conclusion",
        "",
        "Result is stable.",
        "",
        "## Evidence",
        "",
        "- note one",
        "",
        "## Next Actions",
        "",
        "- save the draft",
      ].join("\n"),
    }));

    expect(model.hasStructuredSections).toBe(true);
    expect(model.sections.map((section) => section.kind)).toEqual([
      "conclusion",
      "evidence",
      "next_actions",
    ]);
  });
});
