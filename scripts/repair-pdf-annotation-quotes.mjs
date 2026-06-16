import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT_DIR = process.cwd();
const DEFAULT_WORKSPACE_ROOT = "C:/universe/MyStudy/atom";
const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, "output", "pdf-annotation-repair");

function parseArgs(argv) {
  const options = {
    annotationFiles: [],
    workspaceRoot: DEFAULT_WORKSPACE_ROOT,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--annotation-file":
        options.annotationFiles.push(argv[index + 1]);
        index += 1;
        break;
      case "--workspace-root":
        options.workspaceRoot = argv[index + 1] ?? options.workspaceRoot;
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        break;
    }
  }

  return options;
}

function normalizeText(text) {
  return (text ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(text) {
  return normalizeText(text).replace(/\s+/g, "");
}

function repairReadableArtifacts(text) {
  return normalizeText(text)
    .replace(/\u00ad/g, "")
    .replace(/([\p{L}])-\s+([\p{Ll}])/gu, "$1$2")
    .replace(/\b(infor|re|inter|signifi|inher|dy|reso|mag|ra|be|block|pre)-\s*([a-z])/gi, "$1$2")
    .replace(/([a-z])(\d+\s*(?:Hz|kHz|MHz|GHz|THz)\b)/g, "$1 $2")
    .replace(/(\d)([A-Za-z]{2,})/g, "$1 $2")
    .replace(/\b(the)(collectively)\b/gi, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function isWordCharacter(character) {
  return Boolean(character) && /[\p{L}\p{N}]/u.test(character);
}

function hasSuspiciousBoundary({ prefix = "", exact = "", suffix = "" }) {
  const normalizedExact = normalizeText(exact);
  if (!normalizedExact) {
    return false;
  }

  const normalizedPrefix = normalizeText(prefix);
  const normalizedSuffix = normalizeText(suffix);
  return (
    (isWordCharacter(normalizedPrefix.slice(-1)) && isWordCharacter(normalizedExact.slice(0, 1))) ||
    (isWordCharacter(normalizedExact.slice(-1)) && isWordCharacter(normalizedSuffix.slice(0, 1)))
  );
}

function hasControlArtifacts(text) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text ?? "");
}

function hasReadableArtifacts(text) {
  const normalized = normalizeText(text);
  return (
    /[\p{L}]-\s+[\p{Ll}]/u.test(normalized) ||
    /[a-z]\d+\s*(?:Hz|kHz|MHz|GHz|THz)\b/.test(normalized) ||
    /\d[A-Za-z]{2,}/.test(normalized) ||
    /\bthecollectively\b/i.test(normalized) ||
    /\b(?:infor|re|inter|signifi|inher|dy|reso|mag|ra|be|block|pre)-\s*[a-z]/i.test(normalized) ||
    repairReadableArtifacts(normalized) !== normalized
  );
}

function isSuspiciousQuote(quote) {
  if (!quote?.exact) {
    return false;
  }

  const normalizedExact = normalizeText(quote.exact);
  return (
    hasControlArtifacts(quote.exact) ||
    hasReadableArtifacts(quote.exact) ||
    hasSuspiciousBoundary(quote) ||
    /^[0-9A-Za-z]$/.test(normalizedExact)
  );
}

function buildCompactMap(text) {
  const normalized = normalizeText(text);
  const compactToNormalized = [];
  let compact = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (/\s/.test(character)) {
      continue;
    }
    compactToNormalized[compact.length] = index;
    compact += character;
  }
  compactToNormalized[compact.length] = normalized.length;

  return { normalized, compact, compactToNormalized };
}

function findAllOccurrences(haystack, needle) {
  if (!needle) {
    return [];
  }

  const positions = [];
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    positions.push(index);
    index = haystack.indexOf(needle, index + 1);
  }
  return positions;
}

function expandToWordBoundaries(text, start, end) {
  let nextStart = Math.max(0, Math.min(text.length, start));
  let nextEnd = Math.max(nextStart, Math.min(text.length, end));

  while (nextStart > 0 && isWordCharacter(text[nextStart - 1]) && isWordCharacter(text[nextStart])) {
    nextStart -= 1;
  }
  while (nextEnd < text.length && isWordCharacter(text[nextEnd - 1]) && isWordCharacter(text[nextEnd])) {
    nextEnd += 1;
  }

  return { start: nextStart, end: nextEnd };
}

