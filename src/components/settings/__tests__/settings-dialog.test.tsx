/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "../settings-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";
import { useVSCodeExtensionHostStore } from "@/stores/vscode-extension-host-store";
import { useCodeIntelligenceStore } from "@/stores/code-intelligence-store";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { createDefaultVSCodeWorkbenchSettings } from "@/lib/vscode-compat/mapper";
import { createDefaultAiProviderProfile } from "@/lib/ai/provider-profiles";
import { useAiProviderProfileStore } from "@/stores/ai-provider-profile-store";

vi.mock("../plugins-panel", () => ({
  PluginsPanel: () => <section aria-label="Plugin center">Plugin center content</section>,
}));

const runtimeHealth = vi.hoisted(() => ({
  current: {} as Record<string, { status: "inactive" | "active" | "error" }>,
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en-US",
    currentLocale: "en-US",
    availableLocales: ["zh-CN", "en-US"],
    changeLocale: vi.fn(async () => undefined),
    getLocaleDisplayName: (locale: string) => locale,
  }),
}));

vi.mock("@/lib/storage-adapter", () => ({
  isTauri: () => true,
  isTauriHost: () => true,
  getStorageAdapter: () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  }),
}));

vi.mock("@/lib/plugins/registry", () => ({
  getAvailablePlugins: () => [
    {
      id: "formula-extractor",
      name: "Formula Extractor",
      version: "1.0.0",
      description: "Extract formulas",
      permissions: ["read-current-document", "use-ocr"],
      commands: [],
      panels: [],
    },
  ],
}));

vi.mock("@/lib/plugins/runtime", () => ({
  getRegisteredCommands: () => [],
  subscribePluginRegistry: () => () => undefined,
  getPluginHealthSnapshot: () => runtimeHealth.current,
  subscribePluginHealth: () => () => undefined,
  getPluginAuditLog: () => [],
  subscribePluginAudit: () => () => undefined,
  clearPluginAuditLog: () => undefined,
}));

vi.mock("@/stores/plugin-store", () => ({
  usePluginStore: (selector: (state: unknown) => unknown) => selector({
    plugins: [],
    loadPlugins: vi.fn(async () => undefined),
    installFromZip: vi.fn(async () => undefined),
    installFromDirectory: vi.fn(async () => undefined),
    removePlugin: vi.fn(async () => undefined),
    error: null,
  }),
}));

