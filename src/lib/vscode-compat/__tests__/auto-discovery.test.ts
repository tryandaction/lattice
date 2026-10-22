import { describe, expect, it } from "vitest";
import { shouldAutoImportVSCodeProfile } from "@/lib/vscode-compat/auto-discovery";

describe("VS Code profile auto-discovery", () => {
  it("imports once when compatibility is enabled but no profile has been loaded", () => {
    expect(shouldAutoImportVSCodeProfile(true, null)).toBe(true);
    expect(shouldAutoImportVSCodeProfile(true, Date.now())).toBe(false);
    expect(shouldAutoImportVSCodeProfile(false, null)).toBe(false);
  });

  it("waits for persisted compatibility state before scheduling discovery", () => {
    expect(shouldAutoImportVSCodeProfile(true, null, false)).toBe(false);
    expect(shouldAutoImportVSCodeProfile(true, null, true)).toBe(true);
  });
});
