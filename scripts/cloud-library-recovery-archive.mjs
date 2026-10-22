/** Offline encrypted transport of an already verified project recovery point. */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, lstat, mkdir, open, readFile, realpath, link, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGzip, createGunzip } from "node:zlib";
import { verifyCloudRecoveryPackage } from "./cloud-library-recovery-verify.mjs";

const magic = Buffer.from("LATBKP01");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const isInside = (parent, child) => { const part = relative(parent, child); return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(".." + sep)); };
function encryptionKey(key) {
  if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error("A separate 32-byte encryption key is required");
  return key;
}
function safeEntry(path) {
  return typeof path === "string" && path.length <= 1024 && path.split("/").every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== "." && part !== ".." && !part.endsWith(".") && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
}
async function regular(path, directory = false) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) throw new Error("Unsafe backup path or symbolic link");
  return stat;
}
async function sourceFile(root, entry) {
  if (!safeEntry(entry)) throw new Error("Unsafe archive entry path");
  let path = root; const segments = entry.split("/");
  for (let index = 0; index < segments.length; index++) {
    path = resolve(path, segments[index]);
    await regular(path, index < segments.length - 1);
  }
  return path;
}
async function fileDigest(path) {
  const hash = createHash("sha256"); let size = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); size += chunk.length; if (!Number.isSafeInteger(size)) throw new Error("Archive file too large"); }
  return { sizeBytes: size, sha256: hash.digest("hex") };
}
async function absent(path) {
  try { await lstat(path); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error("Output already exists");
}
async function archiveEntries(root, sourceInventoryPath, sourceHash, pointHash) {
  const entries = new Map();
  async function add(name, path, expected, snapshot = false) {
    const canonicalName = name.toLowerCase();
    if (!safeEntry(name) || entries.has(canonicalName)) throw new Error("Duplicate or unsafe archive entry");
    await regular(path);
    const bytes = snapshot ? await readFile(path) : undefined;
    const metadata = bytes ? { sizeBytes: bytes.length, sha256: digest(bytes) } : await fileDigest(path);
    if (expected && (metadata.sha256 !== expected.sha256 || (expected.sizeBytes !== undefined && metadata.sizeBytes !== expected.sizeBytes))) throw new Error("Source changed before archive creation");
    entries.set(canonicalName, { path: name, source: path, ...(bytes ? { bytes } : {}), ...metadata });
    return bytes;
  }
  await add("source-inventory.json", sourceInventoryPath, { sha256: sourceHash }, true);
  const pointBytes = await add("package/recovery-point.json", await sourceFile(root, "recovery-point.json"), { sha256: pointHash }, true);
  const point = JSON.parse(pointBytes.toString("utf8"));
  for (const artifact of point.artifacts) await add("package/" + artifact.path, await sourceFile(root, artifact.path), artifact);
  for (const library of point.libraries) {
    const manifestPath = library.path + "/manifest.json";
    const manifestBytes = await add("package/" + manifestPath, await sourceFile(root, manifestPath), { sha256: library.manifestSha256 }, true);
    // Parse and encode exactly the bytes just hashed, never a later filesystem read.
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    const hashes = new Set();
    for (const object of manifest.objects) {
      if (hashes.has(object.sha256)) continue;
      hashes.add(object.sha256);
      const path = library.path + "/objects/" + object.sha256 + ".bin";
      await add("package/" + path, await sourceFile(root, path), { sha256: object.sha256, sizeBytes: object.size_bytes });
    }
  }
  return [...entries.values()];
}
async function* encodeEntries(entries) {
  const header = Buffer.from(JSON.stringify({ version: 1, entries: entries.map(({ path, sizeBytes, sha256 }) => ({ path, sizeBytes, sha256 })) }));
  if (header.length > 16 * 1024 * 1024) throw new Error("Recovery index too large");
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(header.length);
  yield prefix; yield header;
  for (const entry of entries) {
    if (entry.bytes) { yield entry.bytes; continue; }
    const hash = createHash("sha256"); let size = 0;
    for await (const chunk of createReadStream(entry.source)) { hash.update(chunk); size += chunk.length; yield chunk; }
    if (size !== entry.sizeBytes || hash.digest("hex") !== entry.sha256) throw new Error("Source changed during archive creation");
  }
}

/** The output must be outside the source tree; this alone does not prove offsite storage. */
export async function sealRecoveryArchive({ recoveryRoot, sourceInventoryPath, output, key }) {
  encryptionKey(key);
  const root = await realpath(recoveryRoot), inventory = resolve(sourceInventoryPath), target = resolve(output);
  await regular(root, true); await regular(inventory);
  const parent = await realpath(dirname(target));
  if (isInside(root, resolve(parent, basename(target)))) throw new Error("Encrypted copy must be outside the source on independent storage");
  await absent(target);
  const sourceHash = digest(await readFile(inventory)), pointHash = digest(await readFile(await sourceFile(root, "recovery-point.json")));
  const verified = await verifyCloudRecoveryPackage(root, inventory);
  const entries = await archiveEntries(root, inventory, sourceHash, pointHash);
  const temporary = resolve(parent, ".lattice-seal-" + randomUUID() + ".tmp");
  const iv = randomBytes(12), header = Buffer.concat([magic, iv]);
  const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(header);
  try {
    await writeFile(temporary, header, { flag: "wx", mode: 0o600 });
    await pipeline(Readable.from(encodeEntries(entries)), createGzip(), cipher, createWriteStream(temporary, { flags: "a", mode: 0o600 }));
    await appendFile(temporary, cipher.getAuthTag());
    // Publishing with a hard link is exclusive; an existing good archive is never replaced.
    await link(temporary, target);
    return { status: "sealed", scope: "encrypted-local-recovery-package", ...(await fileDigest(target)), files: entries.length, objects: verified.objects, artifacts: verified.artifacts, productionRestoreVerified: false, independentStorageVerified: false };
  } finally { await unlink(temporary).catch(() => {}); }
}

class EntryReader {
  constructor(stream) { this.iterator = stream[Symbol.asyncIterator](); this.buffer = Buffer.alloc(0); this.done = false; }
  async read(size, allowEof = false) {
    while (this.buffer.length < size && !this.done) {
      const next = await this.iterator.next(); this.done = next.done;
      if (!next.done) this.buffer = Buffer.concat([this.buffer, next.value]);
    }
    if (this.buffer.length < size) { if (allowEof && this.buffer.length === 0) return null; throw new Error("Truncated recovery archive"); }
    const bytes = this.buffer.subarray(0, size); this.buffer = this.buffer.subarray(size); return bytes;
  }
}
async function extractArchive(plaintext, output, maxUnpackedBytes) {
  const stream = createReadStream(plaintext).pipe(createGunzip());
  const reader = new EntryReader(stream);
  try {
    const prefix = await reader.read(4), length = prefix.readUInt32BE();
    if (length < 1 || length > 16 * 1024 * 1024) throw new Error("Invalid recovery index length");
    const index = JSON.parse((await reader.read(length)).toString("utf8"));
    if (index.version !== 1 || !Array.isArray(index.entries) || index.entries.length < 2 || index.entries.length > 100000) throw new Error("Invalid recovery index");
    const paths = new Set(), canonicalPaths = new Set(); let total = 0;
    for (const entry of index.entries) {
      if (!safeEntry(entry.path) || !(entry.path.startsWith("package/") || entry.path === "source-inventory.json") || canonicalPaths.has(entry.path.toLowerCase()) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Unsafe or duplicate recovery index entry");
      total += entry.sizeBytes; if (!Number.isSafeInteger(total) || total > maxUnpackedBytes) throw new Error("Recovery archive exceeds unpacked byte limit");
      paths.add(entry.path); canonicalPaths.add(entry.path.toLowerCase());
    }
    if (!paths.has("package/recovery-point.json") || !paths.has("source-inventory.json")) throw new Error("Missing recovery index artifacts");
    await mkdir(output);
    for (const entry of index.entries) {
      const target = resolve(output, entry.path); await mkdir(dirname(target), { recursive: true });
      const file = await open(target, "wx", 0o600); const hash = createHash("sha256");
      try {
        let remaining = entry.sizeBytes;
        while (remaining > 0) { const bytes = await reader.read(Math.min(65536, remaining)); hash.update(bytes); await file.writeFile(bytes); remaining -= bytes.length; }
      } finally { await file.close(); }
      if (hash.digest("hex") !== entry.sha256) throw new Error("Recovery entry integrity mismatch");
    }
    if (await reader.read(1, true)) throw new Error("Unexpected trailing recovery bytes");
  } finally { stream.destroy(); }
}

/** Decrypts only after GCM authentication, then verifies into a new local directory. */
export async function openRecoveryArchive({ archive, output, key, maxUnpackedBytes = 100 * 1024 * 1024 * 1024 }) {
  encryptionKey(key);
  if (!Number.isSafeInteger(maxUnpackedBytes) || maxUnpackedBytes <= 0) throw new Error("Invalid recovery unpacked byte limit");
  const input = resolve(archive), target = resolve(output), parent = await realpath(dirname(target));
  const stat = await regular(input); await absent(target);
  if (stat.size < 37) throw new Error("Invalid encrypted recovery archive");
  const source = await open(input, "r"); let header, tag;
  try {
    header = Buffer.alloc(20); tag = Buffer.alloc(16);
    await source.read(header, 0, 20, 0); await source.read(tag, 0, 16, stat.size - 16);
  } finally { await source.close(); }
  if (!header.subarray(0, 8).equals(magic)) throw new Error("Invalid encrypted recovery archive");
  const temporary = resolve(parent, ".lattice-decrypt-" + randomUUID() + ".tmp");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(8)); decipher.setAAD(header); decipher.setAuthTag(tag);
  try {
    try { await pipeline(createReadStream(input, { start: 20, end: stat.size - 17 }), decipher, createWriteStream(temporary, { flags: "wx", mode: 0o600 })); }
    catch { throw new Error("Unable to authenticate or decrypt recovery archive"); }
    await extractArchive(temporary, target, maxUnpackedBytes);
    const point = JSON.parse(await readFile(resolve(target, "package/recovery-point.json"), "utf8"));
    if (!Array.isArray(point.libraries)) throw new Error("Invalid recovered library list");
    for (const library of point.libraries) {
      if (!safeEntry(library.path)) throw new Error("Unsafe recovered library path");
      await mkdir(resolve(target, "package", library.path, "objects"), { recursive: true });
    }
    const verified = await verifyCloudRecoveryPackage(resolve(target, "package"), resolve(target, "source-inventory.json"));
    const result = { status: "verified", scope: "isolated-offline-recovery", filesRestored: true, objects: verified.objects, libraries: verified.libraries, artifacts: verified.artifacts, productionRestoreVerified: false };
    await writeFile(resolve(target, "verified-recovery.json"), JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
    return result;
  } finally { await unlink(temporary).catch(() => {}); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const [mode, input, output, sourceInventoryPath, ...extra] = process.argv.slice(2);
    const encoded = process.env.LATTICE_RECOVERY_KEY_BASE64;
    if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded) || extra.length || !input || !output || !["seal", "open"].includes(mode) || (mode === "seal" ? !sourceInventoryPath : sourceInventoryPath)) throw new Error("Invalid recovery archive arguments");
    const key = Buffer.from(encoded, "base64");
    const result = mode === "seal" ? await sealRecoveryArchive({ recoveryRoot: input, output, sourceInventoryPath, key }) : await openRecoveryArchive({ archive: input, output, key });
    console.log(JSON.stringify(result));
  } catch {
    console.error(JSON.stringify({ status: "failed", code: "ENCRYPTED_RECOVERY_INVALID", usage: "node scripts/cloud-library-recovery-archive.mjs seal|open <source> <new-output> [source-inventory-for-seal]" }));
    process.exitCode = 1;
  }
}
