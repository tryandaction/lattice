import { describe, expect, it } from "vitest";
import { resolveWorkspaceFileSurface } from "../file-routing";

const desktopEnabled = {
  vscodeEnabled: true,
  desktopAvailable: true,
};

describe("resolveWorkspaceFileSurface", () => {
  it.each([
    "paper.pdf",
    "notes.md",
    "paper.mdx",
    "draft.docx",
    "slides.pptx",
    "figure.png",
    "recording.mp4",
  ])("keeps Lattice-owned document and media files in Lattice: %s", (fileName) => {
    expect(resolveWorkspaceFileSurface({ fileName, ...desktopEnabled })).toBe("lattice");
  });

  it.each([
    "analysis.ipynb",
    "main.tex",
    "references.bib",
    "script.py",
    "lib.rs",
    "app.tsx",
    "settings.json",
    "pipeline.yaml",
    "Cargo.toml",
    "schema.xml",
    "build.ps1",
    "Dockerfile",
    "Makefile",
  ])("keeps code-oriented files in the integrated Lattice editor: %s", (fileName) => {
    expect(resolveWorkspaceFileSurface({ fileName, ...desktopEnabled })).toBe("lattice");
  });

  it("keeps imported language associations in the integrated editor without taking over Markdown", () => {
    expect(resolveWorkspaceFileSurface({
      fileName: "widget.spec",
      importedLanguageId: "javascript",
      ...desktopEnabled,
    })).toBe("lattice");
    expect(resolveWorkspaceFileSurface({
      fileName: "notes.md",
      importedLanguageId: "markdown",
      ...desktopEnabled,
    })).toBe("lattice");
  });

  it("falls back to Lattice text rendering when VS Code is disabled or unavailable", () => {
    expect(resolveWorkspaceFileSurface({
      fileName: "script.py",
      vscodeEnabled: false,
      desktopAvailable: true,
    })).toBe("lattice");
    expect(resolveWorkspaceFileSurface({
      fileName: "analysis.ipynb",
      vscodeEnabled: true,
      desktopAvailable: false,
    })).toBe("lattice");
  });

  it("keeps unknown binaries unsupported", () => {
    expect(resolveWorkspaceFileSurface({
      fileName: "archive.unknown-binary",
      ...desktopEnabled,
    })).toBe("unsupported");
  });
});
