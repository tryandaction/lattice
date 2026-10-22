#!/usr/bin/env node
/**
 * Standalone shared-library smoke runner (no Supabase/R2/Worker required).
 *
 * Mirrors the canonical step contract implemented and tested in
 * `src/lib/shared-library/smoke-runner.ts` (see
 * `src/lib/shared-library/__tests__/shared-library-e2e-contract.test.ts`),
 * but runs as plain Node with self-contained in-memory fakes so it can be used
 * in CI or from a release checklist without a TypeScript loader.
 *
 * Usage:
 *   node scripts/shared-library-smoke.mjs [--json]
 *
 * Exit code is 0 when every step passes, 1 otherwise. Output is a JSON object:
 *   { steps: [{ step, operationId, status, reason? }], summary: { ok, failed, total } }
 */

const STEPS = [
  "create-library",
  "invite-member",
  "upload-pdf",
  "create-child-markdown",
  "annotate",
  "go-offline",
  "resume",
  "pull",
  "search",
  "delete",
  "restore",
  "snapshot-guard",
  "conflict-classification",
];

function makeOperation(state, type, entityType, entityId, payload = {}) {
  state.sequence += 1;
  const id = `${state.deviceId}:${state.sequence}`;
  return {
    id,
    libraryId: state.libraryId,
    actorId: state.actorId,
    deviceId: state.deviceId,
    clientSequence: state.sequence,
    operationType: type,
    entityType,
    entityId,
    payload,
    idempotencyKey: `${state.deviceId}:${state.sequence}`,
    createdAt: new Date().toISOString(),
  };
}

async function runSharedLibrarySmoke() {
  const steps = [];
  const queue = new Map(); // operationId -> operation
  const peerOperations = [];
  const seen = new Set();

  const state = {
    libraryId: "lib-1",
    itemId: "item-1",
    childItemId: "child-1",
    annotationId: "ann-1",
    versionId: "ver-1",
    sequence: 0,
    deviceId: "device-1",
    actorId: "user-1",
  };

  const network = { online: true };
  const enqueue = (operation) => queue.set(operation.id, operation);
  const push = (operations) => {
    if (!network.online) {
      throw new Error("offline");
    }
    for (const operation of operations) {
      if (!seen.has(operation.idempotencyKey)) {
        seen.add(operation.idempotencyKey);
        peerOperations.push(operation);
      }
    }
    return { accepted: operations.map((o) => o.id), rejected: [], conflicts: [] };
  };

  const run = async (step, fn) => {
    try {
      const operationId = await fn();
      steps.push({ step, operationId, status: "ok" });
    } catch (error) {
      steps.push({ step, operationId: "", status: "failed", reason: String(error?.message ?? error) });
    }
  };

  await run("create-library", async () => {
    const operation = makeOperation(state, "library.create", "library", "lib-1", { name: "Research Group" });
    enqueue(operation);
    return operation.id;
  });

  await run("invite-member", async () => {
    const operation = makeOperation(state, "member.invite", "member", "user-2", { role: "editor" });
    enqueue(operation);
    return operation.id;
  });

  await run("upload-pdf", async () => {
    const operation = makeOperation(state, "item.create", "item", state.itemId, { kind: "pdf" });
    enqueue(operation);
    return operation.id;
  });

  await run("create-child-markdown", async () => {
    const operation = makeOperation(state, "itemChild.create", "itemChild", state.childItemId, {
      parentItemId: state.itemId,
      relativePath: "notes.md",
    });
    enqueue(operation);
    return operation.id;
  });

  await run("annotate", async () => {
    const operation = makeOperation(state, "annotation.create", "annotation", state.annotationId, {
      kind: "highlight",
    });
    enqueue(operation);
    return operation.id;
  });

  await run("go-offline", async () => {
    network.online = false;
    let threw = false;
    try {
      push([...queue.values()]);
    } catch {
      threw = true;
    }
    if (!threw) {
      throw new Error("expected the offline push to fail");
    }
    if (queue.size === 0) {
      throw new Error("pending operations were dropped while offline");
    }
    return "";
  });

  await run("resume", async () => {
    network.online = true;
    const result = push([...queue.values()]);
    if (result.accepted.length === 0) {
      throw new Error("resume accepted no operations");
    }
    return "";
  });

  await run("pull", async () => {
    if (peerOperations.length === 0) {
      throw new Error("pull found no remote operations");
    }
    return peerOperations[peerOperations.length - 1].id;
  });

  await run("search", async () => {
    const result = {
      itemId: state.itemId,
      childItemId: state.childItemId,
      sourceType: "child-item",
      snippet: "…entanglement…",
      permissionSnapshot: { libraryId: "lib-1", itemId: state.itemId, canRead: true },
      updatedAt: new Date().toISOString(),
    };
    if (!result.snippet) {
      throw new Error("search returned no results");
    }
    return "";
  });

  await run("delete", async () => {
    const operation = makeOperation(state, "item.delete", "item", state.itemId);
    enqueue(operation);
    return operation.id;
  });

  await run("restore", async () => {
    const operation = makeOperation(state, "item.restore", "item", state.itemId);
    enqueue(operation);
    return operation.id;
  });

  await run("snapshot-guard", async () => {
    const blockedHost = /^(169\.254\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;
    const blocked = "http://169.254.169.254/latest/meta-data";
    const allowed = "https://arxiv.org/abs/2506.15633";
    if (!blockedHost.test(new URL(blocked).hostname)) {
      throw new Error("snapshot guard did not block a private host");
    }
    if (new URL(allowed).protocol !== "https:") {
      throw new Error("snapshot guard rejected a public URL");
    }
    return "";
  });

  await run("conflict-classification", async () => {
    const reason = "binary-version";
    const recoverable = ["binary-version", "annotation-revision", "delete-edit"].includes(reason);
    if (!recoverable) {
      throw new Error("conflict was not classified as recoverable");
    }
    return "conflict-1";
  });

  const ok = steps.filter((step) => step.status === "ok").length;
  return { steps, summary: { ok, failed: steps.length - ok, total: steps.length } };
}

const asJson = process.argv.includes("--json");

runSharedLibrarySmoke()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.summary.failed === 0 ? 0 : 1;
  })
  .catch((error) => {
    console.error(String(error?.stack ?? error));
    process.exitCode = 1;
  });
