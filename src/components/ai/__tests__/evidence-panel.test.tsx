/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EvidencePanel } from "../evidence-panel";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ChatMessage } from "@/stores/ai-chat-store";

const { navigateLink, toastError } = vi.hoisted(() => ({
  navigateLink: vi.fn().mockResolvedValue(true),
  toastError: vi.fn(),
}));

vi.mock("@/lib/link-router/navigate-link", () => ({
  navigateLink,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: vi.fn(),
  },
}));

function createAssistantMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    content: "Conclusion\n\nStructured answer",
    timestamp: Date.now(),
    evidenceRefs: [],
    promptContext: {
      nodes: [],
      prompt: "",
      evidenceRefs: [],
      truncated: false,
    },
    ...overrides,
  };
}

describe("EvidencePanel", () => {
  beforeEach(() => {
    navigateLink.mockClear();
    toastError.mockClear();
    useWorkspaceStore.setState({
      rootHandle: null,
      layout: {
        ...useWorkspaceStore.getState().layout,
        activePaneId: "pane-initial",
      },
    });
  });

  it("renders the shared reference tree and supports selection actions", async () => {
    const onSelectMessage = vi.fn();
    const onCreateDraft = vi.fn();

    const messages = [
      createAssistantMessage({
        id: "message-1",
        content: "First conclusion\n\nKey finding",
        evidenceRefs: [
          {
            kind: "heading",
            label: "Method",
            locator: "notes/paper.md#Method",
            preview: "Method section",
          },
          {
            kind: "code_line",
            label: "Line 42",
            locator: "notes/paper.md#line=42",
            preview: "raise ValueError(...)",
          },
        ],
        promptContext: {
          nodes: [
            {
              id: "ctx-1",
              kind: "workspace_chunk",
              label: "Open file",
              content: "Additional context",
              priority: 1,
            },
          ],
          prompt: "",
          evidenceRefs: [],
          truncated: false,
        },
      }),
      createAssistantMessage({
        id: "message-2",
        content: "Second conclusion\n\nAnother answer",
        evidenceRefs: [
          {
            kind: "file",
            label: "summary.md",
            locator: "notes/summary.md",
          },
        ],
      }),
    ];

    render(
      <EvidencePanel
        message={messages[0]}
        messages={messages}
        selectedMessageId="message-1"
        onSelectMessage={onSelectMessage}
        onCreateDraft={onCreateDraft}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Evidence Panel")).not.toBeNull();
    expect(screen.getByText("Reference Tree")).not.toBeNull();
    expect(screen.queryByText(/^References$/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Second conclusion/i }));
    expect(onSelectMessage).toHaveBeenCalledWith("message-2");

    fireEvent.click(screen.getByText("Method"));
    await waitFor(() => {
      expect(navigateLink).toHaveBeenCalledWith(
        "notes/paper.md#Method",
        expect.objectContaining({ paneId: "pane-initial" }),
      );
    });

    const evidenceCheckboxes = screen.getAllByRole("checkbox");
    fireEvent.click(evidenceCheckboxes[0]!);
    expect(screen.getByText("已选 1 条证据")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "保存选中草稿" }));
    expect(onCreateDraft).toHaveBeenCalledTimes(1);
  });
});
