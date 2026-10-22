import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608300001_shared_library_security_hardening.sql"), "utf8")
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("shared library security hardening migration", () => {
  it("bootstraps owners server-side instead of allowing arbitrary owner claims", () => {
    expect(migration).toContain("bootstrap_organization_owner");
    expect(migration).toContain("bootstrap_library_owner");
    expect(migration).toContain("created_by = auth.uid()");
    expect(migration).toContain("role <> 'owner'");
  });

  it("restricts membership changes to administrators and owners", () => {
    expect(migration).toContain("is_org_admin");
    expect(migration).toContain("has_library_role(library_id, auth.uid(), 'admin')");
    expect(migration).toContain("role <> 'owner'");
  });

  it("makes annotations and comments author-scoped for ordinary collaborators", () => {
    expect(migration).toContain("author_id = auth.uid()");
    expect(migration).toContain("annotation_comments");
    expect(migration).toContain("using (false) with check (false)");
  });
});
