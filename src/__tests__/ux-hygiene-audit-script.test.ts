/**
 * @vitest-environment node
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

async function createTempProject() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lattice-ux-audit-"));
  tempDirs.push(dir);
  await mkdir(path.join(dir, "src", "lib", "i18n"), { recursive: true });
  await mkdir(path.join(dir, "src", "components"), { recursive: true });
  return dir;
}

async function writeFixtureProject(root: string) {
  await writeFile(
    path.join(root, "src", "lib", "i18n", "zh-CN.ts"),
    [
      "export const zhCN = {",
      "  'common.save': '保存',",
      "  'common.close': '关闭',",
      "} as const;",
      "export type TranslationKey = keyof typeof zhCN;",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "src", "lib", "i18n", "en-US.ts"),
    [
      "import type { TranslationKey } from './zh-CN';",
      "export const enUS: Record<TranslationKey, string> = {",
      "  'common.save': 'Save',",
      "} as const;",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "src", "components", "Demo.tsx"),
    [
      "export function Demo() {",
      "  return <div className=\"bg-white\" style={{ zIndex: 999 }}>硬编码中文</div>;",
      "}",
      "",
    ].join("\n"),
  );
}

describe("ux-hygiene-audit script", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("reports i18n, hardcoded text, theme, and z-index issues as JSON", async () => {
    const root = await createTempProject();
    await writeFixtureProject(root);

    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "ux-hygiene-audit.mjs"),
        "--root",
        root,
        "--json",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.summary.totalIssues).toBeGreaterThanOrEqual(4);
    expect(payload.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "i18n-key-parity", key: "common.close" }),
        expect.objectContaining({ category: "hardcoded-ui-text" }),
        expect.objectContaining({ category: "theme-hardcode" }),
        expect.objectContaining({ category: "z-index-hardcode" }),
      ]),
    );
  });

  it("fails only for requested categories when --fail-on is set", async () => {
    const root = await createTempProject();
    await writeFixtureProject(root);

    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "ux-hygiene-audit.mjs"),
        "--root",
        root,
        "--json",
        "--fail-on",
        "i18n-key-parity",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(false);
    expect(payload.failedCategories).toEqual(["i18n-key-parity"]);
  });

  it("does not report semantic z-index CSS variable classes", async () => {
    const root = await createTempProject();
    await writeFile(
      path.join(root, "src", "lib", "i18n", "zh-CN.ts"),
      [
        "export const zhCN = {",
        "  'common.close': '鍏抽棴',",
        "} as const;",
        "export type TranslationKey = keyof typeof zhCN;",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "src", "lib", "i18n", "en-US.ts"),
      [
        "import type { TranslationKey } from './zh-CN';",
        "export const enUS: Record<TranslationKey, string> = {",
        "  'common.close': 'Close',",
        "} as const;",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "src", "components", "Layered.tsx"),
      [
        "export function Layered() {",
        "  return <div className=\"fixed inset-0 z-[var(--z-dialog)]\" />;",
        "}",
        "",
      ].join("\n"),
    );

    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "ux-hygiene-audit.mjs"),
        "--root",
        root,
        "--json",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "z-index-hardcode" }),
      ]),
    );
  });

  it("does not report z-index fixtures inside test files", async () => {
    const root = await createTempProject();
    await writeFile(
      path.join(root, "src", "lib", "i18n", "zh-CN.ts"),
      [
        "export const zhCN = {",
        "  'common.close': '鍏抽棴',",
        "} as const;",
        "export type TranslationKey = keyof typeof zhCN;",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "src", "lib", "i18n", "en-US.ts"),
      [
        "import type { TranslationKey } from './zh-CN';",
        "export const enUS: Record<TranslationKey, string> = {",
        "  'common.close': 'Close',",
        "} as const;",
        "",
      ].join("\n"),
    );
    await mkdir(path.join(root, "src", "components", "__tests__"), { recursive: true });
    await writeFile(
      path.join(root, "src", "components", "__tests__", "Layered.test.tsx"),
      [
        "export function Fixture() {",
        "  return <div className=\"z-[999]\" style={{ zIndex: 999 }} />;",
        "}",
        "",
      ].join("\n"),
    );

    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "ux-hygiene-audit.mjs"),
        "--root",
        root,
        "--json",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "z-index-hardcode" }),
      ]),
    );
  });
});
