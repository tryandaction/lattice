import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
const MIGRATIONS_DIR = resolve(REPO_ROOT, "supabase/migrations");
const SEED_DIR = resolve(REPO_ROOT, "supabase/seed");

const REQUIRED_TABLES = [
  "organizations",
  "organization_members",
  "libraries",
  "library_members",
  "collections",
  "items",
  "item_children",
  "blobs",
  "item_versions",
  "annotations",
  "annotation_comments",
  "annotation_operations",
  "sync_operations",
  "sync_cursors",
  "activities",
  "invitations",
  "trash_entries",
  "search_documents",
];

function readSql(fileName: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, fileName), "utf8");
}

function normalize(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

describe("shared library schema contract (static migration check)", () => {
  const core = normalize(readSql("202608200001_shared_library_core.sql"));
  const rls = normalize(readSql("202608200002_shared_library_rls.sql"));

  it("defines every required table in the core migration", () => {
    for (const table of REQUIRED_TABLES) {
      expect(core, `missing table ${table}`).toContain(
        `create table if not exists public.${table}`,
      );
    }
  });

  it("defines the key constraints and indexes", () => {
    expect(core).toContain("primary key (library_id, user_id)");
    expect(core).toContain("unique (item_id, version_number)");
    expect(core).toContain("idempotency_key text not null unique");
    expect(core).toContain("unique (parent_item_id, relative_path)");
    expect(core).toContain("(library_id, updated_at)");
    expect(core).toContain(
      "kind in ('pdf', 'markdown', 'code', 'notebook', 'docx', 'pptx', 'image', 'web_snapshot', 'data', 'folder')",
    );
    expect(core).toContain("status in ('active', 'archived', 'trashed', 'conflicted')");
    expect(core).toContain("using gin (to_tsvector('simple'");
  });

  it("enables row level security for every table", () => {
    for (const table of REQUIRED_TABLES) {
      expect(rls, `missing rls for ${table}`).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("adds select/insert/update/delete policies for every table", () => {
    for (const table of REQUIRED_TABLES) {
      expect(rls, `missing ${table}_select`).toContain(`"${table}_select"`);
      expect(rls, `missing ${table}_insert`).toContain(`"${table}_insert"`);
      expect(rls, `missing ${table}_update`).toContain(`"${table}_update"`);
      expect(rls, `missing ${table}_delete`).toContain(`"${table}_delete"`);
    }
  });

  it("derives authorization from membership and auth.uid(), never a client role", () => {
    expect(rls).toContain("auth.uid()");
    expect(rls).toContain("is_library_member");
    expect(rls).toContain("has_library_role");
    expect(rls).toContain("is_org_member");
    expect(rls).not.toContain("using (role =");
  });

  it("ships a demo seed that references the demo library", () => {
    const seed = readFileSync(resolve(SEED_DIR, "shared-library.sql"), "utf8");
    expect(seed).toContain("demo-org");
    expect(seed).toContain("shared-research");
  });
});
