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

  it("surfaces agent recovery summary in the run section", () => {
    const model = buildAiResultViewModel(createAssistantMessage({
      content: "Agent answer\n---\nmetadata",
      agentResult: {
        sessionId: "agent-session-1",
        planSource: "custom",
        recoverySummary: "Recovery: budget_exhausted - Continue with the current plan.",
      },
    }));

    const runSection = model.sections.find((section) => section.title === "Run");
    expect(runSection?.content).toContain("Agent session: agent-session-1");
    expect(runSection?.content).toContain("Recovery: budget_exhausted - Continue with the current plan.");
  });

  it("marks inferred workflow labels in the run section", () => {
    const model = buildAiResultViewModel(createAssistantMessage({
      content: "Agent answer\n---\nmetadata",
      agentResult: {
        sessionId: "agent-session-1",
        workflowLabel: "Teaching Explain",
        workflowInferred: true,
        planSource: "custom",
      },
    }));

    const runSection = model.sections.find((section) => section.title === "Run");
    expect(runSection?.content).toContain("Workflow: Teaching Explain (auto)");
  });

  it("surfaces draft-ready Workbench handoff status for agent results", () => {
    const model = buildAiResultViewModel(createAssistantMessage({
      content: "Agent answer\n---\nmetadata",
      agentResult: {
        sessionId: "agent-session-1",
        workflowLabel: "Reading Note",
        planSource: "custom",
      },
      draftSuggestion: {
        type: "paper_note",
        templateId: "reading-note",
        title: "Reading Note: Alpha",
      },
      followUpActions: [
        { id: "create-workflow-draft", label: "保存为草稿", kind: "create_draft" },
      ],
    }));

    const workbench = model.sections.find((section) => section.title === "Workbench");
    expect(workbench?.content).toContain("Mode: draft-ready");
    expect(workbench?.content).toContain("Draft suggestion: Reading Note: Alpha / type=paper_note / template=reading-note");
    expect(workbench?.content).toContain("- 保存为草稿");
    expect(workbench?.content).toContain("no draft, proposal, memory, or workspace write is created");
  });

  it("surfaces proposal-ready Workbench handoff status for organization workflows", () => {
    const model = buildAiResultViewModel(createAssistantMessage({
      content: "Agent answer\n---\nmetadata",
      agentResult: {
        sessionId: "agent-session-1",
        workflowLabel: "Knowledge Organization",
        planSource: "custom",
      },
      draftSuggestion: undefined,
      followUpActions: [
        { id: "create-organization-proposal", label: "生成整理计划", kind: "propose_task" },
      ],
    }));

    const workbench = model.sections.find((section) => section.title === "Workbench");
    expect(workbench?.content).toContain("Mode: proposal-ready");
    expect(workbench?.content).toContain("- 生成整理计划");
    expect(workbench?.content).toContain("organization or writeback should be reviewed");
  });

  it("surfaces answer-only Workbench status without extra actions", () => {
    const model = buildAiResultViewModel(createAssistantMessage({
      content: "Agent answer\n---\nmetadata",
      agentResult: {
        sessionId: "agent-session-1",
        workflowLabel: "Teaching Explain",
        planSource: "custom",
      },
      followUpActions: [],
    }));

    const workbench = model.sections.find((section) => section.title === "Workbench");
    expect(workbench?.content).toContain("Mode: answer-only");
    expect(workbench?.content).toContain("Available actions: none");
    expect(workbench?.content).toContain("No Workbench artifact is suggested");
  });

  it("surfaces omitted context summary in the run section", () => {
    const model = buildAiResultViewModel(createAssistantMessage({
      content: "Agent answer\n---\nmetadata",
      agentResult: {
        sessionId: "agent-session-1",
        planSource: "custom",
        contextSummary: {
          omittedCount: 3,
          omittedTokens: 1800,
          preview: "workspace_chunk: 3 omitted (notes/alpha.md)",
          modelSummaryStatus: "generated",
          modelSummaryQuality: "healthy - Covers omitted methods cues.",
          recoveryPlan: "1. read_indexed_context source=workspace_chunk label=notes/alpha.md",
        },
      },
    }));

    const runSection = model.sections.find((section) => section.title === "Run");
    expect(runSection?.content).toContain("Context omitted: 3 items / 1800 tokens.");
    expect(runSection?.content).toContain("Omitted summary: generated / healthy - Covers omitted methods cues.");
    expect(runSection?.content).toContain("Omitted preview: workspace_chunk: 3 omitted");
    expect(runSection?.content).toContain("Recovery plan: 1. read_indexed_context");
  });

  it("surfaces pending memory suggestions in the run section", () => {
    const model = buildAiResultViewModel(createAssistantMessage({
      content: "Agent answer\n---\nmetadata",
      agentResult: {
        sessionId: "agent-session-1",
        planSource: "custom",
        memorySummary: {
          pendingSuggestionCount: 2,
          pendingSuggestionTitles: ["Alpha finding", "Beta method"],
        },
      },
    }));

    const runSection = model.sections.find((section) => section.title === "Run");
    expect(runSection?.content).toContain("Memory suggestions: 2 pending (Alpha finding, Beta method).");
  });

  it("surfaces structured tool observation schema in the observations section", () => {
    const model = buildAiResultViewModel(createAssistantMessage({
      content: "Agent answer",
      agentResult: {
        sessionId: "agent-session-1",
        toolObservations: [
          {
            stepId: "workspace-search",
            toolName: "workspace.search",
            status: "completed",
            preview: "2 matches.",
            evidenceCount: 0,
            resultStatus: "completed",
            resultSummary: "2 indexed file matches.",
            resultMetricsPreview: "items=2",
            resultArtifactsPreview: "notes/alpha.md, notes/beta.md",
          },
        ],
      },
    }));

    const observations = model.sections.find((section) => section.title === "Observations");
    expect(observations?.content).toContain("Summary: 1 observations");
    expect(observations?.content).toContain("status=completed");
    expect(observations?.content).toContain("summary=2 indexed file matches.");
    expect(observations?.content).toContain("metrics=items=2");
    expect(observations?.content).toContain("artifacts=notes/alpha.md, notes/beta.md");
  });

  it("summarizes and truncates long agent observation lists", () => {
    const model = buildAiResultViewModel(createAssistantMessage({
      content: "Agent answer",
      agentResult: {
        sessionId: "agent-session-1",
        toolObservations: Array.from({ length: 6 }, (_, index) => ({
          stepId: `workspace-search-${index + 1}`,
          toolName: index === 5 ? "readIndexedContext" : "workspace.search",
          status: index === 5 ? "failed" : "completed",
          preview: `Observation ${index + 1}`,
          evidenceCount: index === 0 ? 2 : 0,
          resultStatus: index === 5 ? "failed" : "completed",
          resultSummary: `Result ${index + 1}`,
          resultMetricsPreview: `items=${index + 1}`,
        })),
      },
    }));

    const observations = model.sections.find((section) => section.title === "Observations");
    expect(observations?.content).toContain("Summary: 6 observations");
    expect(observations?.content).toContain("statuses: completed=5, failed=1");
    expect(observations?.content).toContain("tools: workspace.search=5, readIndexedContext=1");
    expect(observations?.content).toContain("workspace-search-1, 2 evidence");
    expect(observations?.content).toContain("workspace-search-4");
    expect(observations?.content).not.toContain("workspace-search-5");
    expect(observations?.content).not.toContain("workspace-search-6");
    expect(observations?.content).toContain("... 2 more observations hidden in Trace.");
  });
});