function maybeRestoreLeadingContextWord(prefix, repaired) {
  const normalizedPrefix = normalizeText(prefix);
  const normalizedRepaired = normalizeText(repaired);
  if (!normalizedPrefix || !normalizedRepaired) {
    return normalizedRepaired;
  }

  const prefixTokens = normalizedPrefix.split(/\s+/).filter(Boolean);
  if (prefixTokens.length < 2) {
    return normalizedRepaired;
  }

  const partialToken = prefixTokens.at(-1) ?? "";
  const contextToken = prefixTokens.at(-2) ?? "";
  const repairedFirstWord = normalizedRepaired.split(/\s+/)[0] ?? "";
  if (
    partialToken &&
    repairedFirstWord.length > partialToken.length &&
    repairedFirstWord.toLowerCase().startsWith(partialToken.toLowerCase()) &&
    /^(?:a|an|the|of|to|in|on|for|by|at)$/i.test(contextToken)
  ) {
    return `${contextToken} ${normalizedRepaired}`;
  }

  return normalizedRepaired;
}

function findRepairedQuote(pageText, quote) {
  const map = buildCompactMap(pageText);
  const exactCompact = compactText(quote.exact);
  const prefixCompact = compactText(quote.prefix);
  const suffixCompact = compactText(quote.suffix);
  const prefixCandidates = [32, 24, 20, 16, 12, 8]
    .map((length) => prefixCompact.slice(-Math.min(length, prefixCompact.length)))
    .filter(Boolean);
  const suffixCandidates = [32, 24, 20, 16, 12, 8]
    .map((length) => suffixCompact.slice(0, Math.min(length, suffixCompact.length)))
    .filter(Boolean);

  for (const prefixNeedle of prefixCandidates) {
    for (const suffixNeedle of suffixCandidates) {
      for (const prefixIndex of findAllOccurrences(map.compact, prefixNeedle)) {
        const searchStart = prefixIndex + prefixNeedle.length;
        const suffixIndex = map.compact.indexOf(suffixNeedle, searchStart);
        if (suffixIndex <= searchStart) {
          continue;
        }

        const normalizedStart = map.compactToNormalized[searchStart] ?? 0;
        const normalizedEnd = map.compactToNormalized[suffixIndex] ?? map.normalized.length;
        const expanded = expandToWordBoundaries(map.normalized, normalizedStart, normalizedEnd);
        const repaired = maybeRestoreLeadingContextWord(
          quote.prefix,
          map.normalized.slice(expanded.start, expanded.end).trim(),
        );
        if (!repaired) {
          continue;
        }
        const repairedContext = {
          exact: repaired,
          prefix: map.normalized.slice(Math.max(0, expanded.start - 32), expanded.start),
          suffix: map.normalized.slice(expanded.end, expanded.end + 32),
        };
        const repairedCompactLength = compactText(repaired).length;
        const originalCompactLength = exactCompact.length;
        if (
          isSuspiciousQuote(repairedContext) &&
          repairedCompactLength <= originalCompactLength + 2
        ) {
          continue;
        }
        if (exactCompact && repairedCompactLength < Math.max(6, Math.ceil(exactCompact.length * 0.5))) {
          continue;
        }

        const readableRepaired = repairReadableArtifacts(repaired);
        return {
          exact: readableRepaired,
          prefix: repairedContext.prefix,
          suffix: repairedContext.suffix,
        };
      }
    }
  }

  return null;
}

function findArtifactOnlyRepair(quote) {
  const repairedExact = repairReadableArtifacts(quote.exact);
  const normalizedExact = normalizeText(quote.exact);
  if (!repairedExact || repairedExact === normalizedExact) {
    return null;
  }

  const originalCompactLength = compactText(normalizedExact).length;
  const repairedCompactLength = compactText(repairedExact).length;
  if (originalCompactLength > 0 && repairedCompactLength < Math.max(6, Math.floor(originalCompactLength * 0.75))) {
    return null;
  }

  return {
    exact: repairedExact,
    prefix: normalizeText(quote.prefix),
    suffix: normalizeText(quote.suffix),
  };
}

