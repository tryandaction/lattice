import { describe, expect, it } from "vitest";
import { resolveFileOpenTarget } from "@/lib/file-open-routing";

describe("resolveFileOpenTarget", () => {
  it.each([
    "main.ts",
    "script.py",
    "analysis.ipynb",
    "paper.tex",
    "package.json",
    "Dockerfile",
  ])("keeps supported code and runnable text files in Lattice: %s", (fileName) => {
    expect(resolveFileOpenTarget({
      fileName,
      desktopAvailable: true,
      workspacePath: "C:/workspace",
      absolutePath: `C:/workspace/${fileName}`,
    })).toBe("lattice");
  });

  it("keeps files in Lattice when desktop path metadata is unavailable", () => {
    expect(resolveFileOpenTarget({
      fileName: "main.ts",
      desktopAvailable: false,
      workspacePath: null,
      absolutePath: null,
    })).toBe("lattice");
  });
});
