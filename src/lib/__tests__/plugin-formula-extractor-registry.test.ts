import { describe, expect, it, afterEach } from "vitest";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { FORMULA_EXTRACTOR_PLUGIN_ID } from "@/lib/plugins/defaults";
import { getAvailablePlugins, getRecommendedPlugins } from "@/lib/plugins/registry";
import {
  clearPluginAuditLog,
  getPluginAuditLog,
  getRegisteredCommands,
  getRegisteredPanels,
  __pluginRuntimeTest,
  runPluginCommand,
  syncPlugins,
} from "@/lib/plugins/runtime";

describe("formula extractor plugin registration", () => {
  afterEach(async () => {
    clearPluginAuditLog();
    await syncPlugins({ pluginsEnabled: false, enabledPluginIds: [] });
  });

  it("lists Formula Extractor as an official recommended plugin", () => {
    expect(getAvailablePlugins().map((plugin) => plugin.id)).toEqual([FORMULA_EXTRACTOR_PLUGIN_ID]);
    const recommended = getRecommendedPlugins();
    expect(recommended.map((plugin) => plugin.id)).toContain(FORMULA_EXTRACTOR_PLUGIN_ID);
    expect(recommended.find((plugin) => plugin.id === FORMULA_EXTRACTOR_PLUGIN_ID)?.recommended).toBe(true);
  });

  it("enables and trusts Formula Extractor by default", () => {
    expect(DEFAULT_SETTINGS.pluginsEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.enabledPlugins).toContain(FORMULA_EXTRACTOR_PLUGIN_ID);
    expect(DEFAULT_SETTINGS.trustedPlugins).toContain(FORMULA_EXTRACTOR_PLUGIN_ID);
  });

  it("registers commands and panel when enabled", async () => {
    await syncPlugins({
      pluginsEnabled: true,
      enabledPluginIds: [FORMULA_EXTRACTOR_PLUGIN_ID],
    });

    expect(getRegisteredCommands().map((command) => command.id)).toEqual(
      expect.arrayContaining([
        "formula-extractor.extract.document",
        "formula-extractor.extract.current-page",
        "formula-extractor.extract.selection",
        "formula-extractor.ocr.selection",
        "formula-extractor.copy-formula-latex",
        "formula-extractor.copy-formula-markdown",
        "formula-extractor.reveal-formula",
        "formula-extractor.export-markdown",
        "formula-extractor.export-latex",
      ]),
    );
    expect(getRegisteredCommands().map((command) => command.id)).not.toContain("formula-extractor.auto-scan");
    expect(getRegisteredCommands().map((command) => command.id)).not.toContain("formula-extractor.copy-all-markdown");
    expect(getRegisteredCommands().map((command) => command.id)).not.toContain("formula-extractor.export-json");
    expect(getRegisteredPanels().map((panel) => panel.id)).toContain("formula-extractor.results");
  });

  it("removes commands and panel when disabled", async () => {
    await syncPlugins({
      pluginsEnabled: true,
      enabledPluginIds: [FORMULA_EXTRACTOR_PLUGIN_ID],
    });
    await syncPlugins({ pluginsEnabled: false, enabledPluginIds: [] });

    expect(getRegisteredCommands().map((command) => command.id)).not.toContain("formula-extractor.extract.document");
    expect(getRegisteredPanels().map((panel) => panel.id)).not.toContain("formula-extractor.results");
  });

  it("surfaces missing plugin commands through errors and the audit log", async () => {
    await expect(runPluginCommand("missing.command")).rejects.toThrow("Command not found: missing.command");
    expect(getPluginAuditLog()[0]).toMatchObject({
      pluginId: "system",
      level: "warn",
      action: "command",
      message: "Command not found: missing.command",
    });
  });

  it("audits plugin permission denials with the missing permission and request", () => {
    expect(() => {
      __pluginRuntimeTest.assertPluginPermission(
        "demo.plugin",
        [],
        "file:write",
        "workspace.writeFile",
      );
    }).toThrow("Permission denied: file:write");

    expect(getPluginAuditLog()[0]).toMatchObject({
      pluginId: "demo.plugin",
      level: "warn",
      action: "permission-denied",
      message: "Permission denied: file:write",
      data: {
        permission: "file:write",
        request: "workspace.writeFile",
      },
    });
  });
});
