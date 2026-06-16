/**
 * @vitest-environment node
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("agent-qa-smoke script", () => {
  it("prints the planned Research Agent QA steps in dry-run mode", () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "agent-qa-smoke.mjs"),
        "--dry-run",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.steps.map((step: { name: string }) => step.name)).toEqual([
      "agent-unit",
      "typecheck",
      "docs",
      "browser-ai-chat-research-agent",
    ]);
    expect(payload.steps[0].args).toEqual(
      expect.arrayContaining([
        "src/lib/__tests__/ai-agent-session-audit-view-model.test.ts",
        "src/lib/__tests__/ai-research-agent.test.ts",
        "src/components/ai/__tests__/agent-trace-panel.test.tsx",
      ]),
    );
    expect(payload.steps[3].env).toMatchObject({
      LATTICE_BROWSER_REGRESSION_FLOW: "ai-chat-research-agent",
    });
  });

  it("can narrow the plan to unit tests only", () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "agent-qa-smoke.mjs"),
        "--dry-run",
        "--unit-only",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.steps.map((step: { name: string }) => step.name)).toEqual(["agent-unit"]);
  });

  it("can narrow the plan to individual non-unit QA stages", () => {
    const cases = [
      { flag: "--typecheck-only", expected: "typecheck" },
      { flag: "--docs-only", expected: "docs" },
      { flag: "--browser-only", expected: "browser-ai-chat-research-agent" },
    ];

    for (const item of cases) {
      const result = spawnSync(
        process.execPath,
        [
          path.join(process.cwd(), "scripts", "agent-qa-smoke.mjs"),
          "--dry-run",
          item.flag,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.steps.map((step: { name: string }) => step.name)).toEqual([item.expected]);
    }
  });

  it("rejects conflicting only flags", () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "agent-qa-smoke.mjs"),
        "--dry-run",
        "--unit-only",
        "--browser-only",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Use at most one --*-only flag.");
  });
});
