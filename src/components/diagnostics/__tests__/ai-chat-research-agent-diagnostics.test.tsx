/**
 * @vitest-environment jsdom
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AiChatResearchAgentDiagnostics,
  buildDiagnosticsSynthesisAnswer,
} from "../ai-chat-research-agent-diagnostics";

const aiChatPanelProps = vi.hoisted(() => vi.fn());

vi.mock("@/components/ai/ai-chat-panel", () => ({
  AiChatPanel: (props: { loadPersistedState?: boolean }) => {
    aiChatPanelProps(props);
    return <div data-testid="mock-ai-chat-panel" />;
  },
}));

vi.mock("@/components/ai/agent-trace-panel", () => ({
  AgentTracePanel: () => <div data-testid="mock-agent-trace-panel" />,
}));

describe("AiChatResearchAgentDiagnostics", () => {
  it("builds a teaching-oriented answer for the current task", () => {
    const answer = buildDiagnosticsSynthesisAnswer([
      "Task: Explain the diagnostics evidence",
      "Question: Explain the diagnostics evidence",
    ].join("\n"));

    expect(answer).toContain("Task: Explain the diagnostics evidence");
    expect(answer).toContain("Direct answer:");
    expect(answer).toContain("Core idea:");
    expect(answer).toContain("Steps:");
    expect(answer).toContain("Example:");
    expect(answer).toContain("Evidence: [1]");
    expect(answer).not.toContain("399");
  });

  it("reserves a usable conversation height on narrow viewports", () => {
    render(<AiChatResearchAgentDiagnostics />);

    const panelHost = screen.getByTestId("ai-chat-diagnostics-panel-host");
    expect(panelHost.className).toContain("h-[calc(100dvh-8rem)]");
    expect(panelHost.className).toContain("min-h-[32rem]");
    expect(panelHost.className).toContain("xl:h-auto");
    expect(aiChatPanelProps).toHaveBeenCalledWith(expect.objectContaining({
      loadPersistedState: false,
    }));
  });
});
