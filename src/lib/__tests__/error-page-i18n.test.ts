/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_STORAGE_KEY } from "@/types/settings";
import { detectErrorPageLocale, getErrorPageCopy } from "@/lib/error-page-i18n";

describe("error page i18n", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("uses the persisted application language when the regular i18n store is unavailable", () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ language: "en-US" }));

    expect(detectErrorPageLocale()).toBe("en-US");
    expect(getErrorPageCopy().title).toBe("Application Failed To Load");
    expect(getErrorPageCopy().clearStorageConfirm).toContain("clear local cache");
  });

  it("falls back to navigator language when persisted settings are unavailable", () => {
    vi.stubGlobal("navigator", { language: "zh-CN" });

    expect(detectErrorPageLocale()).toBe("zh-CN");
    expect(getErrorPageCopy().title).toBe("应用加载失败");
  });

  it("ignores malformed persisted settings", () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, "{bad json");
    vi.stubGlobal("navigator", { language: "en-US" });

    expect(detectErrorPageLocale()).toBe("en-US");
  });
});
