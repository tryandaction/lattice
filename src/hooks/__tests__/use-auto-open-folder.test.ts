import { describe, expect, it } from "vitest";
import { resolveAutoOpenWorkspacePath } from "../use-auto-open-folder";

describe("resolveAutoOpenWorkspacePath", () => {
  it("prefers last opened folder over default folder", () => {
    expect(resolveAutoOpenWorkspacePath({
      lastOpenedFolder: "C:/workspace/recent",
      defaultFolder: "C:/workspace/default",
    })).toBe("C:/workspace/recent");
  });

  it("falls back to default folder when no recent workspace exists", () => {
    expect(resolveAutoOpenWorkspacePath({
      lastOpenedFolder: null,
      defaultFolder: "C:/workspace/default",
    })).toBe("C:/workspace/default");
  });
});
