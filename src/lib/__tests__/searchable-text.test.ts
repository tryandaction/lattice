import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractSearchableTextForFile } from "../searchable-text";

const extractRawTextMock = vi.fn();

vi.mock("mammoth", () => ({
  default: {
    extractRawText: (...args: unknown[]) => extractRawTextMock(...args),
  },
}));

describe("searchable text extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("strips html tags for searchable text", async () => {
    const file = new File(["<h1>Title</h1><p>keyword body</p>"], "page.html");
    const text = await extractSearchableTextForFile({
      extension: "html",
      file,
    });

    expect(text).toContain("keyword body");
    expect(text).not.toContain("<h1>");
  });
});
