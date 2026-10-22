import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const output = "supabase/functions/shared-library-api";
await mkdir(output, { recursive: true });
const bundled = await build({ entryPoints: ["workers/shared-library-api/src/supabase-edge.ts"], bundle: true, platform: "neutral", format: "esm", target: "es2022", write: false });
const entry = bundled.outputFiles[0].text.replace(/export \{[\s\S]*?\};\s*$/, "");
await writeFile(`${output}/index.js`, `${entry}\nexport default { fetch(request) { return handleSupabaseEdgeRequest(request, {
  SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
  SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY"),
  ALLOWED_ORIGINS: "http://tauri.localhost,https://tauri.localhost,tauri://localhost,https://lattice-apq.pages.dev,https://lattice-apq-7xj.pages.dev",
  BLOB_BACKEND: "supabase", MAX_UPLOAD_BYTES: "20971520",
}); } };\n`);
// Platform JWT verification remains enabled. No service-role access or secret.
await writeFile("supabase/config.toml", 'project_id = "lattice-cloud"\n\n[functions.shared-library-api]\nverify_jwt = true\nentrypoint = "./functions/shared-library-api/index.js"\n');
console.log("Prepared shared cloud API for Supabase with platform JWT verification enabled.");
