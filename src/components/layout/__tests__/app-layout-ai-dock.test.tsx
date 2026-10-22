/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSetting = vi.fn().mockResolvedValue(undefined);
const loadSettings = vi.fn().mockResolvedValue(undefined);
const desktopClose = vi.hoisted(() => ({ isDesktop: false, closed: false }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main", destroy: async () => { desktopClose.closed = true; }, onCloseRequested: async () => () => {} }),
}));

vi.mock("next/dynamic", () => ({
  default: () => function DynamicComponentMock() {
    return <div data-testid="dynamic-layout-component" />;
  },
}));

vi.mock("@/components/dnd/dnd-provider", () => ({
  DndProvider: ({ children }: { children: ReactNode }) => children,
}));

const responsiveState = {
  isMobile: false,
  isTablet: false,
  isLandscape: true,
};

vi.mock("@/contexts/responsive-context", () => ({
  ResponsiveProvider: ({ children }: { children: ReactNode }) => children,
  useResponsive: () => responsiveState,
}));

const workspaceState = {
  sidebarCollapsed: true,
  toggleSidebar: vi.fn(),
  setSidebarCollapsed: vi.fn(),
  workspaceRootPath: null,
};

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: typeof workspaceState) => unknown) => selector(workspaceState),
}));

vi.mock("@/stores/vscode-compat-store", () => {
  const state = {
    extensions: [],
    importedAt: null,
    replaceState: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
  };
  const useVSCodeCompatStore = (selector: (value: typeof state) => unknown) => selector(state);
  useVSCodeCompatStore.getState = () => state;
  return { useVSCodeCompatStore };
});

vi.mock("@/stores/plugin-store", () => ({
  usePluginStore: (selector: (state: { loadPlugins: () => Promise<void> }) => unknown) => selector({
    loadPlugins: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/stores/annotation-store", () => ({
  useAnnotationStore: { getState: () => ({ flushPendingSaves: vi.fn() }) },
}));

vi.mock("@/stores/code-intelligence-store", () => ({
  useCodeIntelligenceStore: { getState: () => ({ refresh: vi.fn().mockResolvedValue(undefined) }) },
}));

vi.mock("@/hooks/use-unsaved-warning", () => ({ useUnsavedWarning: vi.fn() }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ toggleTheme: vi.fn() }) }));
vi.mock("@/hooks/use-auto-open-folder", () => ({ useAutoOpenFolder: vi.fn() }));
vi.mock("@/hooks/use-workbench-session", () => ({ useWorkbenchSession: vi.fn() }));
vi.mock("@/hooks/use-plugin-shortcuts", () => ({ usePluginShortcuts: vi.fn() }));
vi.mock("@/hooks/use-file-system", () => ({
  useFileSystem: () => ({ openDirectory: vi.fn(), openWorkspacePath: vi.fn() }),
}));
vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key === "chat.workspace.resize" ? "Resize AI workspace" : key,
  }),
}));

