import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const KEY_DOCS = [
  "README.md",
  "AI_DEVELOPMENT_GUIDE.md",
  "docs/ARCHITECTURE.md",
  "docs/USER_GUIDE.md",
  "docs/DESKTOP_FEATURES.md",
  "docs/MANUAL_RELEASE_GUIDE.md",
  "docs/RELEASE_NOTES.md",
  "docs/roadmap.md",
  "docs/guides/quick-start.md",
  "docs/guides/installation.md",
  "docs/guides/desktop-app.md",
  "docs/guides/live-preview-guide.md",
  "docs/guides/github-deploy.md",
];

const FORBIDDEN_PATTERNS = [
  { pattern: /docs\/fixes\//, reason: "legacy fixes docs reference" },
  { pattern: /docs\/refactors\//, reason: "legacy refactor docs reference" },
  { pattern: /MARKDOWN_FIX_SUMMARY/i, reason: "legacy root markdown summary reference" },
  { pattern: /WEEK2_REFACTOR_COMPLETE/i, reason: "legacy root refactor summary reference" },
  { pattern: /DESKTOP_APP\.md/i, reason: "obsolete desktop app doc reference" },
  { pattern: /\?{4,}/, reason: "garbled question-mark sequence" },
];

async function collectMarkdownFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const docsRoot = path.join(ROOT_DIR, "docs");
  const markdownFiles = await collectMarkdownFiles(docsRoot);
  const requiredFiles = KEY_DOCS.map((relativePath) => path.join(ROOT_DIR, relativePath));
  const filesToCheck = Array.from(new Set([...requiredFiles, ...markdownFiles])).sort();
  const issues = [];

  for (const filePath of filesToCheck) {
    const relativePath = path.relative(ROOT_DIR, filePath).replace(/\\/g, "/");
    let content;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      issues.push(`${relativePath}: missing required doc`);
      continue;
    }

    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        issues.push(`${relativePath}: ${reason}`);
      }
    }
  }

  if (issues.length > 0) {
    console.error("Documentation hygiene check failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        checkedFiles: filesToCheck.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
