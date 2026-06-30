/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SelectionAiHub } from "../selection-ai-hub";
import { useSelectionAiStore } from "@/stores/selection-ai-store";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS } from "@/types/settings";

const runSelectionAiMode = vi.fn();

vi.mock("@/lib/ai/selection-actions", () => ({
  runSelectionAiMode: (...args: unknown[]) => runSelectionAiMode(...args),
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string, params?: Record<string, string | number>) => {
      const zh: Record<string, string> = {
        "ai.selection.title": "选区 AI 面板",
        "ai.selection.aria": "选区 AI 侧边面板",
        "ai.selection.defaultSummary": "围绕当前选区快速提问、深度分析，或生成结构化计划。",
        "ai.selection.selectedText": "当前选区",
        "ai.selection.localContext": "局部上下文",
        "ai.selection.evidenceCount": "{count} 条证据",
        "ai.selection.executionTarget": "执行去向：{target}",
        "ai.selection.chooseTemplate": "选择模板",
        "ai.selection.currentTemplate": "当前模板：{title}",
        "ai.selection.recentPrompts": "最近提示词",
        "ai.selection.noRecentPrompts": "当前模式还没有最近使用的提示词。",
        "ai.selection.inputLabel": "你的问题 / 指令",
        "ai.selection.templateInstructionPlaceholder": "可选：补充对当前模板的额外要求",
        "ai.selection.promptHint.templateSelected": "已选择模板，输入内容会作为补充说明。",
        "ai.selection.promptHint.default": "留空会使用当前模式默认提示。",
        "ai.selection.shortcutHint": "Alt+1/2/3 切换模式，Ctrl/Cmd+Enter 提交。",
        "ai.selection.currentMode": "当前模式：{mode}",
        "ai.selection.toast.proposalCreated": "已生成计划",
        "ai.selection.toast.agentStarted": "已启动深度分析",
        "ai.selection.toast.quickSent": "已发送到快速问答",
        "ai.selection.toast.failed": "AI 执行失败",
        "prompt.run.toast.draftCreated": "已生成草稿",
        "prompt.picker.title": "提示词模板",
        "common.cancel": "取消",
        "common.close": "关闭",
      };
      let value = zh[key] ?? key;
      Object.entries(params ?? {}).forEach(([param, paramValue]) => {
        value = value.replace(`{${param}}`, String(paramValue));
      });
      return value;
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("SelectionAiHub", () => {
  const context = {
    sourceKind: "markdown" as const,
    paneId: "pane-main" as const,
    fileName: "notes.md",
    filePath: "notes/notes.md",
    selectedText: "A highlighted research paragraph",
    contextText: "Surrounding local context",
    contextSummary: "Selection context",
    sourceLabel: "notes.md · selection",
    evidenceRefs: [
      {
        kind: "file" as const,
        label: "notes/notes.md",
        locator: "notes/notes.md",
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useSelectionAiStore.setState({
      preferredMode: "chat",
      recentPrompts: [],
    });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
      },
      isLoading: false,
      isInitialized: true,
      error: null,
    });
  });

  it("uses preferred mode when no explicit initial mode is provided", () => {
    useSelectionAiStore.setState({
      preferredMode: "agent",
      recentPrompts: [
        { mode: "agent", prompt: "Find risks", createdAt: 1 },
        { mode: "chat", prompt: "Quick summary", createdAt: 2 },
      ],
    });

    render(
      <SelectionAiHub
        context={context}
        initialMode={null}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText("结果进入 AI 聊天，并可通过证据面板检查引用来源。")).not.toBeNull();
    expect(screen.queryByText("Find risks")).not.toBeNull();
    expect(screen.queryByText("Quick summary")).toBeNull();
  });

  it("supports keyboard mode switch and submit shortcut", async () => {
    runSelectionAiMode.mockResolvedValue({
      kind: "chat",
      title: "done",
    });

    render(
      <SelectionAiHub
        context={context}
        initialMode="chat"
        onClose={() => {}}
      />,
    );

    fireEvent.keyDown(document, { altKey: true, key: "2" });
    await waitFor(() => {
      expect(screen.queryByText("结果进入 AI 聊天，并可通过证据面板检查引用来源。")).not.toBeNull();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Analyze key risks" } });

    fireEvent.keyDown(document, { ctrlKey: true, key: "Enter" });

    await waitFor(() => {
      expect(runSelectionAiMode).toHaveBeenCalledWith(expect.objectContaining({
        locale: "zh-CN",
        mode: "agent",
        prompt: "Analyze key risks",
      }));
    });

    expect(useSelectionAiStore.getState().recentPrompts[0]?.prompt).toBe("Analyze key risks");
    expect(useSelectionAiStore.getState().preferredMode).toBe("agent");
  });

  it("shows plan-mode execution target and filters recent prompts by mode", async () => {
    runSelectionAiMode.mockResolvedValue({
      kind: "proposal",
      title: "整理计划",
    });

    useSelectionAiStore.setState({
      preferredMode: "plan",
      recentPrompts: [
        { mode: "plan", prompt: "Create checklist", createdAt: 3 },
        { mode: "agent", prompt: "Find risks", createdAt: 2 },
      ],
    });

    render(
      <SelectionAiHub
        context={context}
        initialMode="plan"
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText("结果进入 AI 工作台计划，并生成可审查的目标草稿动作。")).not.toBeNull();
    expect(screen.queryByText("Create checklist")).not.toBeNull();
    expect(screen.queryByText("Find risks")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Create checklist" }));
    fireEvent.keyDown(document, { ctrlKey: true, key: "Enter" });

    await waitFor(() => {
      expect(runSelectionAiMode).toHaveBeenCalledWith(expect.objectContaining({
        locale: "zh-CN",
        mode: "plan",
        prompt: "Create checklist",
      }));
    });

    expect(useSelectionAiStore.getState().preferredMode).toBe("plan");
  });
});