vi.mock("@/lib/storage-adapter", () => ({
  isTauriHost: () => desktopClose.isDesktop,
  invokeTauriCommand: async () => { desktopClose.closed = true; return true; },
  getStorageAdapter: () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/lib/i18n", () => ({ setLocale: vi.fn() }));
vi.mock("@/lib/plugins/runtime", () => ({
  syncPlugins: vi.fn().mockResolvedValue(undefined),
  updatePluginNetworkAllowlist: vi.fn(),
}));
vi.mock("@/lib/vscode-compat/auto-discovery", () => ({
  readVSCodeConfigFromDetectedProfiles: vi.fn().mockResolvedValue(null),
  shouldAutoImportVSCodeProfile: () => false,
}));
vi.mock("@/lib/vscode-compat/extensions", () => ({
  normalizeVSCodeExtensionInventory: (value: unknown) => value,
  shouldRepairVSCodeExtensionImport: () => false,
}));
vi.mock("@/lib/ai/key-storage", () => ({ initKeyStorage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/unified-input-handler", () => ({ isEditableElement: () => false }));

vi.mock("@/components/ui/plugin-command-dialog", () => ({ PluginCommandDialog: () => null }));
vi.mock("@/components/ui/plugin-panel-dialog", () => ({
  PluginPanelDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => isOpen
    ? <div role="dialog" aria-label="Plugin panels"><button onClick={onClose}>Close plugin panels</button></div>
    : null,
}));
vi.mock("@/components/settings/settings-dialog", () => ({ SettingsDialog: () => null }));
vi.mock("@/components/ui/download-app-dialog", () => ({ DownloadAppDialog: () => null }));
vi.mock("@/components/vscode-compat/vscode-host-interaction-dialog", () => ({ VSCodeHostInteractionDialog: () => null }));
vi.mock("@/components/onboarding/onboarding-wizard", () => ({ OnboardingWizard: () => null }));
vi.mock("@/components/ui/export-toast", () => ({ ExportToastContainer: () => null }));
vi.mock("@/components/ui/plugin-statusbar-slot", () => ({ PluginStatusBarSlot: () => null }));
vi.mock("@/components/ui/plugin-toolbar-slot", () => ({ PluginToolbarSlot: () => null }));
vi.mock("@/components/layout/desktop-window-frame", () => ({ DesktopWindowFrame: () => null }));
vi.mock("@/components/ui/error-boundary", () => ({
  ErrorBoundary: ({ children }: { children?: ReactNode }) => children ?? null,
}));

import { AppLayout } from "../app-layout";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { closeDesktopWindow } from "@/lib/desktop-window";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";

describe("AppLayout AI dock", () => {
  it("switches only the explorer source and retains the same workbench layout", async () => {
    render(<AppLayout />);
    const mountedComponents = screen.getAllByTestId("dynamic-layout-component");
    fireEvent.click(screen.getByRole("button", { name: "workbench.activity.library" }));
    await waitFor(() => expect(useCloudWorkbenchStore.getState().active).toBe(true));
    expect(screen.queryByTestId("cloud-library-surface")).toBeNull();
    expect(screen.getAllByTestId("dynamic-layout-component")).toEqual(mountedComponents);
    expect(updateSetting).toHaveBeenCalledWith("workbenchSurface", "cloud");
    fireEvent.click(screen.getByRole("button", { name: "explorer.title" }));
    await waitFor(() => expect(useCloudWorkbenchStore.getState().active).toBe(false));
    expect(screen.getAllByTestId("dynamic-layout-component")).toEqual(mountedComponents);
  });

  beforeEach(() => {
    useCloudWorkbenchStore.setState({ active: false, managementOpen: false });
    vi.clearAllMocks();
    desktopClose.isDesktop = false;
    desktopClose.closed = false;
    responsiveState.isMobile = false;
    responsiveState.isTablet = false;
    responsiveState.isLandscape = true;
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, aiPanelOpen: true, aiPanelWidth: 28 },
      isLoading: false,
      isInitialized: true,
      error: null,
      loadSettings,
      updateSetting,
    });
    useAiChatStore.setState({ isOpen: true });
  });

  it("keeps the window and AI draft when strict chat persistence fails during desktop close", async () => {
    desktopClose.isDesktop = true;
    const originalFlush = useAiChatStore.getState().flushConversations;
    useAiChatStore.setState({ flushConversations: async () => { throw new Error("Chat save fixture failed"); } });
    const view = render(<AppLayout />);
    try {
      await expect(closeDesktopWindow()).rejects.toThrow("Chat save fixture failed");
      expect(desktopClose.closed).toBe(false);
    } finally { view.unmount(); useAiChatStore.setState({ flushConversations: originalFlush }); }
  });

  it("opens plugin results immediately when a running command requests its panel", async () => {
    render(<AppLayout />);
    const panelsButton = screen.getByRole("button", { name: "panels.open" });
    expect(panelsButton.getAttribute("aria-pressed")).toBe("false");
    fireEvent(window, new CustomEvent("lattice:open-plugin-panel", { detail: { panelId: "formula-extractor.results" } }));

    await waitFor(() => expect(panelsButton.getAttribute("aria-pressed")).toBe("true"));
  });

  it.each(["mobile", "tablet"])("retains plugin results as a closeable dialog when resizing to %s", async (device) => {
    useAiChatStore.setState({ isOpen: false });
    const view = render(<AppLayout />);
    fireEvent(window, new CustomEvent("lattice:open-plugin-panel", { detail: { panelId: "formula-extractor.results" } }));
    await waitFor(() => expect(screen.getByRole("button", { name: "panels.open" }).getAttribute("aria-pressed")).toBe("true"));
    responsiveState.isMobile = device === "mobile";
    responsiveState.isTablet = device === "tablet";
    responsiveState.isLandscape = false;
    view.rerender(<AppLayout />);
    expect(await screen.findByRole("dialog", { name: "Plugin panels" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close plugin panels" }));
    expect(screen.queryByRole("dialog", { name: "Plugin panels" })).toBeNull();
  });

  it("does not overwrite an external open request with its still-closed local panel", async () => {
    const { rerender } = render(<AppLayout />);
    await screen.findByRole("separator", { name: "Resize AI workspace" });
    updateSetting.mockClear();
    act(() => useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, pluginPanelDockOpen: true } }));
    rerender(<AppLayout />);

    expect(updateSetting.mock.calls.some(([key, value]) => key === "pluginPanelDockOpen" && value === false)).toBe(false);
  });

  it("persists the real desktop AI dock resize through AppLayout", async () => {
    render(<AppLayout />);

    const aiHandle = await screen.findByRole("separator", { name: "Resize AI workspace" });
    Object.defineProperty(aiHandle.parentElement, "offsetWidth", {
      configurable: true,
      value: 1000,
    });

    fireEvent.pointerDown(aiHandle, { clientX: 720, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 640, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    await waitFor(() => {
      const persistedAiWidth = updateSetting.mock.calls.find(([key]) => key === "aiPanelWidth")?.[1];
      expect(persistedAiWidth).toEqual(expect.any(Number));
      expect(persistedAiWidth).not.toBe(28);
      expect(persistedAiWidth).toBeGreaterThanOrEqual(24);
      expect(persistedAiWidth).toBeLessThanOrEqual(42);
    }, { timeout: 1000 });
  });

  it("opens the AI workspace as a full-width overlay on mobile", async () => {
    responsiveState.isMobile = true;
    responsiveState.isTablet = false;
    responsiveState.isLandscape = false;
    useAiChatStore.setState({ isOpen: false });

    render(<AppLayout />);

    const openAiButton = await screen.findByRole("button", { name: "chat.title" });
    fireEvent.click(openAiButton);

    const overlay = await screen.findByTestId("mobile-ai-workspace-overlay");
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-label")).toBe("chat.title");
    expect(overlay.className).toContain("fixed");
    expect(overlay.className).toContain("inset-0");
    expect(overlay.className).toContain("w-full");
    expect(useAiChatStore.getState().isOpen).toBe(true);
  });

  it("keeps an already open AI workspace available when resizing to mobile and tablet", async () => {
    const view = render(<AppLayout />);
    await screen.findByRole("separator", { name: "Resize AI workspace" });
    responsiveState.isMobile = true;
    responsiveState.isLandscape = false;
    view.rerender(<AppLayout />);
    expect(await screen.findByTestId("mobile-ai-workspace-overlay")).not.toBeNull();
    expect(useAiChatStore.getState().isOpen).toBe(true);
    responsiveState.isMobile = false;
    responsiveState.isTablet = true;
    view.rerender(<AppLayout />);
    expect(await screen.findByTestId("mobile-ai-workspace-overlay")).not.toBeNull();
    expect(useAiChatStore.getState().isOpen).toBe(true);
  });

  it("provides a tablet AI entry point and opens the existing overlay", async () => {
    responsiveState.isTablet = true;
    responsiveState.isLandscape = false;
    useAiChatStore.setState({ isOpen: false });
    render(<AppLayout />);
    fireEvent.click(await screen.findByRole("button", { name: "chat.title" }));
    expect(await screen.findByTestId("mobile-ai-workspace-overlay")).not.toBeNull();
  });
});
