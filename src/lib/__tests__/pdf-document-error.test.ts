import { describe, expect, it } from "vitest";

import { classifyPdfDocumentError } from "../pdf-document-error";

describe("pdf-document-error", () => {
  it.each([
    "Invalid PDF structure",
    "InvalidPDFException: Invalid PDF structure.",
    "FormatError: Invalid XRef stream",
    "FormatError: bad trailer end",
  ])("classifies structurally damaged PDFs: %s", (message) => {
    expect(classifyPdfDocumentError(new Error(message))).toBe("damaged");
  });

  it.each([
    "PasswordException: No password given",
    "PasswordException: Incorrect Password",
  ])("classifies password-protected PDFs: %s", (message) => {
    expect(classifyPdfDocumentError(new Error(message))).toBe("password");
  });

  it.each([
    "MissingPDFException: Missing PDF",
    "Unexpected server response (404) while retrieving PDF",
  ])("classifies unavailable PDF sources: %s", (message) => {
    expect(classifyPdfDocumentError(new Error(message))).toBe("missing");
  });

  it("keeps unknown failures generic", () => {
    expect(classifyPdfDocumentError(new Error("Worker terminated"))).toBe("generic");
    expect(classifyPdfDocumentError(null)).toBe("generic");
  });
});
