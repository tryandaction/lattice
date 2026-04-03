/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS } from "@/types/settings";

const storage = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/lib/storage-adapter", () => ({
  getStorageAdapter: () => storage,
}));

describe("settings-store desktop shell persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      isLoading: true,
      isInitialized: false,
      error: null,
    });
  });

  it("loads onboarding and ai panel fields from persisted settings", async () => {
    storage.get.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      onboardingCompleted: true,
      activityView: "search",
      pluginPanelDockOpen: true,
      aiPanelOpen: true,
      aiPanelWidth: 34,
    });

    await useSettingsStore.getState().loadSettings();

    const nextState = useSettingsStore.getState();
    expect(nextState.isInitialized).toBe(true);
    expect(nextState.settings.onboardingCompleted).toBe(true);
    expect(nextState.settings.activityView).toBe("search");
    expect(nextState.settings.pluginPanelDockOpen).toBe(true);
    expect(nextState.settings.aiPanelOpen).toBe(true);
    expect(nextState.settings.aiPanelWidth).toBe(34);
  });

  it("keeps default array/null settings when persisted payload omits them", async () => {
    storage.get.mockResolvedValue({
      theme: "dark",
      recentWorkspacePaths: undefined,
      enabledPlugins: undefined,
      pluginPanelRecentIds: undefined,
      defaultFolder: undefined,
      aiProvider: undefined,
    });

    await useSettingsStore.getState().loadSettings();

    const nextState = useSettingsStore.getState();
    expect(nextState.settings.theme).toBe("dark");
    expect(nextState.settings.recentWorkspacePaths).toEqual([]);
    expect(nextState.settings.enabledPlugins).toEqual([]);
    expect(nextState.settings.pluginPanelRecentIds).toEqual([]);
    expect(nextState.settings.defaultFolder).toBeNull();
    expect(nextState.settings.aiProvider).toBeNull();
  });
});
