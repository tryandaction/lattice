import { describe, expect, it } from "vitest";
import { isExcludedByPatterns, matchesVSCodeGlob } from "../glob";

describe("vscode compat glob", () => {
  it("matches common vscode-style glob patterns", () => {
    expect(matchesVSCodeGlob("src/app/page.tsx", "**/*.tsx")).toBe(true);
    expect(matchesVSCodeGlob("src/app/page.tsx", "*.tsx")).toBe(true);
    expect(matchesVSCodeGlob("src/app/page.tsx", "**/page.*")).toBe(true);
    expect(matchesVSCodeGlob("src/app/page.tsx", "**/layout.tsx")).toBe(false);
  });

  it("respects boolean exclude maps", () => {
    expect(isExcludedByPatterns("dist/index.js", { "**/dist": true })).toBe(true);
    expect(isExcludedByPatterns("src/index.js", { "**/dist": true })).toBe(false);
  });
});
