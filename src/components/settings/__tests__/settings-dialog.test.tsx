/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "../settings-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS } from "@/types/settings";

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
  getPluginHealthSnapshot: () => ({}),
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
  });

  it("allows sidebar tabs to switch content", () => {
    render(<SettingsDialog isOpen onClose={vi.fn()} />);

    expect(screen.getByText("settings.about")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "settings.files" }));

    expect(screen.getByText("settings.markdown.updateLinksOnRename")).toBeTruthy();
  });

  it("renders about status values without truncation-only labels", () => {
    render(<SettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "settings.about" }));

    expect(screen.getByText("settings.about.plugins.networkRules")).toBeTruthy();
    expect(screen.getByText("settings.plugins.networkAllowlist.empty")).toBeTruthy();
    expect(screen.getByText("settings.about.formulaExtractor")).toBeTruthy();
    expect(screen.getAllByText("settings.about.status.ready").length).toBeGreaterThan(0);
  });
});
