import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT_DIR = process.cwd();
const DEFAULT_ROOTS = [
  "C:/universe/MyStudy/atom/Categorized Papers",
  "C:/universe/MyStudy/atom/Professor",
  "C:/universe/Course/\u9009\u4fee/\u673a\u5668\u5b66\u4e60/courseML/\u8bfe\u4ef6",
  "C:/universe/Course",
];
const OUTPUT_DIR = path.join(ROOT_DIR, "output", "pdf-corpus-audit");
const REPORT_JSON = path.join(OUTPUT_DIR, "pdf-corpus-audit.json");
const REPORT_MD = path.join(OUTPUT_DIR, "pdf-corpus-audit.md");
const STANDARD_FONT_DATA_URL = `${path.join(ROOT_DIR, "node_modules", "pdfjs-dist", "standard_fonts").replaceAll(path.sep, "/")}/`;

function parseArgs(argv) {
  const options = {
    roots: [],
    limit: Number.POSITIVE_INFINITY,
    maxPagesPerPdf: 8,
    sampleEvery: 1,
    failOnErrors: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--root":
        options.roots.push(argv[index + 1]);
        index += 1;
        break;
      case "--limit":
        options.limit = Number(argv[index + 1] ?? options.limit);
        index += 1;
        break;
      case "--max-pages":
        options.maxPagesPerPdf = Math.max(1, Number(argv[index + 1] ?? options.maxPagesPerPdf));
        index += 1;
        break;
      case "--sample-every":
        options.sampleEvery = Math.max(1, Number(argv[index + 1] ?? options.sampleEvery));
        index += 1;
        break;
      case "--fail-on-errors":
        options.failOnErrors = true;
        break;
      default:
        break;
    }
  }

  if (options.roots.length === 0) {
    options.roots = DEFAULT_ROOTS;
  }

  return options;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectPdfFiles(root) {
  const files = [];

  async function walk(directory) {
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      console.warn(`[pdf-corpus-audit] skipped unreadable directory: ${directory} (${error instanceof Error ? error.message : String(error)})`);
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        const stat = await fs.stat(fullPath);
        files.push({
          root,
          path: fullPath,
          sizeBytes: stat.size,
        });
      }
    }
  }

  if (await pathExists(root)) {
    await walk(root);
  }

  return files;
}

function classifyPdfAudit(result) {
  if (result.error) {
    return "error";
  }
  if (result.pageCount === 0) {
    return "empty";
  }
  if (result.pagesAudited === 0) {
    return "unknown";
  }
  if (result.textLength === 0 || result.textItems === 0) {
    return "ocr-required";
  }
  const charsPerPage = result.textLength / Math.max(1, result.pagesAudited);
  if (charsPerPage < 80 || result.lowTextPages > Math.max(0, Math.floor(result.pagesAudited * 0.5))) {
    return "low-text";
  }
  return "born-digital";
}

function isToleratedPdfSourceError(error) {
  if (!error) {
    return false;
  }
  return /Invalid PDF structure/i.test(error) ||
    /PasswordException/i.test(error) ||
    /No password given/i.test(error);
}

function truncateSample(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

function buildPageSample(pageCount, maxPagesPerPdf) {
  if (pageCount <= 0) {
    return [];
  }
  if (pageCount <= maxPagesPerPdf) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const pages = new Set([1, pageCount]);
  const slots = Math.max(1, maxPagesPerPdf - pages.size);
  for (let index = 1; index <= slots; index += 1) {
    pages.add(Math.max(1, Math.min(pageCount, Math.round((index * pageCount) / (slots + 1)))));
  }
  return [...pages].sort((left, right) => left - right);
}

async function auditPdfFile(pdfjs, file, options) {
  const startedAt = Date.now();
  const result = {
    root: file.root,
    path: file.path,
    sizeBytes: file.sizeBytes,
    pageCount: 0,
    pagesAudited: 0,
    textItems: 0,
    textLength: 0,
    lowTextPages: 0,
    emptyTextPages: 0,
    sample: "",
    classification: "unknown",
    durationMs: 0,
    error: null,
  };

  try {
    const data = await fs.readFile(file.path);
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(data),
      disableWorker: true,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    });
    const document = await loadingTask.promise;
    result.pageCount = document.numPages;

    const pagesToAudit = buildPageSample(document.numPages, options.maxPagesPerPdf);

    for (const pageNumber of pagesToAudit) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const textItems = textContent.items.filter((item) => typeof item.str === "string");
      const pageText = textItems.map((item) => item.str).join(" ");
      const pageTextLength = pageText.replace(/\s+/g, "").length;
      result.pagesAudited += 1;
      result.textItems += textItems.length;
      result.textLength += pageTextLength;
      if (pageTextLength === 0) {
        result.emptyTextPages += 1;
      }
      if (pageTextLength < 80) {
        result.lowTextPages += 1;
      }
      if (!result.sample && pageTextLength > 0) {
        result.sample = truncateSample(pageText);
      }
      page.cleanup();
    }

    await document.destroy();
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  result.durationMs = Date.now() - startedAt;
  result.classification = classifyPdfAudit(result);
  return result;
}

