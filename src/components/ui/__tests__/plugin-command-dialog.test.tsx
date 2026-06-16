/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginCommandDialog } from "../plugin-command-dialog";

const hoisted = vi.hoisted(() => ({
  toggleOpen: vi.fn(),
  setOpen: vi.fn(),
  setResearchWorkflow: vi.fn(),
  getRegisteredCommands: vi.fn(() => []),
  subscribePluginRegistry: vi.fn(() => () => {}),
}));

const settingsState = {
  settings: {
    language: "en-US",
    pluginsEnabled: false,
  },
};

const aiChatState = {
  isOpen: false,
  selectedResearchWorkflowId: "markdown-research",
  toggleOpen: () => {
    hoisted.toggleOpen();
    aiChatState.isOpen = !aiChatState.isOpen;
  },
  setOpen: (open: boolean) => {
    hoisted.setOpen(open);
    aiChatState.isOpen = open;
  },
  setResearchWorkflow: (workflowId: string) => {
    hoisted.setResearchWorkflow(workflowId);
    aiChatState.selectedResearchWorkflowId = workflowId;
  },
};

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock("@/stores/ai-chat-store", () => ({
  useAiChatStore: (selector: (state: typeof aiChatState) => unknown) => selector(aiChatState),
}));

vi.mock("@/lib/plugins/runtime", () => ({
  getRegisteredCommands: hoisted.getRegisteredCommands,
  subscribePluginRegistry: hoisted.subscribePluginRegistry,
}));

describe("PluginCommandDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiChatState.isOpen = false;
    aiChatState.selectedResearchWorkflowId = "markdown-research";
    localStorage.clear();
  });

  it("exposes an AI Chat command that toggles the right-side panel", async () => {
    render(<PluginCommandDialog isOpen onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Open AI Chat Panel")).not.toBeNull();
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText("commands.run")[0]!);
    });
    expect(hoisted.toggleOpen).toHaveBeenCalledTimes(1);
  });

  it("exposes global settings and plugin center commands", async () => {
    const onOpenSettings = vi.fn();
    const onOpenPluginPanels = vi.fn();

    render(
      <PluginCommandDialog
        isOpen
        onClose={() => {}}
        onOpenSettings={onOpenSettings}
        onOpenPluginPanels={onOpenPluginPanels}
      />,
    );

    const settingsRow = await screen.findByText("Open Settings");
    const pluginCenterRow = await screen.findByText("Open Plugin Center");

    await act(async () => {
      fireEvent.click(settingsRow.closest("[data-command-id]") as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(pluginCenterRow.closest("[data-command-id]") as HTMLElement);
    });

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenPluginPanels).toHaveBeenCalledTimes(1);
  });

  it("exposes Research Agent workflow commands that open AI Chat with the selected workflow", async () => {
    render(<PluginCommandDialog isOpen onClose={() => {}} />);

    const readingNoteRow = await screen.findByText("Research Agent: Reading Note");

    expect(screen.getByText("Research Agent: Notebook Analysis")).not.toBeNull();
    expect(screen.queryByText("Research Agent: PDF Annotation")).toBeNull();

    await act(async () => {
      fireEvent.click(readingNoteRow.closest("[data-command-id]") as HTMLElement);
    });

    expect(hoisted.setResearchWorkflow).toHaveBeenCalledWith("reading-note");
    expect(hoisted.setOpen).toHaveBeenCalledWith(true);
    expect(aiChatState.selectedResearchWorkflowId).toBe("reading-note");
    expect(aiChatState.isOpen).toBe(true);
  });

  it("opens the user guide through the in-product guide callback", async () => {
    const onOpenGuide = vi.fn();

    render(<PluginCommandDialog isOpen onClose={() => {}} onOpenGuide={onOpenGuide} />);

    const guideRow = await screen.findByText("Open User Guide");

    await act(async () => {
      fireEvent.click(guideRow.closest("[data-command-id]") as HTMLElement);
    });

    expect(onOpenGuide).toHaveBeenCalledTimes(1);
  });

  it("does not expose internal development workflow pages in the command palette", async () => {
    render(<PluginCommandDialog isOpen onClose={() => {}} />);

    expect(screen.queryByText("Open Agent Protocol Center")).toBeNull();
    expect(screen.queryByText("Open Diagnostics")).toBeNull();
    expect(screen.queryByText("Open Runner Diagnostics")).toBeNull();
  });

  it("does not duplicate recent commands in the main result list", async () => {
    localStorage.setItem("lattice-command-recent", JSON.stringify(["core.toggle-ai-chat-panel"]));

    render(<PluginCommandDialog isOpen onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByText("Open AI Chat Panel")).toHaveLength(1);
    });
  });
});
