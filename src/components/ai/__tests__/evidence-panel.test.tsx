/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setLocale } from "@/lib/i18n";
import { EvidencePanel } from "../evidence-panel";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAiProviderProfileStore } from "@/stores/ai-provider-profile-store";
import { createDefaultAiProviderProfile } from "@/lib/ai/provider-profiles";
import { DEFAULT_SETTINGS } from "@/types/settings";
import type { ChatMessage } from "@/stores/ai-chat-store";

const { navigateLink, navigateLinkDetailed, toastError } = vi.hoisted(() => ({
  navigateLink: vi.fn().mockResolvedValue(true),
  navigateLinkDetailed: vi.fn(),
  toastError: vi.fn(),
}));
const executePromptTemplateForSurface = vi.hoisted(() => vi.fn());

vi.mock("@/lib/link-router/navigate-link", () => ({
  navigateLink,
  navigateLinkDetailed,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: vi.fn(),
  },
}));

vi.mock("@/lib/prompt/surface-actions", () => ({
  executePromptTemplateForSurface,
}));

vi.mock("@/components/prompt/prompt-picker", () => ({
  PromptPicker: ({ isOpen, onSelectTemplate }: { isOpen: boolean; onSelectTemplate: (template: object) => void }) => isOpen
    ? <button type="button" data-testid="mock-prompt-template" onClick={() => onSelectTemplate({ id: "template-1", title: "Template", outputMode: "structured-chat" })}>Select template</button>
    : null,
}));

vi.mock("@/components/prompt/prompt-run-sheet", () => ({
  PromptRunSheet: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: (payload: object) => void }) => isOpen
    ? <button type="button" data-testid="mock-prompt-confirm" onClick={() => onConfirm({ renderedPrompt: "Summarize this evidence", contextSummary: "Evidence context" })}>Run template</button>
    : null,
}));

