import { describe, expect, it } from "vitest";
import { enUS } from "@/lib/i18n/en-US";
import { zhCN } from "@/lib/i18n/zh-CN";

describe("translation dictionaries", () => {
  it("provides the same complete key set in both languages", () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it("keeps interpolation parameters consistent and translations non-empty", () => {
    const parameters = (text: string) => [...text.matchAll(/\{([\w]+)\}/g)].map(match => match[1]).sort();
    for (const key of Object.keys(zhCN) as Array<keyof typeof zhCN>) {
      expect(enUS[key].trim(), key).not.toBe("");
      expect(zhCN[key].trim(), key).not.toBe("");
      expect(parameters(enUS[key]), key).toEqual(parameters(zhCN[key]));
    }
  });
});
