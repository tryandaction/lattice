import { describe, expect, it } from "vitest";
import { dirname, resolveWorkspaceFilePath } from "@/lib/runner/path-utils";

describe("runner path utils", () => {
  it("resolves workspace file paths without duplicating the root folder name", () => {
    const absolutePath = resolveWorkspaceFilePath(
      "C:/work/lattice-project",
      "lattice-project/src/main.py",
      "lattice-project",
    );

    expect(absolutePath).toBe("C:/work/lattice-project/src/main.py");
  });

  it("keeps relative paths intact when no root name is provided", () => {
    const absolutePath = resolveWorkspaceFilePath(
      "C:/work/lattice-project",
      "src/main.py",
    );

    expect(absolutePath).toBe("C:/work/lattice-project/src/main.py");
  });

  it("returns null when the workspace root path is unknown", () => {
    expect(resolveWorkspaceFilePath(null, "src/main.py")).toBeNull();
  });

  it("computes file parent directories", () => {
    expect(dirname("C:/work/lattice-project/src/main.py")).toBe("C:/work/lattice-project/src");
  });
});
