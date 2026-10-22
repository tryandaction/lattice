import { describe, expect, it } from "vitest";
import {
  isIsoTimestamp,
  parseAnnotationTarget,
  parseIdempotencyKey,
  parseItemKind,
  parseLibraryRole,
} from "../validators";

describe("shared library validators", () => {
  it("rejects annotation geometry that uses viewport pixels", () => {
    expect(() => parseAnnotationTarget({ viewportX: 10 })).toThrow("normalized");
  });

  it("rejects annotation targets that embed DOMRect or CSS pixel coordinates", () => {
    expect(() => parseAnnotationTarget({ clientX: 1, clientY: 2 })).toThrow("normalized");
    expect(() =>
      parseAnnotationTarget({ locatorType: "pdf-page", domRect: {} }),
    ).toThrow("normalized");
  });

  it("accepts a pdf-page target with a normalized page locator", () => {
    const target = parseAnnotationTarget({
      locatorType: "pdf-page",
      locator: { page: 3 },
    });
    expect(target.locatorType).toBe("pdf-page");
    expect(target.locator.page).toBe(3);
  });

  it("normalizes a top-level page into the locator", () => {
    const target = parseAnnotationTarget({ locatorType: "pdf-page", page: 5 });
    expect(target.locator.page).toBe(5);
  });

  it("rejects a pdf-page target without a page number", () => {
    expect(() => parseAnnotationTarget({ locatorType: "pdf-page" })).toThrow();
  });

  it("round-trips idempotency keys", () => {
    expect(parseIdempotencyKey("d1:2")).toEqual({ deviceId: "d1", clientSequence: 2 });
  });

  it("rejects malformed idempotency keys", () => {
    expect(() => parseIdempotencyKey("d1")).toThrow();
    expect(() => parseIdempotencyKey("d1:not-a-number")).toThrow();
    expect(() => parseIdempotencyKey(":2")).toThrow();
    expect(() => parseIdempotencyKey("d1:-1")).toThrow();
  });

  it("validates ISO timestamps", () => {
    expect(isIsoTimestamp("2026-08-20T00:00:00.000Z")).toBe(true);
    expect(isIsoTimestamp("not-a-date")).toBe(false);
    expect(isIsoTimestamp(123456)).toBe(false);
    expect(isIsoTimestamp(null)).toBe(false);
  });

  it("parses roles and item kinds", () => {
    expect(parseLibraryRole("editor")).toBe("editor");
    expect(() => parseLibraryRole("superuser")).toThrow();
    expect(parseItemKind("pdf")).toBe("pdf");
    expect(() => parseItemKind("application/pdf")).toThrow();
  });
});
