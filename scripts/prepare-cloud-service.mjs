import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.some(arg => !/^--storage=(supabase|r2)$/.test(arg)) || args.length > 1) throw new Error("Usage: node scripts/prepare-cloud-service.mjs [--storage=supabase|r2]");
const storageBackend = args[0]?.split("=")[1] ?? "supabase";
const maxFileBytes = 20 * 1024 * 1024;
const output = path.join(root, ".lattice-build", `cloud-service-setup-20261017-${storageBackend}`);
const migrations = [
  "202608200001_shared_library_core.sql", "202608200002_shared_library_rls.sql",
  "202608300001_shared_library_security_hardening.sql", "202610080001_cloud_team_library.sql",
  "202610120001_cloud_member_display_names.sql",
  "202610130001_cloud_supabase_storage.sql",
  "202610130002_cloud_function_privileges.sql",
  "202610170001_cloud_large_objects.sql",
];
const content = await Promise.all(migrations.map(async name => ({ name, sql: await readFile(path.join(root, "supabase", "migrations", name), "utf8") })));
await mkdir(output, { recursive: true });
// A fresh-project initializer. Existing services must use their migration
// ledger instead of replaying initial schema and trigger definitions.
const sql = [
  "-- Lattice managed cloud initializer: NEW EMPTY SUPABASE PROJECT ONLY.",
  "-- Operator applies this once. Ordinary Lattice users never run SQL or configure cloud vendors.",
  "begin;",
  "do $$ begin if to_regclass('public.libraries') is not null then raise exception 'Existing library schema detected. Use tracked migrations instead of this initializer.'; end if; end $$;",
  ...content.flatMap(({ name, sql: migration }) => [`\n-- BEGIN ${name}`, migration, `-- END ${name}\n`]),
  "notify pgrst, 'reload schema';", "commit;", "",
].join("\n");
const config = {
  name: "lattice-shared-library-api", main: path.join(root, "workers/shared-library-api/src/index.ts").replaceAll("\\", "/"),
  compatibility_date: "2026-08-30", workers_dev: true,
  vars: { ALLOWED_ORIGINS: "http://tauri.localhost,https://tauri.localhost,tauri://localhost,https://lattice-apq.pages.dev,https://lattice-apq-7xj.pages.dev", MAX_UPLOAD_BYTES: String(maxFileBytes), BLOB_BACKEND: storageBackend },
  ...(storageBackend === "r2" ? { r2_buckets: [{ binding: "LIBRARY_BLOBS", bucket_name: "lattice-shared-library" }] } : {}),
};
await writeFile(path.join(output, "initialize-new-project.sql"), sql, "utf8");
await writeFile(path.join(output, "wrangler.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
await writeFile(path.join(output, "service-public.example.json"), JSON.stringify({ name: "Lattice 云库", apiUrl: "<deployed Worker HTTPS URL>", supabaseUrl: "<project Supabase HTTPS URL>", publicKey: "<public publishable or anon key only>", maxFileBytes }, null, 2) + "\n", "utf8");
await writeFile(path.join(output, "upgrade-storage-existing-project.sql"), "begin;\n" + content.slice(5).map(migration => migration.sql).join("\n") + "\nnotify pgrst, 'reload schema';\ncommit;\n", "utf8");
await writeFile(path.join(output, "upgrade-20261013-existing-project.sql"), "begin;\n" + content.at(-1).sql + "\nnotify pgrst, 'reload schema';\ncommit;\n", "utf8");
const manifest = {
  generatedAt: new Date().toISOString(), status: "prepared-not-deployed", productionReady: false,
  storageBackend, maxFileBytes, requiresR2Subscription: storageBackend === "r2",
  operatorRequirements: ["Supabase project operator authorization for database migrations and private bucket setup", ...(storageBackend === "r2" ? ["R2 subscription enabled by owner"] : []), "Worker SUPABASE_URL/SUPABASE_ANON_KEY public configuration", "Worker deployment and real-account acceptance"],
  limitations: storageBackend === "supabase" ? ["Negotiated whole-object upload up to 20 MiB; interruption retries the whole object, no byte-offset TUS resumption", "950 MB application service cap; egress allowance is not enforced by this code", "Expired uploads retain reservations until authenticated Storage API cleanup succeeds"] : [],
  migrationCount: content.length,
  migrations: content.map(({ name, sql: migration }) => ({ name, sha256: createHash("sha256").update(migration).digest("hex") })),
  deployed: false,
};
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output, ...manifest }, null, 2));
