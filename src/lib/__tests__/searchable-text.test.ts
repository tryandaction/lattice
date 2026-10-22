import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractSearchableTextForFile,
  isLineNavigableSearchExtension,
  isSearchableTextExtension,
  normalizeSearchText,
  shouldExcludeFromWorkspaceSearch,
} from "../searchable-text";
import { useSettingsStore } from "@/stores/settings-store";
import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";

const extractRawTextMock = vi.fn();

vi.mock("mammoth", () => ({
  default: {
    extractRawText: (...args: unknown[]) => extractRawTextMock(...args),
  },
}));

const extractTextFromPptxMock = vi.fn();

vi.mock("@/lib/pptx-formula-extractor", () => ({
  extractTextFromPptx: (...args: unknown[]) => extractTextFromPptxMock(...args),
}));

describe("searchable text extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        vscodeCompatEnabled: false,
      },
    });
    useVSCodeCompatStore.setState({
      ...useVSCodeCompatStore.getState(),
      settings: {
        ...useVSCodeCompatStore.getState().settings,
        searchExclude: {},
      },
    });
  });

  it("extracts notebook cell text", async () => {
    const file = new File([
      JSON.stringify({
        cells: [
          { source: "# Title\n" },
          { source: ["keyword appears here\n", "line two"] },
        ],
      }),
    ], "note.ipynb");

    const text = await extractSearchableTextForFile({
      extension: "ipynb",
      file,
    });

    expect(text).toContain("keyword appears here");
  });

  it("extracts docx text via mammoth", async () => {
    extractRawTextMock.mockResolvedValue({ value: "word keyword content" });

    const file = new File([new Uint8Array([1, 2, 3])], "paper.docx");
    const text = await extractSearchableTextForFile({
      extension: "docx",
      file,
    });

    expect(text).toBe("word keyword content");
  });

  it("extracts pptx text via the shared pptx text extractor", async () => {
    extractTextFromPptxMock.mockResolvedValue([
      {
        slideIndex: 0,
        paragraphs: [
          { text: "title line", isTitle: true },
          { text: "keyword slide text" },
        ],
      },
      {
        slideIndex: 1,
        paragraphs: [{ text: "second slide" }],
      },
    ]);

    const file = new File([new Uint8Array([1, 2, 3])], "slides.pptx");
    const text = await extractSearchableTextForFile({
      extension: "pptx",
      file,
    });

    expect(text).toContain("keyword slide text");
    expect(text).toContain("second slide");
  });

  it("strips html tags for searchable text", async () => {
    const file = new File(["<h1>Title</h1><p>keyword body</p>"], "page.html");
    const text = await extractSearchableTextForFile({
      extension: "html",
      file,
    });

    expect(text).toContain("keyword body");
    expect(text).not.toContain("<h1>");
  });

  it("treats project code extensions as searchable text", () => {
    expect(isSearchableTextExtension("rs")).toBe(true);
    expect(isSearchableTextExtension("yaml")).toBe(true);
    expect(isSearchableTextExtension("md")).toBe(true);
    expect(isSearchableTextExtension("pptx")).toBe(true);
    expect(isSearchableTextExtension("pdf")).toBe(false);
  });

  it("marks only line-addressable text formats as line navigable", () => {
    expect(isLineNavigableSearchExtension("ts")).toBe(true);
    expect(isLineNavigableSearchExtension("md")).toBe(true);
    expect(isLineNavigableSearchExtension("html")).toBe(false);
    expect(isLineNavigableSearchExtension("ipynb")).toBe(false);
    expect(isLineNavigableSearchExtension("docx")).toBe(false);
    expect(isLineNavigableSearchExtension("pptx")).toBe(false);
  });

  it("ignores imported VS Code search excludes until compatibility is enabled", () => {
    useVSCodeCompatStore.setState({
      ...useVSCodeCompatStore.getState(),
      settings: {
        ...useVSCodeCompatStore.getState().settings,
        searchExclude: {
          "**/dist/**": true,
        },
      },
    });

    expect(shouldExcludeFromWorkspaceSearch("project/dist/index.js")).toBe(false);

    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        vscodeCompatEnabled: true,
      },
    });

    expect(shouldExcludeFromWorkspaceSearch("project/dist/index.js")).toBe(true);
  });
});

describe("normalizeSearchText", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeSearchText("  Hello   World\nsecond line  ")).toBe(
      "hello world second line",
    );
  });

  it("strips control characters", () => {
    expect(normalizeSearchText("a\u0000b\u0007c")).toBe("a b c");
  });

  it("handles empty and blank input", () => {
    expect(normalizeSearchText("")).toBe("");
    expect(normalizeSearchText("   \n ")).toBe("");
  });
});
