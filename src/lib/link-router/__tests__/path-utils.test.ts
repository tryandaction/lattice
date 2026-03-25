import { describe, expect, it } from "vitest";
import { buildWorkspaceCandidatePaths } from "../path-utils";

describe("buildWorkspaceCandidatePaths", () => {
  it("preserves explicit extensions", () => {
    expect(buildWorkspaceCandidatePaths("papers/review.pdf")).toEqual(["papers/review.pdf"]);
  });

  it("expands extensionless links across supported workspace file types", () => {
    expect(buildWorkspaceCandidatePaths("papers/review")).toEqual([
      "papers/review",
      "papers/review.md",
      "papers/review.ipynb",
      "papers/review.pdf",
      "papers/review.docx",
      "papers/review.pptx",
      "papers/review.html",
      "papers/review.txt",
      "papers/review.png",
      "papers/review.jpg",
      "papers/review.jpeg",
      "papers/review.gif",
    ]);
  });
});