describe("SettingsDialog", () => {
  beforeEach(() => {
    runtimeHealth.current = {};
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        pluginsEnabled: true,
        trustedPlugins: ["formula-extractor"],
        enabledPlugins: ["formula-extractor"],
      },
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    useVSCodeCompatStore.setState({
      settings: createDefaultVSCodeWorkbenchSettings(),
      keybindings: [],
      snippets: [],
      tasks: [],
      launches: [],
      extensions: [],
      importedAt: null,
      sourceLabel: null,
      warnings: [],
    });
    useVSCodeExtensionHostStore.setState({
      snapshot: {
        status: "idle",
        runtime: "none",
        commandCount: 0,
        activeExtensionCount: 0,
        commands: [],
        views: [],
        extensions: [],
        lastError: null,
      },
      manifestCommands: [],
      hostExtensionCount: 0,
      lastSignature: null,
    });
    useCodeIntelligenceStore.setState({
      providers: [],
    } as never);
    useAiProviderProfileStore.setState({
      profiles: [],
      activeProfileId: null,
      isLoading: false,
      isInitialized: true,
      error: null,
    });
  });

  it("allows sidebar tabs to switch content", () => {
    render(<SettingsDialog isOpen onClose={vi.fn()} />);

    expect(screen.getByText("settings.about")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "settings.files" }));

    expect(screen.getByText("settings.markdown.updateLinksOnRename")).toBeTruthy();
    expect(screen.getByText('settings.compat.title')).toBeTruthy();
    expect(screen.getByText('settings.compat.description')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'settings.compat.import' })).toBeTruthy();
    expect(screen.queryByText('VS Code Compatibility / 兼容配置')).toBeNull();
  });
  it("opens directly in AI connection settings from the composer", () => {
    useSettingsStore.setState(state => ({ settings: { ...state.settings, aiEnabled: true } }));
    render(<SettingsDialog isOpen initialTab="ai" onClose={vi.fn()} />);
    expect(screen.getByText("settings.aiProfiles.title")).toBeTruthy();
  });

  it("closes the settings dialog with Escape", () => {
    const onClose = vi.fn();
    render(<SettingsDialog isOpen onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps settings open while another modal handles Escape", () => {
    const onClose = vi.fn();
    render(<SettingsDialog isOpen onClose={onClose} />);
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    try {
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    } finally { modal.remove(); }
  });

  it("opens the dedicated plugin center without duplicating the old management surface", () => {
    render(<SettingsDialog isOpen onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Plugin center")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "settings.extensions" }));

    expect(screen.getByLabelText("Plugin center")).toBeTruthy();
    expect(screen.queryByText("settings.plugins.available")).toBeNull();
    expect(screen.queryByText("settings.plugins.commands")).toBeNull();
  });

  it("renders separate localized system prompt profiles and actions", () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, aiEnabled: true } });
    render(<SettingsDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "settings.ai" }));

    expect(screen.getByText("settings.ai.systemPrompt.globalLabel")).toBeTruthy();
    expect(screen.getByText("settings.ai.systemPrompt.chatLabel")).toBeTruthy();
    expect(screen.getByText("settings.ai.systemPrompt.agentLabel")).toBeTruthy();
    expect(screen.getByText("settings.ai.systemPrompt.restoreDefaults")).toBeTruthy();
    expect(screen.getByText("settings.ai.systemPrompt.cancel")).toBeTruthy();
    expect(screen.getByText("settings.ai.systemPrompt.save")).toBeTruthy();
    expect(screen.getByText('settings.ai.temperature: 0.7')).toBeTruthy();
    expect(screen.getByText('settings.ai.precise')).toBeTruthy();
    expect(screen.getByText('settings.ai.creative')).toBeTruthy();
  });

  it("uses connections as the only provider configuration surface when a profile exists", () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, aiEnabled: true } });
    useAiProviderProfileStore.setState({
      profiles: [createDefaultAiProviderProfile("anthropic", { id: "anthropic-profile" })],
      activeProfileId: "anthropic-profile",
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    render(<SettingsDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "settings.ai" }));

    expect(screen.getByText("settings.aiProfiles.title")).toBeTruthy();
    expect(screen.queryByText("settings.ai.providerLabel")).toBeNull();
    expect(screen.queryByText("settings.ai.modelLabel")).toBeNull();
  });

  it("keeps the AI settings surface single even before a connection is created", () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, aiEnabled: true } });
    render(<SettingsDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "settings.ai" }));

    expect(screen.getByText("settings.aiProfiles.title")).toBeTruthy();
    expect(screen.queryByText("settings.ai.providerLabel")).toBeNull();
    expect(screen.queryByText("settings.ai.modelLabel")).toBeNull();
  });

  it("uses connections as the only provider configuration surface when a profile exists", () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, aiEnabled: true } });
    useAiProviderProfileStore.setState({
      profiles: [createDefaultAiProviderProfile("anthropic", { id: "anthropic-profile" })],
      activeProfileId: "anthropic-profile",
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    render(<SettingsDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "settings.ai" }));

    expect(screen.getByText("settings.aiProfiles.title")).toBeTruthy();
    expect(screen.queryByText("settings.ai.providerLabel")).toBeNull();
    expect(screen.queryByText("settings.ai.modelLabel")).toBeNull();
    expect(screen.queryByText("settings.ai.testConnection")).toBeNull();
  });

  it("saves and cancels system prompt profile drafts without exposing provider secrets", async () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, aiEnabled: true } });
    render(<SettingsDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "settings.ai" }));

    const prompts = screen.getAllByRole("textbox").filter((element) => element.tagName === "TEXTAREA");
    expect(prompts.length).toBeGreaterThanOrEqual(3);
    fireEvent.change(prompts[0]!, { target: { value: "Global test" } });
    fireEvent.change(prompts[1]!, { target: { value: "Chat test" } });
    fireEvent.change(prompts[2]!, { target: { value: "Agent test" } });
    fireEvent.click(screen.getByText("settings.ai.systemPrompt.save"));

    await waitFor(() => {
      expect(useSettingsStore.getState().settings).toMatchObject({
        aiSystemPrompt: "Global test",
        aiChatSystemPrompt: "Chat test",
        aiAgentSystemPrompt: "Agent test",
      });
    });
    expect(screen.queryByText(/API key/i)).toBeNull();

    fireEvent.change(prompts[0]!, { target: { value: "Unsaved" } });
    fireEvent.click(screen.getByText("settings.ai.systemPrompt.cancel"));
    expect((prompts[0] as HTMLTextAreaElement).value).toBe("Global test");
  });

  it("renders about status values without truncation-only labels", () => {
    render(<SettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "settings.about" }));

    expect(screen.getByText("settings.about.plugins.networkRules")).toBeTruthy();
    expect(screen.getByText("settings.plugins.networkAllowlist.empty")).toBeTruthy();
    expect(screen.getByText("settings.about.formulaExtractor")).toBeTruthy();
    expect(screen.getAllByText("settings.about.status.ready").length).toBeGreaterThan(0);
  });

  it("does not report a configured plugin as running when activation failed", async () => {
    runtimeHealth.current = { "formula-extractor": { status: "error" } };
    render(<SettingsDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "settings.about" }));

    await waitFor(() => {
      expect(screen.getByText("settings.about.plugins.active").parentElement?.textContent)
        .toBe("settings.about.plugins.active0");
      expect(screen.getByText("settings.about.formulaExtractor").parentElement?.textContent)
        .toBe("settings.about.formulaExtractorcommon.disabled");
    });
  });

  it("reports a formula plugin as ready only after runtime activation", async () => {
    runtimeHealth.current = { "formula-extractor": { status: "active" } };
    render(<SettingsDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "settings.about" }));

    await waitFor(() => {
      expect(screen.getByText("settings.about.plugins.active").parentElement?.textContent)
        .toBe("settings.about.plugins.active1");
      expect(screen.getByText("settings.about.formulaExtractor").parentElement?.textContent)
        .toBe("settings.about.formulaExtractorsettings.about.status.ready");
    });
  });

  it("keeps VS Code compatibility first screen focused on runnable metrics", () => {
    useVSCodeCompatStore.setState({
      settings: createDefaultVSCodeWorkbenchSettings(),
      keybindings: [],
      snippets: [{ name: "print", prefix: ["print"], body: "print($1)" }],
      tasks: [{ label: "Build", type: "shell", command: "npm", args: ["run", "build"] }],
      launches: [{ name: "Launch API", type: "node", request: "launch", args: [] }],
      extensions: [
        {
          id: "publisher.demo",
          source: "installed",
          displayName: "Demo",
          path: "C:/Users/test/.vscode/extensions/publisher.demo-1.0.0",
          main: "./extension.js",
          contributes: {
            languages: [],
            snippets: [],
            commands: 2,
            commandItems: [
              { command: "publisher.demo.run", title: "Run Demo" },
              { command: "publisher.demo.debug", title: "Debug Demo" },
            ],
            debuggers: 0,
            configuration: false,
            views: [],
            viewContainers: [],
            menus: 0,
            notebooks: [],
            notebookRenderers: [],
            grammars: [],
            themes: [],
          },
        },
      ],
      importedAt: 1,
      sourceLabel: "VS Code",
      warnings: [],
    });
    useVSCodeExtensionHostStore.setState({
      snapshot: {
        status: "ready",
        runtime: "node",
        commandCount: 1,
        activeExtensionCount: 1,
        commands: [{ id: "publisher.demo.run", title: "Run Demo", extensionId: "publisher.demo", source: "host" }],
        views: [],
        lastError: null,
      },
      manifestCommands: [
        { id: "publisher.demo.run", title: "Run Demo", extensionId: "publisher.demo", source: "host" },
        { id: "publisher.demo.debug", title: "Debug Demo", extensionId: "publisher.demo", source: "host" },
      ],
      hostExtensionCount: 1,
      lastSignature: "demo",
    } as never);
    useCodeIntelligenceStore.setState({
      providers: [
        { id: "ts", label: "TypeScript", status: "ready", detail: "ok" },
      ],
    } as never);

    render(<SettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "settings.files" }));

    expect(screen.getByText('settings.compat.runnable')).toBeTruthy();
    expect(screen.getByText('settings.compat.commands')).toBeTruthy();
    expect(screen.getByText('settings.compat.commands').parentElement?.textContent).toContain("1");
    expect(screen.getByText('settings.compat.intelligence')).toBeTruthy();
    expect(screen.getByText('settings.compat.launch')).toBeTruthy();
    expect(screen.getByText('settings.compat.snippets')).toBeTruthy();
    expect(screen.getByText('settings.compat.snippets').closest("details")).toBeTruthy();
  });
});
