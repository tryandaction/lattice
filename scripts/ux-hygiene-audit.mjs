import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "out", "target", "coverage", ".git"]);

function parseArgs(argv) {
  const options = {
    root: DEFAULT_ROOT,
    json: false,
    failOn: new Set(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = path.resolve(argv[index + 1] ?? DEFAULT_ROOT);
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--fail-on") {
      const raw = argv[index + 1] ?? "";
      raw.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => options.failOn.add(item));
      index += 1;
    }
  }

  return options;
}

async function collectFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractTranslationKeys(content, exportName) {
  const exportIndex = content.indexOf(`export const ${exportName}`);
  if (exportIndex < 0) {
    return new Set();
  }

  const keys = new Set();
  const keyPattern = /['"]([a-zA-Z0-9_.:-]+)['"]\s*:/g;
  let match;
  while ((match = keyPattern.exec(content.slice(exportIndex))) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

async function readOptional(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function relative(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function addIssue(issues, root, issue) {
  issues.push({
    ...issue,
    file: issue.file ? relative(root, issue.file) : undefined,
  });
}

function isTestFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.includes("/__tests__/") || /\.test\.[cm]?[jt]sx?$/.test(normalized);
}

function auditI18nKeyParity(root, issues, zhContent, enContent) {
  const zhKeys = extractTranslationKeys(zhContent ?? "", "zhCN");
  const enKeys = extractTranslationKeys(enContent ?? "", "enUS");

  for (const key of zhKeys) {
    if (!enKeys.has(key)) {
      addIssue(issues, root, {
        category: "i18n-key-parity",
        severity: "error",
        key,
        file: path.join(root, "src", "lib", "i18n", "en-US.ts"),
        message: `Missing en-US translation for ${key}`,
      });
    }
  }

  for (const key of enKeys) {
    if (!zhKeys.has(key)) {
      addIssue(issues, root, {
        category: "i18n-key-parity",
        severity: "error",
        key,
        file: path.join(root, "src", "lib", "i18n", "zh-CN.ts"),
        message: `Missing zh-CN translation for ${key}`,
      });
    }
  }
}

function auditSourceFile(root, filePath, content, issues) {
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/[\u4e00-\u9fff]/.test(line) && /(<[^>]+>|title=|aria-label=|placeholder=|content:\s*["'])/.test(line) && !/t\(|translate\(/.test(line)) {
      addIssue(issues, root, {
        category: "hardcoded-ui-text",
        severity: "warning",
        file: filePath,
        line: lineNumber,
        message: "Potential hardcoded Chinese UI text",
      });
    }

    if (/(bg-white|text-gray-\d{3}|border-gray-\d{3}|#fff\b|#ffffff\b|rgba\(255\s*,\s*255\s*,\s*255)/i.test(line)) {
      addIssue(issues, root, {
        category: "theme-hardcode",
        severity: "warning",
        file: filePath,
        line: lineNumber,
        message: "Potential light-theme hardcoded color",
      });
    }

    if (!isTestFile(filePath) && /(zIndex\s*:\s*\d{2,}|z-\[\d{2,}\])/.test(line) && !/z-\[var\(--z-[a-z-]+\)\]/.test(line)) {
      addIssue(issues, root, {
        category: "z-index-hardcode",
        severity: "warning",
        file: filePath,
        line: lineNumber,
        message: "Potential hardcoded z-index; prefer a semantic layer token",
      });
    }
  });
}

async function runAudit(options) {
  const root = options.root;
  const issues = [];
  const zhPath = path.join(root, "src", "lib", "i18n", "zh-CN.ts");
  const enPath = path.join(root, "src", "lib", "i18n", "en-US.ts");

  auditI18nKeyParity(
    root,
    issues,
    await readOptional(zhPath),
    await readOptional(enPath),
  );

  const srcRoot = path.join(root, "src");
  let sourceFiles = [];
  try {
    sourceFiles = await collectFiles(srcRoot);
  } catch {
    sourceFiles = [];
  }

  for (const filePath of sourceFiles) {
    const content = await fs.readFile(filePath, "utf8");
    auditSourceFile(root, filePath, content, issues);
  }

  const failedCategories = Array.from(options.failOn).filter((category) =>
    issues.some((issue) => issue.category === category),
  );

  return {
    ok: failedCategories.length === 0,
    failedCategories,
    summary: {
      totalIssues: issues.length,
      byCategory: issues.reduce((acc, issue) => {
        acc[issue.category] = (acc[issue.category] ?? 0) + 1;
        return acc;
      }, {}),
      checkedFiles: sourceFiles.length,
    },
    issues,
  };
}

function printTextReport(payload) {
  console.log(`UX hygiene audit: ${payload.summary.totalIssues} issue(s)`);
  for (const issue of payload.issues) {
    const location = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : "workspace";
    console.log(`- [${issue.category}] ${location}: ${issue.message}`);
  }
}

const options = parseArgs(process.argv.slice(2));
runAudit(options)
  .then((payload) => {
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printTextReport(payload);
    }
    if (!payload.ok) {
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
