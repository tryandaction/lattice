/** Read-only, user-JWT Storage export. Pair it with an operator database dump. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function safeSegment(value) { return typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value); }
function validateRecord(row, libraryId) {
  if (!safeSegment(libraryId) || !row || !safeSegment(row.id) || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.size_bytes) || row.size_bytes < 0 || typeof row.storage_key !== "string" || !row.storage_key.startsWith(`libraries/${libraryId}/blobs/`) || row.storage_backend !== "supabase") throw new Error("Invalid or unsupported object descriptor");
  if (row.storage_key.split("/").some(segment => !safeSegment(segment))) throw new Error("Unsafe object descriptor path");
}
function recordInventory(objects, libraryId) {
  const ids = new Set(), keys = new Set();
  let totalBytes = 0;
  for (const object of objects) {
    validateRecord(object, libraryId);
    if (ids.has(object.id) || keys.has(object.storage_key)) throw new Error("Duplicate object descriptor");
    ids.add(object.id); keys.add(object.storage_key);
    totalBytes += object.size_bytes;
    if (!Number.isSafeInteger(totalBytes)) throw new Error("Invalid backup size");
  }
  return totalBytes;
}

async function regularPath(path, directory = false) {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !(directory ? stats.isDirectory() : stats.isFile())) throw new Error("Unsafe backup path or symbolic link");
  return stats;
}

export async function exportCloudObjects({ supabaseUrl, publicKey, accessToken, libraryId, output, fetchImpl = fetch }) {
  if (!safeSegment(libraryId)) throw new Error("Invalid library identifier");
  const root = resolve(output);
  const headers = { apikey: publicKey, authorization: `Bearer ${accessToken}` };
  const objects = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL("/rest/v1/blobs", supabaseUrl);
    Object.entries({ library_id: `eq.${libraryId}`, select: "id,storage_key,storage_backend,size_bytes,sha256,mime_type", order: "id.asc", limit: "1000", offset: String(offset) }).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetchImpl(url.toString(), { headers, signal: AbortSignal.timeout(30000), redirect: "error" });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Metadata export failed"); }
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("Invalid metadata export");
    for (const row of page) { validateRecord(row, libraryId); objects.push(row); }
    // Repeated pages or concurrent pagination changes must fail, not inflate coverage.
    recordInventory(objects, libraryId);
    if (page.length < 1000) break;
  }
  // Refuse an existing backup directory instead of overwriting a good backup.
  await mkdir(root);
  await mkdir(resolve(root, "objects"));
  const writtenHashes = new Set();
  for (const object of objects) {
    const key = object.storage_key.split("/").map(encodeURIComponent).join("/");
    const response = await fetchImpl(`${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/authenticated/lattice-shared-library/${key}`, { headers, signal: AbortSignal.timeout(120000), redirect: "error" });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Object export failed; incomplete backup"); }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== object.size_bytes || digest(bytes) !== object.sha256) throw new Error("Object integrity mismatch; incomplete backup");
    // Identical content may be referenced by multiple immutable blob records.
    if (!writtenHashes.has(object.sha256)) {
      await writeFile(resolve(root, "objects", `${object.sha256}.bin`), bytes, { flag: "wx" });
      writtenHashes.add(object.sha256);
    }
  }
  const totalBytes = recordInventory(objects, libraryId);
  const manifest = { version: 2, complete: true, scope: "member-visible-library-objects", libraryId, generatedAt: new Date().toISOString(), objectCount: objects.length, totalBytes, objects };
  await writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  return { status: "passed", objects: objects.length, totalBytes };
}

export async function readVerifiedCloudObjectBackup(output, { maxObjectBytes = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(maxObjectBytes) || maxObjectBytes < 0) throw new Error('Invalid backup object limit');
  const root = resolve(output);
  await regularPath(root, true);
  await regularPath(resolve(root, "manifest.json"));
  await regularPath(resolve(root, "objects"), true);
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  if (![1, 2].includes(manifest.version) || manifest.complete !== true || !safeSegment(manifest.libraryId) || !Array.isArray(manifest.objects)) throw new Error("Incomplete backup");
  const totalBytes = recordInventory(manifest.objects, manifest.libraryId);
  if (manifest.objects.some(object => object.size_bytes > maxObjectBytes)) throw new Error('Backup object exceeds byte limit');
  if (manifest.version === 2 && (manifest.scope !== "member-visible-library-objects" || manifest.objectCount !== manifest.objects.length || manifest.totalBytes !== totalBytes)) throw new Error("Backup coverage mismatch");
  for (const object of manifest.objects) {
    const path = resolve(root, "objects", `${object.sha256}.bin`);
    const stats = await regularPath(path);
    if (stats.size > maxObjectBytes || stats.size !== object.size_bytes) throw new Error("Backup integrity mismatch or byte limit exceeded");
    const digest = createHash("sha256"); let size = 0;
    for await (const bytes of createReadStream(path)) {
      size += bytes.length;
      if (size > maxObjectBytes || size > object.size_bytes) throw new Error("Backup integrity mismatch or byte limit exceeded");
      digest.update(bytes);
    }
    if (size !== object.size_bytes || digest.digest("hex") !== object.sha256) throw new Error("Backup integrity mismatch");
  }
  return manifest;
}

export async function verifyCloudObjectBackup(output) {
  const manifest = await readVerifiedCloudObjectBackup(output);
  return { status: "passed", objects: manifest.objects.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const [mode, output, libraryId] = process.argv.slice(2);
    if (!output || !["export", "verify"].includes(mode)) throw new Error("Invalid arguments");
    if (mode === "verify") console.log(JSON.stringify(await verifyCloudObjectBackup(output)));
    else {
      const supabaseUrl = process.env.LATTICE_SUPABASE_URL, publicKey = process.env.LATTICE_SUPABASE_PUBLIC_KEY, accessToken = process.env.LATTICE_CLOUD_USER_JWT;
      if (!libraryId || !supabaseUrl?.startsWith("https://") || !publicKey || !accessToken) throw new Error("Missing operator process configuration");
      console.log(JSON.stringify(await exportCloudObjects({ supabaseUrl, publicKey, accessToken, libraryId, output })));
    }
  } catch { console.error(JSON.stringify({ status: "failed", code: "BACKUP_INCOMPLETE_OR_INVALID", usage: "node scripts/cloud-library-object-backup.mjs export|verify <new-output-directory> [library-uuid]" })); process.exitCode = 1; }
}
