import { describe, expect, it } from "vitest";
import {
  ANNOTATION_KINDS,
  ITEM_KINDS,
  LIBRARY_ROLES,
  buildIdempotencyKey,
  isItemKind,
  isLibraryRole,
  normalizeItemKind,
} from "../domain";

describe("shared library domain", () => {
  it("normalizes item kinds without changing unknown values", () => {
    expect(normalizeItemKind("application/pdf")).toBe("pdf");
    expect(normalizeItemKind("text/x-typescript")).toBe("code");
    expect(normalizeItemKind("application/octet-stream")).toBe("data");
  });

  it("passes through unknown mime types unchanged", () => {
    expect(normalizeItemKind("application/vnd.custom+json")).toBe(
      "application/vnd.custom+json",
    );
    expect(normalizeItemKind("")).toBe("");
  });

  it("treats an already-known item kind as normalized", () => {
    expect(normalizeItemKind("PDF")).toBe("pdf");
    expect(normalizeItemKind("web_snapshot")).toBe("web_snapshot");
  });

  it("keeps operation idempotency key stable", () => {
    expect(buildIdempotencyKey({ deviceId: "d1", clientSequence: 2 })).toBe("d1:2");
  });

  it("builds distinct idempotency keys per sequence", () => {
    expect(buildIdempotencyKey({ deviceId: "d1", clientSequence: 2 })).not.toBe(
      buildIdempotencyKey({ deviceId: "d1", clientSequence: 3 }),
    );
  });

  it("exposes the five library roles", () => {
    expect(LIBRARY_ROLES).toEqual(["owner", "admin", "editor", "commenter", "viewer"]);
  });

  it("exposes the first-class item kinds", () => {
    expect(ITEM_KINDS).toContain("pdf");
    expect(ITEM_KINDS).toContain("markdown");
    expect(ITEM_KINDS).toContain("code");
    expect(ITEM_KINDS).toContain("web_snapshot");
  });

  it("guards item kinds and library roles", () => {
    expect(isItemKind("pdf")).toBe(true);
    expect(isItemKind("application/pdf")).toBe(false);
    expect(isLibraryRole("editor")).toBe(true);
    expect(isLibraryRole("superuser")).toBe(false);
  });

  it("exposes the shared annotation kinds", () => {
    expect(ANNOTATION_KINDS).toEqual([
      "highlight",
      "underline",
      "area",
      "text",
      "ink",
      "comment",
    ]);
  });
});
