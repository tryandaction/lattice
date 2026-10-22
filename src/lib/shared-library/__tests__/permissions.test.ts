import { describe, expect, it } from "vitest";
import { CAPABILITIES, type LibraryRole } from "../domain";
import { assertCan, can } from "../permissions";
import { isSharedLibraryError } from "../errors";

const ALL_ROLES: LibraryRole[] = ["viewer", "commenter", "editor", "admin", "owner"];
const LADDER: LibraryRole[] = ["viewer", "commenter", "editor", "admin", "owner"];

describe("shared library permission matrix", () => {
  it("allows every role to read items", () => {
    for (const role of ALL_ROLES) {
      expect(can(role, "item.read"), `role=${role}`).toBe(true);
    }
  });

  it("gates version upload to editors and above", () => {
    expect(can("viewer", "version.create")).toBe(false);
    expect(can("commenter", "version.create")).toBe(false);
    expect(can("editor", "version.create")).toBe(true);
    expect(can("admin", "version.create")).toBe(true);
    expect(can("owner", "version.create")).toBe(true);
  });

  it("gates annotation creation to commenters and above", () => {
    expect(can("viewer", "annotation.create")).toBe(false);
    expect(can("commenter", "annotation.create")).toBe(true);
    expect(can("editor", "annotation.create")).toBe(true);
    expect(can("admin", "annotation.create")).toBe(true);
    expect(can("owner", "annotation.create")).toBe(true);
  });

  it("allows commenters and above to edit their own comments only", () => {
    expect(can("viewer", "comment.editOwn")).toBe(false);
    expect(can("commenter", "comment.editOwn")).toBe(true);
    expect(can("editor", "comment.editOwn")).toBe(true);
  });

  it("reserves editing others' comments to admins and owners", () => {
    expect(can("viewer", "comment.editOthers")).toBe(false);
    expect(can("commenter", "comment.editOthers")).toBe(false);
    expect(can("editor", "comment.editOthers")).toBe(false);
    expect(can("admin", "comment.editOthers")).toBe(true);
    expect(can("owner", "comment.editOthers")).toBe(true);
  });

  it("reserves member management to admins and owners", () => {
    expect(can("viewer", "member.manage")).toBe(false);
    expect(can("commenter", "member.manage")).toBe(false);
    expect(can("editor", "member.manage")).toBe(false);
    expect(can("admin", "member.manage")).toBe(true);
    expect(can("owner", "member.manage")).toBe(true);
  });

  it("reserves library deletion to owners only", () => {
    expect(can("viewer", "library.delete")).toBe(false);
    expect(can("commenter", "library.delete")).toBe(false);
    expect(can("editor", "library.delete")).toBe(false);
    expect(can("admin", "library.delete")).toBe(false);
    expect(can("owner", "library.delete")).toBe(true);
  });

  it("reserves item restore to admins and owners", () => {
    expect(can("viewer", "item.restore")).toBe(false);
    expect(can("commenter", "item.restore")).toBe(false);
    expect(can("editor", "item.restore")).toBe(false);
    expect(can("admin", "item.restore")).toBe(true);
    expect(can("owner", "item.restore")).toBe(true);
  });

  it("assertCan throws a structured permission error when denied", () => {
    let caught: unknown = null;
    try {
      assertCan("viewer", "library.delete");
    } catch (error) {
      caught = error;
    }
    if (!isSharedLibraryError(caught)) {
      throw new Error("expected a SharedLibraryError");
    }
    expect(caught.code).toBe("PERMISSION_DENIED");
    expect(caught.retryable).toBe(false);
  });

  it("assertCan is a no-op when allowed", () => {
    expect(() => assertCan("owner", "library.delete")).not.toThrow();
    expect(() => assertCan("editor", "version.create")).not.toThrow();
  });

  it("keeps the role hierarchy monotonic for every capability", () => {
    for (const capability of CAPABILITIES) {
      let previouslyAllowed = false;
      for (const role of LADDER) {
        const allowed = can(role, capability);
        if (previouslyAllowed && !allowed) {
          throw new Error(
            `capability "${capability}" is allowed for a lower role but regresses at "${role}"`,
          );
        }
        previouslyAllowed = allowed;
      }
    }
  });

  it("grants the owner every capability in the vocabulary", () => {
    for (const capability of CAPABILITIES) {
      expect(can("owner", capability), `owner:${capability}`).toBe(true);
    }
  });
});
