/** Offline-only: no environment lookup, config discovery, files, network or deployment. */
import { pathToFileURL } from "node:url";
import { preflightOperations } from "../workers/cloud-library-operations/src/preflight.mjs";

export async function runPreflightCli(args, input = process.stdin) {
  try {
    if (args.length === 0) return preflightOperations();
    if (args.length !== 1 || args[0] !== "--stdin-json") throw Error("INVALID_ARGUMENTS");
    let bytes = 0, json = "";
    input.setEncoding("utf8");
    for await (const chunk of input) { bytes += Buffer.byteLength(chunk); if (bytes > 65536) throw Error("INPUT_LIMIT"); json += chunk; }
    return preflightOperations(JSON.parse(json));
  } catch { return { version: 1, scope: "offline-operations-preflight", status: "invalid_input", deploymentVerified: false, networkRequests: 0, code: "PREFLIGHT_INPUT_INVALID" }; }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await runPreflightCli(process.argv.slice(2));
  console.log(JSON.stringify(result));
  process.exitCode = result.status === "configured-unverified" ? 0 : 2;
}
