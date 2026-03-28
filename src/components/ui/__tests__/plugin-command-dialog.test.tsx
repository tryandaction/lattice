/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginCommandDialog } from "../plugin-command-dialog";

const hoisted = vi.hoisted(() => ({
  toggleOpen: vi.fn(),
  getRegisteredCommands: vi.fn(() => []),
  subscribePluginRegistry: vi.fn(() => () => {}),
  push: vi.fn(),
}));

const settingsState = {
  settings: {
    language: "en-US",
    pluginsEnabled: false,
  },
};

const aiChatState = {
  isOpen: false,
  toggleOpen: () => {
    hoisted.toggleOpen();
    aiChatState.isOpen = !aiChatState.isOpen;
  },
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: hoisted.push,
  }),
}));

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
});
