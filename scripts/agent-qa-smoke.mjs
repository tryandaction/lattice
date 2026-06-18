import { spawn } from "node:child_process";
import process from "node:process";

const AGENT_TEST_FILES = [
  "src/lib/__tests__/ai-agent-session-debug-bundle.test.ts",
  "src/lib/__tests__/ai-agent-session-audit-view-model.test.ts",
  "src/lib/__tests__/ai-agent-composer-view-model.test.ts",
  "src/lib/__tests__/ai-agent-cowork-inbox-view-model.test.ts",
  "src/lib/__tests__/ai-agent-result-view-model.test.ts",
  "src/lib/__tests__/ai-agent-run-report-view-model.test.ts",
  "src/lib/__tests__/ai-agent-review-queue-view-model.test.ts",
  "src/lib/__tests__/ai-agent-session-focus.test.ts",
  "src/lib/__tests__/ai-agent-error.test.ts",
  "src/lib/__tests__/ai-agent-tool-broker.test.ts",
  "src/lib/__tests__/ai-lattice-path-identity.test.ts",
  "src/lib/__tests__/ai-lattice-skill-registry.test.ts",
  "src/lib/__tests__/ai-coding-qa-command-plan.test.ts",
  "src/lib/__tests__/ai-coding-qa-runner-view-model.test.ts",
  "src/lib/__tests__/ai-coding-proposal-planned-writes.test.ts",
  "src/lib/__tests__/ai-coding-proposal-view-model.test.ts",
  "src/lib/__tests__/ai-note-taking-draft-planner.test.ts",
  "src/lib/__tests__/ai-proposal-planned-writes.test.ts",
  "src/lib/__tests__/ai-orchestrator.test.ts",
  "src/lib/__tests__/ai-research-agent.test.ts",
  "src/lib/__tests__/ai-research-agent-chat-runner.test.ts",
  "src/lib/__tests__/ai-research-agent-workflows.test.ts",
  "src/lib/__tests__/ai-result-view-model.test.ts",
  "src/lib/__tests__/ai-agent-memory.test.ts",
  "src/components/ai/__tests__/ai-chat-panel.test.tsx",
  "src/components/ai/__tests__/agent-trace-panel.test.tsx",
  "src/components/ai/__tests__/agent-memory-panel.test.tsx",
];

function parseArgs(argv) {
  const options = {
    dryRun: argv.includes("--dry-run"),
    unitOnly: argv.includes("--unit-only"),
    typecheckOnly: argv.includes("--typecheck-only"),
    docsOnly: argv.includes("--docs-only"),
    browserOnly: argv.includes("--browser-only"),
    skipBrowser: argv.includes("--skip-browser"),
    skipTypecheck: argv.includes("--skip-typecheck"),
    skipDocs: argv.includes("--skip-docs"),
  };
  const onlyCount = [
    options.unitOnly,
    options.typecheckOnly,
    options.docsOnly,
    options.browserOnly,
  ].filter(Boolean).length;
  if (onlyCount > 1) {
    throw new Error("Use at most one --*-only flag.");
  }
  return options;
}

function buildSteps(options) {
  const agentUnitStep = {
    name: "agent-unit",
    command: process.execPath,
    args: [
      "./node_modules/vitest/vitest.mjs",
      "run",
      ...AGENT_TEST_FILES,
      "--maxWorkers=1",
    ],
  };
  const typecheckStep = {
    name: "typecheck",
    command: process.execPath,
    args: ["./node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false", "--incremental", "false"],
  };
  const docsStep = {
    name: "docs",
    command: process.execPath,
    args: ["scripts/check-docs.mjs"],
  };
  const browserStep = {
    name: "browser-ai-chat-research-agent",
    command: process.execPath,
    args: ["scripts/browser-regression.mjs"],
    env: {
      LATTICE_BROWSER_REGRESSION_FLOW: "ai-chat-research-agent",
      LATTICE_BROWSER_REGRESSION_PORT: "3245",
      LATTICE_BROWSER_REGRESSION_DIST_DIR: "web-dist-browser-regression-ai-agent-smoke",
    },
  };

  if (options.unitOnly) {
    return [agentUnitStep];
  }
  if (options.typecheckOnly) {
    return [typecheckStep];
  }
  if (options.docsOnly) {
    return [docsStep];
  }
  if (options.browserOnly) {
    return [browserStep];
  }

  const steps = [agentUnitStep];
  if (!options.skipTypecheck) {
    steps.push(typecheckStep);
  }
  if (!options.skipDocs) {
    steps.push(docsStep);
  }
  if (!options.skipBrowser) {
    steps.push(browserStep);
  }

  return steps;
}

function runStep(step) {
  return new Promise((resolve, reject) => {
    console.log(`[agent-qa-smoke] start ${step.name}`);
    const child = spawn(step.command, step.args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        ...(step.env ?? {}),
      },
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        console.log(`[agent-qa-smoke] passed ${step.name}`);
        resolve();
        return;
      }
      reject(new Error(`${step.name} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const steps = buildSteps(options);

  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      options,
      steps: steps.map((step) => ({
        name: step.name,
        command: step.command,
        args: step.args,
        env: step.env ?? {},
      })),
    }, null, 2));
    return;
  }

  for (const step of steps) {
    await runStep(step);
  }
  console.log("[agent-qa-smoke] completed");
}

main().catch((error) => {
  console.error(`[agent-qa-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
