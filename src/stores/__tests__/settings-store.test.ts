/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { BUILTIN_THEMES } from "@/lib/appearance/registry";
import { MAX_CUSTOM_THEMES } from "@/lib/appearance/types";
import { APPEARANCE_CACHE_KEY } from '@/lib/appearance/bootstrap';

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
    storage.get.mockReset().mockResolvedValue(null);
    storage.set.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      isLoading: true,
      isInitialized: false,
      error: null,
    });
  });

  it('does not overwrite saved settings when a change arrives before hydration begins', async () => {
    const custom = { ...structuredClone(BUILTIN_THEMES[0]), id: 'user-saved', name: 'Saved skin' };
    storage.get.mockResolvedValue({ ...DEFAULT_SETTINGS, language: 'en-US', theme: 'light',
      appearance: { schemaVersion: 1, activeThemeId: custom.id, customThemes: [custom] }, sidePanelWidth: 417, aiPanelWidth: 31 });
    await useSettingsStore.getState().setTheme('dark');
    const state = useSettingsStore.getState();
    expect(state.settings.language).toBe('en-US');
    expect(state.settings.appearance.customThemes).toEqual([custom]);
    expect(state.settings.sidePanelWidth).toBe(417);
    expect(state.settings.theme).toBe('dark');
    expect(storage.set.mock.calls.at(-1)?.[1]).toMatchObject({ language: 'en-US', sidePanelWidth: 417, aiPanelWidth: 31 });
  });

  it('merges a skin choice with custom packages loaded while hydration is pending', async () => {
    const custom = { ...structuredClone(BUILTIN_THEMES[0]), id: 'user-saved', name: 'Saved skin' };
    let resolveRead!: (value: unknown) => void;
    storage.get.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
    const loading = useSettingsStore.getState().loadSettings();
    const selecting = useSettingsStore.getState().setAppearanceTheme('folio');
    resolveRead({ ...DEFAULT_SETTINGS, appearance: { schemaVersion: 1, activeThemeId: custom.id, customThemes: [custom] } });
    await Promise.all([loading, selecting]);
    expect(useSettingsStore.getState().settings.appearance).toMatchObject({ activeThemeId: 'folio', customThemes: [custom] });
    expect(storage.set.mock.calls.at(-1)?.[1].appearance.customThemes).toEqual([custom]);
  });

  it('does not persist defaults after loading saved settings fails', async () => {
    storage.get.mockRejectedValue(new Error('saved settings temporarily unavailable'));
    await useSettingsStore.getState().loadSettings();
    expect(await useSettingsStore.getState().updateSetting('theme', 'dark')).toBe(false);
    expect(storage.set).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().error).toContain('temporarily unavailable');
  });

  it('does not rewrite future appearance data merely by loading it', async () => {
    storage.get.mockResolvedValue({ ...DEFAULT_SETTINGS, appearance: { schemaVersion: 2, activeThemeId: 'future-skin', customThemes: [{ format: 'future' }] } });
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().settings.appearance.activeThemeId).toBe('lattice');
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('preserves unsupported saved appearance data when only the language is edited', async () => {
    const futureAppearance = { schemaVersion: 2, activeThemeId: 'future-skin', customThemes: [{ format: 'future' }] };
    storage.get.mockResolvedValue({ ...DEFAULT_SETTINGS, appearance: futureAppearance, futureLayout: { gap: 7 } });
    await useSettingsStore.getState().loadSettings();
    await useSettingsStore.getState().setLanguage('en-US');
    expect(storage.set.mock.calls.at(-1)?.[1]).toMatchObject({ language: 'en-US', appearance: futureAppearance, futureLayout: { gap: 7 } });
  });

  it('roundtrips language, custom skin, theme mode and layout through a fresh hydration', async () => {
    let saved: unknown = null;
    storage.get.mockImplementation(async () => structuredClone(saved));
    storage.set.mockImplementation(async (_key, value) => { saved = structuredClone(value); });
    await useSettingsStore.getState().loadSettings();
    const custom = { ...structuredClone(BUILTIN_THEMES[1]), id: 'user-roundtrip', name: 'Persistent skin' };
    await useSettingsStore.getState().saveCustomTheme(custom);
    await useSettingsStore.getState().updateSettings({ language: 'en-US', theme: 'dark', sidePanelWidth: 417, aiPanelWidth: 31, activityView: 'search' });
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS), isInitialized: false, isLoading: true, error: null });
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().settings).toMatchObject({ language: 'en-US', theme: 'dark', sidePanelWidth: 417, aiPanelWidth: 31, activityView: 'search',
      appearance: { activeThemeId: custom.id, customThemes: [custom] } });
  });

  it("migrates legacy settings with a default appearance package", async () => {
    storage.get.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      theme: "dark",
      appearance: undefined,
    });

    await useSettingsStore.getState().loadSettings();

    const nextState = useSettingsStore.getState();
    expect(nextState.settings.theme).toBe("dark");
    expect(nextState.settings.appearance.activeThemeId).toBe("lattice");
    expect(nextState.settings.appearance.customThemes).toEqual([]);
  });

  it("drops invalid custom packages and falls back from an unknown active id", async () => {
    storage.get.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      appearance: {
        schemaVersion: 1,
        activeThemeId: "missing",
        customThemes: [{ ...BUILTIN_THEMES[0], id: "lattice" }],
      },
    });

    await useSettingsStore.getState().loadSettings();

    const appearance = useSettingsStore.getState().settings.appearance;
    expect(appearance.activeThemeId).toBe("lattice");
    expect(appearance.customThemes).toEqual([]);
  });

  it("preserves an update made while storage hydration is pending", async () => {
    let resolveStorage!: (value: unknown) => void;
    storage.get.mockImplementation(() => new Promise((resolve) => { resolveStorage = resolve; }));

    const loading = useSettingsStore.getState().loadSettings();
    const update = useSettingsStore.getState().setTheme("dark");
    resolveStorage({ ...DEFAULT_SETTINGS, theme: "light", aiEnabled:true, aiProvider:'synthetic-provider', recentWorkspacePaths:['synthetic-workspace'] });
    await Promise.all([loading, update]);

    expect(useSettingsStore.getState().settings.theme).toBe("dark");
    expect(useSettingsStore.getState().settings.aiProvider).toBe('synthetic-provider');
    expect(useSettingsStore.getState().settings.recentWorkspacePaths).toEqual(['synthetic-workspace']);
  });

  it('reports a rejected write and lets the following write succeed', async () => {
    storage.set.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    expect(await useSettingsStore.getState().updateSetting('theme','dark')).toBe(false);
    expect(useSettingsStore.getState().error).toBe('disk full');
    expect(await useSettingsStore.getState().updateSetting('theme','light')).toBe(true);
    expect(storage.set).toHaveBeenCalledTimes(2);
    expect(useSettingsStore.getState().settings.theme).toBe('light');
  });

  it('does not save an unrelated failed optimistic change in a later queued write on first launch', async () => {
    storage.get.mockResolvedValue(null);
    await useSettingsStore.getState().loadSettings();
    storage.set.mockRejectedValueOnce(new Error('first write failed')).mockResolvedValue(undefined);
    const failedTheme = useSettingsStore.getState().updateSetting('theme', 'dark');
    const savedLanguage = useSettingsStore.getState().updateSetting('language', 'en-US');
    expect(await failedTheme).toBe(false);
    expect(await savedLanguage).toBe(true);
    expect(storage.set.mock.calls.at(-1)?.[1]).toMatchObject({ theme: 'system', language: 'en-US' });
    expect(JSON.parse(localStorage.getItem(APPEARANCE_CACHE_KEY)!).mode).toBe('system');
  });

  it('restores the durable value when consecutive changes to the same setting both fail', async () => {
    storage.get.mockResolvedValue({ ...DEFAULT_SETTINGS, theme: 'system' });
    await useSettingsStore.getState().loadSettings();
    storage.set.mockRejectedValue(new Error('write unavailable'));
    const first = useSettingsStore.getState().updateSetting('theme', 'dark');
    const second = useSettingsStore.getState().updateSetting('theme', 'light');
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(useSettingsStore.getState().settings.theme).toBe('system');
  });

  it('does not roll back a newer same-value request when an older write fails', async () => {
    storage.get.mockResolvedValue({ ...DEFAULT_SETTINGS, theme: 'system' });
    await useSettingsStore.getState().loadSettings();
    let rejectFirst!: (error: Error) => void;
    let releaseLater!: () => void;
    storage.set.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockImplementationOnce(() => new Promise<void>(resolve => { releaseLater = resolve; }))
      .mockResolvedValue(undefined);
    const first = useSettingsStore.getState().updateSetting('theme', 'dark');
    const middle = useSettingsStore.getState().updateSetting('theme', 'light');
    const latest = useSettingsStore.getState().updateSetting('theme', 'dark');
    await new Promise(resolve => setTimeout(resolve, 0));
    rejectFirst(new Error('older write failed'));
    expect(await first).toBe(false);
    const whileLatestIsPending = useSettingsStore.getState().settings.theme;
    await new Promise(resolve => setTimeout(resolve, 0));
    releaseLater();
    await Promise.all([middle, latest]);
    expect(whileLatestIsPending).toBe('dark');
    expect(useSettingsStore.getState().settings.theme).toBe('dark');
    expect(useSettingsStore.getState().error).toBeNull();
  });

  it('rolls back a failed reset to the durable language and appearance', async () => {
    storage.get.mockResolvedValue({ ...DEFAULT_SETTINGS, language: 'en-US', theme: 'dark',
      appearance: { ...DEFAULT_SETTINGS.appearance, activeThemeId: 'folio' } });
    await useSettingsStore.getState().loadSettings();
    storage.set.mockRejectedValue(new Error('reset failed'));
    await useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState().settings).toMatchObject({ language: 'en-US', theme: 'dark', appearance: { activeThemeId: 'folio' } });
    expect(useSettingsStore.getState().error).toBe('reset failed');
  });

  it('merges updates during a first-launch hydration with no saved settings', async () => {
    let resolveRead!: (value:null) => void;
    storage.get.mockImplementationOnce(() => new Promise(resolve => {resolveRead=resolve;}));
    const loading = useSettingsStore.getState().loadSettings();
    const updated = useSettingsStore.getState().updateSetting('theme','dark');
    resolveRead(null); await Promise.all([loading,updated]);
    expect(useSettingsStore.getState().settings.theme).toBe('dark');
  });

  it("serializes concurrent writes so the newest snapshot is written last", async () => {
    const writes: Array<{ theme: string; appearance: string }> = [];
    let releaseFirst!: () => void;
    storage.set.mockImplementation(async (_key: string, value: typeof DEFAULT_SETTINGS) => {
      if (writes.length === 0) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
      writes.push({ theme: value.theme, appearance: value.appearance.activeThemeId });
    });

    const first = useSettingsStore.getState().setTheme("light");
    const second = useSettingsStore.getState().updateSettings({ appearance: { ...DEFAULT_SETTINGS.appearance, activeThemeId: "folio" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst();
    await Promise.all([first, second]);

    expect(writes.at(-1)).toEqual({ theme: "light", appearance: "folio" });
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
    expect(nextState.settings.aiInlineCompletionEnabled).toBe(false);
    expect(nextState.settings.aiAgentOmittedSummaryEnabled).toBe(false);
  });

  it("restores the VS Code activity sidebar selection", async () => {
    storage.get.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      activityView: "vscode",
      sidePanelCollapsed: false,
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().settings.activityView).toBe("vscode");
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
    expect(nextState.settings.enabledPlugins).toEqual(DEFAULT_SETTINGS.enabledPlugins);
    expect(nextState.settings.pluginPanelRecentIds).toEqual([]);
    expect(nextState.settings.defaultFolder).toBeNull();
    expect(nextState.settings.aiProvider).toBeNull();
    expect(nextState.settings.aiInlineCompletionEnabled).toBe(false);
    expect(nextState.settings.aiAgentOmittedSummaryEnabled).toBe(false);
  });

  it("loads explicit inline AI completion opt-in only when persisted", async () => {
    storage.get.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      aiEnabled: true,
      aiInlineCompletionEnabled: true,
    });

    await useSettingsStore.getState().loadSettings();

    const nextState = useSettingsStore.getState();
    expect(nextState.settings.aiEnabled).toBe(true);
    expect(nextState.settings.aiInlineCompletionEnabled).toBe(true);
  });

  it("loads explicit Agent omitted-context summary opt-in only when persisted", async () => {
    storage.get.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      aiEnabled: true,
      aiAgentOmittedSummaryEnabled: true,
    });

    await useSettingsStore.getState().loadSettings();

    const nextState = useSettingsStore.getState();
    expect(nextState.settings.aiEnabled).toBe(true);
    expect(nextState.settings.aiAgentOmittedSummaryEnabled).toBe(true);
  });

  it("rejects an additional custom theme after the 20-theme capacity", async () => {
    const customThemes = Array.from({ length: MAX_CUSTOM_THEMES }, (_, index) => ({
      ...structuredClone(BUILTIN_THEMES[0]),
      id: `user-capacity-${index}`,
      name: `容量测试 ${index}`,
      author: "User",
      license: "User",
    }));
    useSettingsStore.setState({
      isInitialized: true,
      settings: {
        ...DEFAULT_SETTINGS,
        appearance: { ...DEFAULT_SETTINGS.appearance, activeThemeId: customThemes[0].id, customThemes },
      },
    });

    await expect(useSettingsStore.getState().saveCustomTheme({
      ...structuredClone(BUILTIN_THEMES[0]),
      id: "user-capacity-overflow",
      name: "超出容量",
      author: "User",
      license: "User",
    })).rejects.toThrow("最多保存 20 套自定义皮肤");
    expect(useSettingsStore.getState().settings.appearance.customThemes).toHaveLength(MAX_CUSTOM_THEMES);
    expect(storage.set).not.toHaveBeenCalled();
  });
});
