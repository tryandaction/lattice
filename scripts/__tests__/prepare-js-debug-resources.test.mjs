// @vitest-environment node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resourceLayout,
  validateArchiveEntries,
  validateDescriptor,
  verifyArchiveBuffer,
} from "../prepare-js-debug-resources.mjs";

const PINNED_DESCRIPTOR = {
  schemaVersion: 1,
  version: "1.117.0",
  assetUrl:
    "https://github.com/microsoft/vscode-js-debug/releases/download/v1.117.0/js-debug-dap-v1.117.0.tar.gz",
  assetBytes: 1_216_795,
  sha256: "ad8d04ede9d4b75cc290fd5438a65047a06f786d04f604b6112485b36f090772",
  rootDirectory: "js-debug",
};

describe("prepare-js-debug-resources", () => {
  it("accepts the pinned official standalone DAP descriptor", async () => {
    const descriptor = JSON.parse(
      await fs.readFile(path.resolve("scripts/js-debug-runtime.json"), "utf8"),
    );

    expect(validateDescriptor(descriptor)).toEqual([]);
    expect(descriptor).toEqual(PINNED_DESCRIPTOR);
  });

  it("rejects floating, insecure, malformed, and inconsistent descriptors", () => {
    expect(validateDescriptor({ ...PINNED_DESCRIPTOR, version: "latest" })).toContain(
      "version must be a semantic version.",
    );
    expect(
      validateDescriptor({ ...PINNED_DESCRIPTOR, assetUrl: PINNED_DESCRIPTOR.assetUrl.replace("https:", "http:") }),
    ).toContain("assetUrl must reference an HTTPS microsoft/vscode-js-debug release asset.");
    expect(
      validateDescriptor({ ...PINNED_DESCRIPTOR, assetUrl: "https://example.com/js-debug.tar.gz" }),
    ).toContain("assetUrl must reference an HTTPS microsoft/vscode-js-debug release asset.");
    expect(validateDescriptor({ ...PINNED_DESCRIPTOR, assetBytes: 0 })).toContain(
      "assetBytes must be a positive integer.",
    );
    expect(validateDescriptor({ ...PINNED_DESCRIPTOR, sha256: "latest" })).toContain(
      "sha256 must be a lowercase SHA-256 digest.",
    );
    expect(validateDescriptor({ ...PINNED_DESCRIPTOR, rootDirectory: "../js-debug" })).toContain(
      "rootDirectory must be a single relative directory name.",
    );
  });

  it("rejects unsafe archives and missing runtime contract files", () => {
    const validEntries = [
      "js-debug/",
      "js-debug/src/",
      "js-debug/src/dapDebugServer.js",
      "js-debug/LICENSE",
    ];

    expect(validateArchiveEntries(validEntries, "js-debug")).toEqual([]);
    expect(validateArchiveEntries([...validEntries, "../escape"], "js-debug")).toContain(
      "Archive entries must stay inside js-debug/.",
    );
    expect(validateArchiveEntries([...validEntries, "C:/escape"], "js-debug")).toContain(
      "Archive entries must stay inside js-debug/.",
    );
    expect(
      validateArchiveEntries(validEntries.filter((entry) => !entry.endsWith("dapDebugServer.js")), "js-debug"),
    ).toContain("Archive is missing js-debug/src/dapDebugServer.js.");
    expect(
      validateArchiveEntries(validEntries.filter((entry) => !entry.endsWith("LICENSE")), "js-debug"),
    ).toContain("Archive is missing js-debug/LICENSE.");
  });

  it("verifies archive bytes and SHA-256 before extraction", () => {
    const bytes = Buffer.from("standalone-js-debug");
    const descriptor = {
      ...PINNED_DESCRIPTOR,
      assetBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };

    expect(verifyArchiveBuffer(bytes, descriptor)).toEqual([]);
    expect(verifyArchiveBuffer(Buffer.concat([bytes, Buffer.from("x")]), descriptor)).toContain(
      `Archive size must be ${bytes.length} bytes.`,
    );
    expect(verifyArchiveBuffer(Buffer.from("different bytes"), {
      ...descriptor,
      assetBytes: Buffer.byteLength("different bytes"),
    })).toContain("Archive SHA-256 does not match the pinned descriptor.");
  });

  it("resolves generated and packaged resource paths deterministically", () => {
    expect(resourceLayout("C:/repo")).toEqual({
      resourceRoot: path.resolve("C:/repo/src-tauri/resources/vscode-js-debug"),
      runtimeRoot: path.resolve("C:/repo/src-tauri/resources/vscode-js-debug/js-debug"),
      adapterEntry: path.resolve("C:/repo/src-tauri/resources/vscode-js-debug/js-debug/src/dapDebugServer.js"),
      license: path.resolve("C:/repo/src-tauri/resources/vscode-js-debug/js-debug/LICENSE"),
    });
  });
});
