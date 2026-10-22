import { describe, expect, it } from "vitest";
import { discoverHarness, normalizeHarnessModels } from "../discovery";
import type { HarnessProbe } from "../types";

const probe: HarnessProbe = {
  engine: "codex", executable: "C:/Apps/codex.exe", version: "1.0", installed: true, supported: true,
  reason: null, protocol: "codex-app-server-jsonl", displayName: "Codex", authStatus: "ready",
  models: [{ id: "gpt-5", name: "GPT-5" }], capabilities: { resume: true, interrupt: true, approvals: true, workspaceRead: true, scratchWrite: true },
};

describe("harness discovery", () => {
  it("prefers a saved executable over known locations and PATH", () => {
    expect(discoverHarness({ engine: "codex", savedExecutable: "saved.exe", knownLocations: ["known.exe"], pathExecutables: ["path.exe"] })).toMatchObject({ executable: "saved.exe", source: "saved" });
  });
  it("falls back to known locations then PATH without requiring manual PATH editing", () => {
    expect(discoverHarness({ engine: "claude", knownLocations: ["known.exe"], pathExecutables: ["path.exe"] })).toMatchObject({ executable: "known.exe", source: "known-location" });
    expect(discoverHarness({ engine: "claude", pathExecutables: ["path.exe"] })).toMatchObject({ executable: "path.exe", source: "path" });
  });
  it("normalizes real probe models and preserves empty fallback", () => {
    expect(normalizeHarnessModels(probe)).toEqual([{ id: "gpt-5", name: "GPT-5", source: "harness" }]);
    expect(normalizeHarnessModels(null)).toEqual([]);
  });
  it("deduplicates real models while preserving the default metadata", () => {
    expect(normalizeHarnessModels({ models: [{ id: "actual", name: "Actual", isDefault: true }, { id: "actual", name: "Duplicate" }, { id: " ", name: "Empty" }] })).toEqual([{ id: "actual", name: "Actual", isDefault: true, source: "harness" }]);
  });
});