async function collectAnnotationFiles(annotationFiles) {
  if (annotationFiles.length > 0) {
    return annotationFiles;
  }

  const annotationDir = path.join(DEFAULT_WORKSPACE_ROOT, ".lattice", "annotations");
  const entries = await fs.readdir(annotationDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(annotationDir, entry.name));
}

async function getPdfPathForAnnotation(annotationFile, workspaceRoot, fileId) {
  const manifestPath = path.join(workspaceRoot, ".lattice", "items", fileId, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const directPath = path.join(workspaceRoot, manifest.pdfPath);
  try {
    await fs.access(directPath);
    return directPath;
  } catch {}

  const workspaceLeaf = path.basename(workspaceRoot).replace(/\\/g, "/");
  const normalizedPdfPath = String(manifest.pdfPath ?? "").replace(/\\/g, "/");
  if (normalizedPdfPath.startsWith(`${workspaceLeaf}/`)) {
    const trimmedPath = normalizedPdfPath.slice(workspaceLeaf.length + 1);
    const nestedPath = path.join(workspaceRoot, trimmedPath);
    try {
      await fs.access(nestedPath);
      return nestedPath;
    } catch {}
  }

  const parentPath = path.join(path.dirname(workspaceRoot), manifest.pdfPath);
  await fs.access(parentPath);
  return parentPath;
}

async function getAnnotationIndexPath(annotationFile, workspaceRoot, fileId) {
  const manifestPath = path.join(workspaceRoot, ".lattice", "items", fileId, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  return path.join(workspaceRoot, manifest.annotationIndexPath);
}

function syncAnnotationsMarkdown(content, changes) {
  if (!changes.length) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  for (const change of changes) {
    const annotationLinkNeedle = `- Annotation Link: [${change.id}]`;
    const annotationLineIndex = lines.findIndex((line) => line.includes(annotationLinkNeedle));
    if (annotationLineIndex < 0) {
      continue;
    }

    let quoteLineIndex = -1;
    for (let index = annotationLineIndex + 1; index < Math.min(lines.length, annotationLineIndex + 6); index += 1) {
      if (lines[index].startsWith("- Quote: ")) {
        quoteLineIndex = index;
        break;
      }
      if (lines[index].startsWith("### ") || lines[index].startsWith("## ")) {
        break;
      }
    }

    const nextQuoteLine = `- Quote: ${change.after}`;
    if (quoteLineIndex >= 0) {
      lines[quoteLineIndex] = nextQuoteLine;
    } else {
      lines.splice(annotationLineIndex + 1, 0, nextQuoteLine);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function loadPageText(pdfjs, pdfPath, pageNumber, cache) {
  const cacheKey = `${pdfPath}::${pageNumber}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const data = new Uint8Array(await fs.readFile(pdfPath));
  const document = await pdfjs.getDocument({
    data,
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
  const page = await document.getPage(pageNumber);
  const textContent = await page.getTextContent({
    includeMarkedContent: false,
    disableNormalization: false,
    disableCombineTextItems: true,
  });
  const text = textContent.items
    .filter((item) => typeof item.str === "string")
    .map((item) => item.str)
    .join(" ");
  await document.destroy();

  cache.set(cacheKey, text);
  return text;
}

async function repairAnnotationFile(pdfjs, annotationFile, workspaceRoot, pageTextCache) {
  const raw = await fs.readFile(annotationFile, "utf8");
  const data = JSON.parse(raw);
  let pdfPath;
  let annotationIndexPath;
  try {
    pdfPath = await getPdfPathForAnnotation(annotationFile, workspaceRoot, data.fileId);
    annotationIndexPath = await getAnnotationIndexPath(annotationFile, workspaceRoot, data.fileId);
  } catch (error) {
    return {
      annotationFile,
      pdfPath: null,
      annotationIndexPaths: [],
      changed: false,
      skipped: true,
      skipReason: error instanceof Error ? error.message : String(error),
      changes: [],
      nextContent: raw,
    };
  }
  const siblingAnnotationIndexPath = path.join(
    workspaceRoot,
    ".lattice",
    "items",
    data.fileId,
    "_annotations.md",
  );
  const changes = [];

  for (const annotation of data.annotations ?? []) {
    if (annotation?.target?.type !== "pdf" || !annotation.target.textQuote) {
      continue;
    }
    if (!isSuspiciousQuote(annotation.target.textQuote)) {
      continue;
    }

    const pageText = await loadPageText(pdfjs, pdfPath, annotation.target.page, pageTextCache);
    const repaired = findRepairedQuote(pageText, annotation.target.textQuote)
      ?? findArtifactOnlyRepair(annotation.target.textQuote);
    if (!repaired) {
      continue;
    }
    if (
      normalizeText(repaired.exact) === normalizeText(annotation.target.textQuote.exact) &&
      normalizeText(repaired.prefix) === normalizeText(annotation.target.textQuote.prefix) &&
      normalizeText(repaired.suffix) === normalizeText(annotation.target.textQuote.suffix)
    ) {
      continue;
    }

    changes.push({
      id: annotation.id,
      page: annotation.target.page,
      before: annotation.target.textQuote.exact,
      after: repaired.exact,
      beforePrefix: annotation.target.textQuote.prefix,
      afterPrefix: repaired.prefix,
      beforeSuffix: annotation.target.textQuote.suffix,
      afterSuffix: repaired.suffix,
      exactChanged: normalizeText(repaired.exact) !== normalizeText(annotation.target.textQuote.exact),
      contextChanged: (
        normalizeText(repaired.prefix) !== normalizeText(annotation.target.textQuote.prefix) ||
        normalizeText(repaired.suffix) !== normalizeText(annotation.target.textQuote.suffix)
      ),
    });

    annotation.target.textQuote = {
      ...annotation.target.textQuote,
      exact: repaired.exact,
      prefix: repaired.prefix,
      suffix: repaired.suffix,
      source: "pdfjs-text-model",
    };
    if (typeof annotation.content === "string") {
      annotation.content = repaired.exact;
    }
  }

  return {
    annotationFile,
    pdfPath,
    annotationIndexPaths: [annotationIndexPath, siblingAnnotationIndexPath],
    changed: changes.length > 0,
    changes,
    nextContent: JSON.stringify(data, null, 2) + "\n",
  };
}

async function writeReport(report) {
  await fs.mkdir(DEFAULT_OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(DEFAULT_OUTPUT_DIR, "repair-pdf-annotation-quotes.json");
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return outputPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const annotationFiles = await collectAnnotationFiles(options.annotationFiles);
  const pageTextCache = new Map();
  const results = [];

  for (const annotationFile of annotationFiles) {
    const result = await repairAnnotationFile(pdfjs, annotationFile, options.workspaceRoot, pageTextCache);
    results.push(result);
    if (result.changed && !options.dryRun) {
      await fs.writeFile(annotationFile, result.nextContent, "utf8");
      for (const annotationIndexPath of [...new Set(result.annotationIndexPaths)]) {
        try {
          const markdown = await fs.readFile(annotationIndexPath, "utf8");
          const nextMarkdown = syncAnnotationsMarkdown(markdown, result.changes);
          if (nextMarkdown !== markdown) {
            await fs.writeFile(annotationIndexPath, nextMarkdown, "utf8");
          }
        } catch {
          // Keep JSON repair authoritative even if a markdown summary is missing.
        }
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    workspaceRoot: options.workspaceRoot,
    filesScanned: annotationFiles.length,
    filesChanged: results.filter((result) => result.changed).length,
    filesSkipped: results.filter((result) => result.skipped).length,
    skipped: results
      .filter((result) => result.skipped)
      .map((result) => ({
        annotationFile: result.annotationFile,
        reason: result.skipReason,
      })),
    changes: results.flatMap((result) => result.changes.map((change) => ({
      annotationFile: result.annotationFile,
      pdfPath: result.pdfPath,
      ...change,
    }))),
  };

  const reportPath = await writeReport(report);
  console.log(JSON.stringify({ reportPath, ...report }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
