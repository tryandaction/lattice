/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginsPanel } from "../plugins-panel";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { useSettingsStore } from "@/stores/settings-store";
import { setLocale } from "@/lib/i18n";

const loadPlugins = vi.fn(async () => undefined);
const removePlugin = vi.fn(async () => undefined);
const settingMock = vi.hoisted(() => ({ set: vi.fn(async () => undefined) }));
const pluginCommands = [
  { id: "formula-extractor.extract.document", title: "Extract formulas", opensPanel: true },
  { id: "formula-extractor.ocr.selection", title: "OCR selected formula region", opensPanel: true },
  { id: "formula-extractor.export-markdown", title: "Export formulas.md" },
];
const emptyPlugins: never[] = [];
const updateSettings = vi.fn(async (patch: Record<string, unknown>) => {
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, ...patch } });
});

vi.mock("@/stores/plugin-store", () => ({
  usePluginStore: (selector?: (state: unknown) => unknown) => {
    const state = { plugins: emptyPlugins, isLoading: false, error: null, loadPlugins, removePlugin };
    return selector ? selector(state) : state;
  },
}));
vi.mock("@/stores/settings-store", async () => {
  const actual = await vi.importActual<typeof import("@/stores/settings-store")>("@/stores/settings-store");
  return { ...actual, useSettingsStore: Object.assign((selector: (state: unknown) => unknown) => selector({ settings: { ...DEFAULT_SETTINGS, enabledPlugins: ["formula-extractor"] }, updateSettings }), { getState: () => ({ settings: { ...DEFAULT_SETTINGS, enabledPlugins: ["formula-extractor"] } }), setState: vi.fn() }) };
});
vi.mock("@/lib/plugins/registry", () => ({ getAvailablePlugins: () => [{ id: "formula-extractor", name: "Formula Extractor", version: "1.0.0", description: "Extract formulas", permissions: ["read-current-document", "use-ocr"], settings: [{ id: "ocrCommand", type: "string", label: "Advanced OCR backend", default: "managed" }, { id: "label", type: "string", label: "Label", default: "old" }, { id: "count", type: "number", label: "Count", default: 1 }, { id: "enabled", type: "boolean", label: "Enabled", default: false }, { id: "mode", type: "select", label: "Mode", default: "a", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] }] }] }));
vi.mock("@/lib/plugins/runtime", () => ({ getPluginHealthSnapshot: () => ({}), subscribePluginHealth: () => () => undefined, getPluginAuditLog: () => [], subscribePluginAudit: () => () => undefined, getPluginSetting: () => null, setPluginSetting: settingMock.set, subscribePluginSetting: () => () => undefined, runPluginCommand: vi.fn(), syncPlugins: vi.fn(async()=>{}),getCommandsForPlugin:()=>pluginCommands,subscribePluginRegistry:()=>()=>{} }));

describe("PluginsPanel", () => {
  beforeEach(() => { setLocale("en-US"); loadPlugins.mockClear(); removePlugin.mockClear(); settingMock.set.mockClear(); });
  afterEach(() => setLocale("zh-CN"));

  it("shows runtime-oriented status and toggles enabled state", async () => {
    render(<PluginsPanel />);
    expect(screen.getByText("Formula Extractor")).toBeTruthy();
    expect(screen.getByText("Enabled (waiting for runtime)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ enabledPlugins: [] }));
  });

  it("opens ZIP chooser and persists all manifest setting control types", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    render(<PluginsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Install ZIP/ }));
    expect(click).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.change(screen.getByDisplayValue("old"), { target: { value: "new" } });
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Enabled" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
    await waitFor(() => expect(settingMock.set).toHaveBeenCalledTimes(4));
  });

  it("reports setting write failure and restores the previous field value", async () => {
    settingMock.set.mockRejectedValueOnce(new Error("write failed"));
    render(<PluginsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.change(screen.getByDisplayValue("old"), { target: { value: "bad" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("write failed"));
    expect(screen.getByDisplayValue("old")).toBeTruthy();
  });

  it("localizes built-in formula plugin metadata in Chinese", () => {
    setLocale("zh-CN");
    render(<PluginsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "详情与设置" }));
    expect(screen.getByText("读取当前文档")).toBeTruthy();
    expect(screen.getByText("使用 OCR")).toBeTruthy();
    expect(screen.getByText("识别全文公式")).toBeTruthy();
    expect(screen.getByText("OCR 所选公式区域")).toBeTruthy();
    expect(screen.getByText("导出 Markdown")).toBeTruthy();
    expect(screen.getByText("高级 OCR 后端")).toBeTruthy();
    expect(screen.queryByText("read-current-document")).toBeNull();
    expect(screen.queryByText("OCR selected formula region")).toBeNull();
  });
});
