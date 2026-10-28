import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const output = "supabase/functions/shared-library-api";
await mkdir(output, { recursive: true });
const bundled = await build({ entryPoints: ["workers/shared-library-api/src/supabase-edge.ts"], bundle: true, platform: "neutral", format: "esm", target: "es2022", write: false });
const entry = bundled.outputFiles[0].text.replace(/export \{[\s\S]*?\};\s*$/, "");
await writeFile(`${output}/index.js`, `${entry}\nexport default { fetch(request) { return handleSupabaseEdgeRequest(request, {
  SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
  SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY"),
  ALLOWED_ORIGINS: Deno.env.get("ALLOWED_ORIGINS") || "http://tauri.localhost,https://tauri.localhost,tauri://localhost,https://lattice-apq.pages.dev,https://lattice-apq-7xj.pages.dev",
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  TEAM_AI_PROVIDERS_JSON: Deno.env.get("TEAM_AI_PROVIDERS_JSON"),
  TEAM_AI_ENCRYPTION_KEY: Deno.env.get("TEAM_AI_ENCRYPTION_KEY"),
  TEAM_AI_ALLOWED_ORIGINS: Deno.env.get("TEAM_AI_ALLOWED_ORIGINS"),
  GITHUB_APP_CLIENT_ID: Deno.env.get("GITHUB_APP_CLIENT_ID"),
  GITHUB_APP_CLIENT_SECRET: Deno.env.get("GITHUB_APP_CLIENT_SECRET"),
  GITHUB_TOKEN_ENCRYPTION_KEY: Deno.env.get("GITHUB_TOKEN_ENCRYPTION_KEY"),
  GITHUB_OAUTH_REDIRECT_URI: Deno.env.get("GITHUB_OAUTH_REDIRECT_URI"),
  GITHUB_APP_SLUG: Deno.env.get("GITHUB_APP_SLUG"),
  GITHUB_OAUTH_ALLOWED_RETURN_ORIGINS: Deno.env.get("GITHUB_OAUTH_ALLOWED_RETURN_ORIGINS"),
  BLOB_BACKEND: "supabase", MAX_UPLOAD_BYTES: "20971520",
}); } };\n`);
// Main API keeps platform JWT verification. Public webhooks and job ingress are
// separate functions with HMAC/server-secret validation and no user API dispatch.
for (const [name, source, handler] of [
  ['shared-library-github-webhook', 'workers/shared-library-api/src/github.ts', 'handleGitHubWebhook'],
  ['shared-library-github-jobs', 'workers/shared-library-api/src/github-jobs.ts', 'handleGitHubJobs'],
]) {
  const bundle = await build({ stdin: { contents: `export { ${handler} } from './${source}';`, resolveDir: process.cwd() }, bundle: true, platform: 'neutral', format: 'esm', target: 'es2022', write: false });
  const code = bundle.outputFiles[0].text.replace(/export \{[\s\S]*?\};\s*$/, '');
  const folder = `supabase/functions/${name}`; await mkdir(folder, { recursive: true });
  const fields = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET', 'GITHUB_TOKEN_ENCRYPTION_KEY', 'GITHUB_OAUTH_REDIRECT_URI', 'GITHUB_APP_SLUG', 'GITHUB_OAUTH_ALLOWED_RETURN_ORIGINS', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_SYNC_JOB_SECRET', 'TEAM_AI_ENCRYPTION_KEY'];
  await writeFile(`${folder}/index.js`, `${code}\nexport default { fetch(request) { return ${handler}(request, {${fields.map(field => `${field}: Deno.env.get(\"${field}\")`).join(',')}}); } };\n`);
}
await writeFile('supabase/config.toml', `project_id = "lattice-cloud"\n\n[functions.shared-library-api]\nverify_jwt = true\nentrypoint = "./functions/shared-library-api/index.js"\n\n[functions.shared-library-github-webhook]\nverify_jwt = false\nentrypoint = "./functions/shared-library-github-webhook/index.js"\n\n[functions.shared-library-github-jobs]\nverify_jwt = false\nentrypoint = "./functions/shared-library-github-jobs/index.js"\n`);
console.log('Prepared API (JWT), GitHub webhook (HMAC), and GitHub retry job (server secret). Not deployed.');
