// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function digest(bytes: string | Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

async function recoveryFixture() {
  const root = await mkdtemp(resolve(".lattice-build/cloud-recovery-package-fixture-"));
  const bytes = Buffer.from("synthetic recovery object");
  const object = { id: "blob-1", storage_key: "libraries/lib-1/blobs/object-1", storage_backend: "supabase", size_bytes: bytes.length, sha256: digest(bytes) };
  const libraryRoot = resolve(root, "lib-1");
  await mkdir(resolve(libraryRoot, "objects"), { recursive: true });
  await writeFile(resolve(libraryRoot, "objects", `${object.sha256}.bin`), bytes);
  const manifest = JSON.stringify({ version: 2, scope: "member-visible-library-objects", complete: true, libraryId: "lib-1", objectCount: 1, totalBytes: bytes.length, objects: [object] });
  await writeFile(resolve(libraryRoot, "manifest.json"), manifest);
  const artifacts = [];
  for (const kind of ["roles", "schema", "data", "history-schema", "history-data", "repository-migrations", "deployment-version", "public-config"]) {
    const data = Buffer.from(`synthetic ${kind}`);
    await writeFile(resolve(root, `${kind}.fixture`), data);
    artifacts.push({ kind, path: `${kind}.fixture`, sizeBytes: data.length, sha256: digest(data) });
  }
  const recoveryPoint = { version: 1, scope: "project-recovery-point", projectRef: "synthetic-project", artifacts, libraries: [{ libraryId: "lib-1", path: "lib-1", manifestSha256: digest(manifest) }] };
  const sourceInventory = { version: 1, projectRef: "synthetic-project", libraryIds: ["lib-1"], objects: [{ libraryId: "lib-1", ...object }] };
  await writeFile(resolve(root, "recovery-point.json"), JSON.stringify(recoveryPoint));
  const sourcePath = resolve(root, "source-inventory.json");
  await writeFile(sourcePath, JSON.stringify(sourceInventory));
  return { root, sourcePath, sourceInventory, recoveryPoint, object };
}

describe("local recovery package coverage", () => {
  it("checks all declared project artifacts and all independently inventoried object bytes without claiming a production restore", async () => {
    const { verifyCloudRecoveryPackage } = await import("../../../scripts/cloud-library-recovery-verify.mjs");
    const fixture = await recoveryFixture();
    expect(await verifyCloudRecoveryPackage(fixture.root, fixture.sourcePath)).toMatchObject({ status: "passed", scope: "local-recovery-package", libraries: 1, objects: 1, artifacts: 8, productionRestoreVerified: false });
  });

  it("rejects an RLS-limited backup that omits a source library", async () => {
    const { verifyCloudRecoveryPackage } = await import("../../../scripts/cloud-library-recovery-verify.mjs");
    const fixture = await recoveryFixture();
    fixture.sourceInventory.libraryIds.push("invisible-library");
    await writeFile(fixture.sourcePath, JSON.stringify(fixture.sourceInventory));
    await expect(verifyCloudRecoveryPackage(fixture.root, fixture.sourcePath)).rejects.toThrow(/library coverage/i);
  });

  it("rejects a missing historical blob even if the member backup is internally complete", async () => {
    const { verifyCloudRecoveryPackage } = await import("../../../scripts/cloud-library-recovery-verify.mjs");
    const fixture = await recoveryFixture();
    fixture.sourceInventory.objects.push({ libraryId: "lib-1", ...fixture.object, id: "historical-blob", storage_key: "libraries/lib-1/blobs/historical" });
    await writeFile(fixture.sourcePath, JSON.stringify(fixture.sourceInventory));
    await expect(verifyCloudRecoveryPackage(fixture.root, fixture.sourcePath)).rejects.toThrow(/object coverage/i);
  });

  it("rejects a missing migration ledger and corrupted database bytes", async () => {
    const { verifyCloudRecoveryPackage } = await import("../../../scripts/cloud-library-recovery-verify.mjs");
    const fixture = await recoveryFixture();
    const pointFile = resolve(fixture.root, "recovery-point.json");
    const point = JSON.parse(await readFile(pointFile, "utf8"));
    point.artifacts = point.artifacts.filter((artifact: { kind: string }) => artifact.kind !== "history-data");
    await writeFile(pointFile, JSON.stringify(point));
    await expect(verifyCloudRecoveryPackage(fixture.root, fixture.sourcePath)).rejects.toThrow(/required artifact/i);
    await writeFile(pointFile, JSON.stringify(fixture.recoveryPoint));
    await writeFile(resolve(fixture.root, "data.fixture"), "corrupted");
    await expect(verifyCloudRecoveryPackage(fixture.root, fixture.sourcePath)).rejects.toThrow(/artifact integrity/i);
  });

  it("rejects manifest paths outside the recovery root before opening them", async () => {
    const { verifyCloudRecoveryPackage } = await import("../../../scripts/cloud-library-recovery-verify.mjs");
    const fixture = await recoveryFixture();
    fixture.recoveryPoint.artifacts[0].path = "../outside.sql";
    await writeFile(resolve(fixture.root, "recovery-point.json"), JSON.stringify(fixture.recoveryPoint));
    await expect(verifyCloudRecoveryPackage(fixture.root, fixture.sourcePath)).rejects.toThrow(/unsafe.*path/i);
  });
});