vi.mock("@/components/prompt/prompt-editor-dialog", () => ({
  PromptEditorDialog: () => null,
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
  afterEach(() => act(() => setLocale("zh-CN")));
  beforeEach(() => {
    setLocale("zh-CN");
    navigateLink.mockClear();
    navigateLinkDetailed.mockReset();
    navigateLinkDetailed.mockImplementation(async (...args: unknown[]) => {
      const ok = await navigateLink(...args);
      return {
        ok,
        requestId: "nav-test",
        status: ok ? "success" : "file_not_found",
      };
    });
    toastError.mockClear();
    executePromptTemplateForSurface.mockReset();
    executePromptTemplateForSurface.mockResolvedValue({ kind: "chat", title: "done" });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
        aiProvider: "openai",
        aiModel: "legacy-model",
      },
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    useAiProviderProfileStore.setState({
      profiles: [],
      activeProfileId: null,
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    useWorkspaceStore.setState({
      rootHandle: null,
      layout: {
        ...useWorkspaceStore.getState().layout,
        activePaneId: "pane-initial",
      },
    });
  });

  it("keeps the reference tree collapsed until the user opens details", async () => {
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

    expect(screen.getByTestId("evidence-source-summary")).not.toBeNull();
    expect(screen.queryByText("引用树")).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByText(/^References$/)).toBeNull();

    fireEvent.click(screen.getByTestId("evidence-review-details-toggle"));
    expect(screen.getByText("引用树")).not.toBeNull();
    expect(screen.queryByText("Method")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Second conclusion/i }));
    expect(onSelectMessage).toHaveBeenCalledWith("message-2");

    fireEvent.click(screen.getByText("paper.md"));
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

  it("labels messages by their actual answer when the response starts with a generic conclusion heading", () => {
    render(
      <EvidencePanel
        message={createAssistantMessage({ content: "## 结论\n\nBB1 是用于抑制幅度误差的复合脉冲序列。" })}
        messages={[
          createAssistantMessage({ id: "generic", content: "## 结论\n\nBB1 是用于抑制幅度误差的复合脉冲序列。" }),
          createAssistantMessage({ id: "other", content: "## 结论\n\n另一条回答。" }),
        ]}
        selectedMessageId="generic"
        onSelectMessage={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("evidence-review-details-toggle"));
    expect(screen.getByRole("button", { name: /BB1 是用于抑制幅度误差的复合脉冲序列/ })).toBeTruthy();
    expect(screen.queryByText(/^结论$/)).toBeNull();
  });

  it("reports sources and unique passages without presenting absent prompt snapshots as zero conversation context", () => {
    const ref = { kind: "pdf_page" as const, label: "paper.pdf", locator: "paper.pdf#page=2", preview: "A measured result." };
    render(<EvidencePanel message={createAssistantMessage({ evidenceRefs: [ref, { ...ref }] })} onClose={() => {}} />);
    expect(screen.getByTestId("evidence-review-counts").textContent).toBe("1 个来源 · 1 条引用");
    expect(screen.queryByText("0 条上下文")).toBeNull();
  });

  it("keeps long locators in details instead of repeating them in each reference row", () => {
    const longLocator = "atom/Theoretical Research/taiyi/essay/2023-High-fidelity gates and mid-circuit erasure conversion in an atomic qubit.pdf#page=4";

    render(
      <EvidencePanel
        message={createAssistantMessage({
          evidenceRefs: [{
            kind: "pdf_page",
            label: longLocator,
            locator: longLocator,
            preview: "Long source preview should remain available on demand.",
          }],
        })}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText(longLocator)).toBeNull();
    expect(screen.getByTitle(longLocator).textContent).toContain("2023-High-fidelity gates and mid-circuit erasure conversion in an atomic qubit.pdf");
    expect(screen.queryByRole("button", { name: "淇濆瓨鑽夌" })).toBeNull();
    expect(screen.queryByRole("button", { name: "浣跨敤妯℃澘" })).toBeNull();
  });

  it("shows a compact inline recovery state when evidence navigation fails", async () => {
    navigateLink.mockResolvedValueOnce(false);
    const locator = "atom/Theoretical Research/taiyi/essay/paper.pdf#page=3";

    render(
      <EvidencePanel
        message={createAssistantMessage({
          evidenceRefs: [{
            kind: "pdf_page",
            label: "Referenced paper",
            locator,
          }],
        })}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Referenced paper"));

    await waitFor(() => {
      expect(screen.getByTestId("evidence-navigation-error").textContent).toContain("paper.pdf");
    });
    expect(screen.getByTestId("evidence-navigation-retry")).not.toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("explains structured navigation failure and offers recovery actions", async () => {
    navigateLinkDetailed.mockResolvedValueOnce({
      ok: false,
      requestId: "nav-failure",
      status: "file_not_found",
    });
    const locator = "papers/quantum.pdf#page=3";

    render(
      <EvidencePanel
        message={createAssistantMessage({
          evidenceRefs: [{
            kind: "pdf_page",
            label: "papers/quantum.pdf",
            locator,
            preview: "The encoded qubit survives detection.",
            anchor: { page: 3, snippet: "The encoded qubit survives detection." },
          }],
        })}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("quantum.pdf"));

    await waitFor(() => {
      expect(screen.getByTestId("evidence-navigation-error").textContent).toContain("quantum.pdf");
    });
    expect(screen.getByTestId("evidence-navigation-location").textContent).toContain("第 3 页");
    expect(screen.getByTestId("evidence-navigation-quote").textContent).toContain("encoded qubit");
    expect(screen.getByTestId("evidence-navigation-status").textContent).toBe("找不到文件");
    expect(screen.getByRole("button", { name: "打开来源" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制引用" })).toBeTruthy();
    act(() => setLocale("en-US"));
    expect(screen.getByTestId("evidence-navigation-status").textContent).toBe("File not found");
    expect(screen.getByTestId("evidence-navigation-location").textContent).toBe("p.3");
    expect(screen.getByRole("button", { name: "Open source" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy reference" })).toBeTruthy();
    expect(navigateLinkDetailed).toHaveBeenCalledTimes(1);
  });

  it("uses the active connection and model for evidence template runs", async () => {
    const profile = createDefaultAiProviderProfile("custom-openai-compatible", {
      id: "evidence-gateway",
      model: "vendor-evidence-model",
    });
    useAiProviderProfileStore.setState({
      profiles: [profile],
      activeProfileId: profile.id,
      isLoading: false,
      isInitialized: true,
      error: null,
    });

    render(
      <EvidencePanel
        message={createAssistantMessage({
          evidenceRefs: [{
            kind: "file",
            label: "notes/source.md",
            locator: "notes/source.md",
            preview: "Evidence passage",
          }],
        })}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("evidence-review-details-toggle"));
    fireEvent.click(screen.getByText("使用模板"));
    fireEvent.click(screen.getByTestId("mock-prompt-template"));
    fireEvent.click(screen.getByTestId("mock-prompt-confirm"));

    await waitFor(() => {
      expect(executePromptTemplateForSurface).toHaveBeenCalledWith(expect.objectContaining({
        settings: expect.objectContaining({
          providerId: "custom",
          model: "vendor-evidence-model",
          profileId: "evidence-gateway",
        }),
      }));
    });
  });

  it("renders one compact source row for twelve PDF passages", () => {
    const refs = Array.from({ length: 12 }, (_, index) => ({
      kind: "pdf_page" as const,
      label: "papers/quantum.pdf",
      locator: `papers/quantum.pdf#page=${index + 1}`,
      preview: `Passage ${index + 1}`,
      anchor: { page: index + 1, snippet: `Passage ${index + 1}` },
    }));

    render(
      <EvidencePanel
        message={createAssistantMessage({ evidenceRefs: refs })}
        onClose={() => {}}
      />,
    );

    const summary = screen.getByTestId("evidence-source-summary");
    expect(summary.querySelectorAll("button")).toHaveLength(1);
    expect(summary.textContent).toContain("quantum.pdf");
    expect(summary.textContent).toContain("12 条引用");
  });
});