function groupByClassification(results) {
  return results.reduce((groups, result) => {
    groups[result.classification] = (groups[result.classification] ?? 0) + 1;
    return groups;
  }, {});
}

function groupByRoot(results) {
  return results.reduce((groups, result) => {
    const root = result.root;
    groups[root] ??= { total: 0 };
    groups[root].total += 1;
    groups[root][result.classification] = (groups[root][result.classification] ?? 0) + 1;
    return groups;
  }, {});
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

async function writeReports(payload) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(REPORT_JSON, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const topProblems = payload.results
    .filter((result) => result.classification !== "born-digital")
    .slice(0, 30);
  const markdown = [
    "# PDF Corpus Audit",
    "",
    `Generated: ${payload.generatedAt}`,
    "",
    `Files audited: ${payload.summary.audited}/${payload.summary.discovered}`,
    `Total size audited: ${formatBytes(payload.summary.sizeBytes)}`,
    "",
    "## Classification",
    "",
    "| Class | Count |",
    "| --- | ---: |",
    ...Object.entries(payload.summary.classificationCounts)
      .sort((left, right) => right[1] - left[1])
      .map(([classification, count]) => `| ${classification} | ${count} |`),
    "",
    "## By Root",
    "",
    "| Root | Total | Born-digital | Low-text | OCR-required | Error |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(payload.summary.byRoot)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([root, counts]) => `| ${root.replace(/\|/g, "\\|")} | ${counts.total ?? 0} | ${counts["born-digital"] ?? 0} | ${counts["low-text"] ?? 0} | ${counts["ocr-required"] ?? 0} | ${counts.error ?? 0} |`),
    "",
    "## Non-Born-Digital / Error Samples",
    "",
    "| Class | Pages | Text chars | Size | Path | Error |",
    "| --- | ---: | ---: | ---: | --- | --- |",
    ...topProblems.map((result) => `| ${result.classification} | ${result.pageCount} | ${result.textLength} | ${formatBytes(result.sizeBytes)} | ${result.path.replace(/\|/g, "\\|")} | ${(result.error ?? "").replace(/\|/g, "\\|")} |`),
    "",
    "## Notes",
    "",
    "- This audit is read-only. It does not modify the source PDFs.",
    "- `born-digital` means sampled pages exposed enough extractable text for the kernel path.",
    "- `low-text` and `ocr-required` should be routed through OCR fallback or inspected manually.",
  ].join("\n");
  await fs.writeFile(REPORT_MD, `${markdown}\n`, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const collected = [];
  for (const root of options.roots) {
    const resolvedRoot = path.isAbsolute(root) ? root : path.resolve(ROOT_DIR, root);
    const files = await collectPdfFiles(resolvedRoot);
    collected.push(...files);
  }

  const unique = new Map();
  for (const file of collected) {
    unique.set(path.normalize(file.path).toLowerCase(), file);
  }
  const files = [...unique.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .filter((_, index) => index < options.limit);

  console.log(`[pdf-corpus-audit] discovered ${unique.size} PDFs, auditing ${files.length}`);
  const results = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    console.log(`[pdf-corpus-audit] ${index + 1}/${files.length} ${file.path}`);
    results.push(await auditPdfFile(pdfjs, file, options));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    roots: options.roots,
    options,
    summary: {
      discovered: unique.size,
      audited: results.length,
      sizeBytes: results.reduce((sum, result) => sum + result.sizeBytes, 0),
      classificationCounts: groupByClassification(results),
      byRoot: groupByRoot(results),
      errors: results.filter((result) => result.error).length,
      nonToleratedErrors: results.filter((result) => result.error && !isToleratedPdfSourceError(result.error)).length,
      lowTextOrOcr: results.filter((result) => result.classification === "low-text" || result.classification === "ocr-required").length,
    },
    results,
  };

  await writeReports(payload);
  console.log(`[pdf-corpus-audit] wrote ${pathToFileURL(REPORT_MD).href}`);
  if (options.failOnErrors && payload.summary.nonToleratedErrors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
