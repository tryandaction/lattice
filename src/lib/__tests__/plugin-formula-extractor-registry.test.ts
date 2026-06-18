import { describe, expect, it, afterEach } from "vitest";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { FORMULA_EXTRACTOR_PLUGIN_ID } from "@/lib/plugins/defaults";
import { getRecommendedPlugins } from "@/lib/plugins/registry";
import {
  getRegisteredCommands,
  getRegisteredPanels,
  syncPlugins,
} from "@/lib/plugins/runtime";

describe("formula extractor plugin registration", () => {
  afterEach(async () => {
    await syncPlugins({ pluginsEnabled: false, enabledPluginIds: [] });
  });

  it("lists Formula Extractor as an official recommended plugin", () => {
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
        "formula-extractor.extract.selection",
        "formula-extractor.copy-all-markdown",
      ]),
    );
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
});
