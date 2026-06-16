import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(ROOT_DIR, "output", "playwright");
const REPORT_JSON = path.join(OUTPUT_DIR, "pdf-browser-regression-segments.json");
const REPORT_MD = path.join(OUTPUT_DIR, "pdf-browser-regression-segments.md");
const REAL_PDF_SOURCE_CONFIGURED = Boolean(
  process.env.LATTICE_BROWSER_REGRESSION_REAL_PDF_PATH?.trim() ||
  process.env.LATTICE_BROWSER_REGRESSION_REAL_PDF_URL?.trim(),
);

const PDF_SEGMENTS = [
  {
    name: "pdfjs-probe",
    steps: ["pdfjs-probe"],
    description: "Minimal browser PDF.js getDocument probe outside the highlighter.",
  },
  {
    name: "smoke",
    steps: ["smoke"],
    description: "PDF annotations workspace boots and renders the first page.",
  },
  {
    name: "text-layer",
    steps: ["text-layer"],
    description: "Rendered PDF pages expose selectable text-layer content.",
  },
  {
    name: "layout",
    steps: ["layout"],
    description: "Split PDF panes keep stable viewport and page bounds.",
  },
  {
    name: "selection-copy",
    steps: ["selection-copy"],
    description: "PDF selection copy path uses reconciled page text.",
  },
  {
    name: "highlight-save-restore",
    steps: ["highlight-save-restore"],
    description: "PDF highlights persist and restore stable page-space anchors.",
  },
  {
    name: "real-paper-interactions",
    steps: ["real-paper-interactions"],
    description: "Real two-column Rydberg paper copy/highlight and stored annotation interactions.",
    requiresRealPdf: true,
  },
  {
    name: "position-restore",
    steps: ["position-restore"],
    description: "PDF panes remember the user's reading position across reloads.",
  },
  {
    name: "pdf-render-core",
    steps: ["smoke", "text-layer", "layout"],
    description: "PDF pane boot, paper-like text layer probes, and split layout bounds.",
  },
  {
    name: "pdf-interaction-core",
    steps: ["sidebar", "zoom-left", "zoom-right"],
    description: "Annotation sidebar width and pane-scoped keyboard zoom.",
  },
  {
    name: "pdf-state-core",
    steps: ["scroll", "position-restore", "file-switch", "file-restore-zoom"],
    description: "Deep-page progress, reload position restore, right-pane file switching, and zoom restore.",
  },
];

function parseArgs(argv) {
  const options = {
    segment: null,
    list: false,
    continueOnFailure: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--segment":
        options.segment = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--list":
        options.list = true;
        break;
      case "--continue-on-failure":
        options.continueOnFailure = true;
        break;
      default:
        break;
    }
  }

  return options;
}

function formatDuration(ms) {
  return `${Math.round(ms / 1000)}s`;
}

function runSegment(segment) {
  const startedAt = Date.now();
  const childEnv = {
    ...process.env,
    LATTICE_BROWSER_REGRESSION_FLOW: "pdf",
    LATTICE_BROWSER_REGRESSION_PDF_STEP: segment.steps.join(","),
    LATTICE_BROWSER_REGRESSION_PDF_FLOW_TIMEOUT_MS:
      process.env.LATTICE_BROWSER_REGRESSION_PDF_FLOW_TIMEOUT_MS ?? "240000",
    LATTICE_BROWSER_REGRESSION_PDF_READY_TIMEOUT_MS:
      process.env.LATTICE_BROWSER_REGRESSION_PDF_READY_TIMEOUT_MS ?? "90000",
    LATTICE_BROWSER_REGRESSION_PDF_ASSERT_TIMEOUT_MS:
      process.env.LATTICE_BROWSER_REGRESSION_PDF_ASSERT_TIMEOUT_MS ?? "90000",
    LATTICE_BROWSER_REGRESSION_PDF_RENDER_READY_TIMEOUT_MS:
      process.env.LATTICE_BROWSER_REGRESSION_PDF_RENDER_READY_TIMEOUT_MS ?? "90000",
  };

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/browser-regression.mjs"], {
      cwd: ROOT_DIR,
      stdio: "inherit",
      env: childEnv,
      shell: false,
    });

    child.on("exit", (code) => {
      resolve({
        name: segment.name,
        description: segment.description,
        steps: segment.steps,
        status: code === 0 ? "passed" : "failed",
        exitCode: code,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function writeReports(results) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    command: "npm run test:browser-regression:pdf",
    results,
    passed: results.every((result) => result.status === "passed"),
  };

  const markdown = [
    "# PDF Browser Regression Segments",
    "",
    `Generated: ${payload.generatedAt}`,
    "",
    "| Segment | Steps | Status | Duration |",
    "| --- | --- | --- | --- |",
    ...results.map((result) => `| ${result.name} | ${result.steps.join(", ")} | ${result.status} | ${formatDuration(result.durationMs)} |`),
    "",
    "## Notes",
    "",
    "- Each segment runs `scripts/browser-regression.mjs` in a fresh browser/dev-server process.",
    "- Re-run a single segment with `npm run test:browser-regression:pdf -- --segment <name>`.",
  ].join("\n");

  await fs.writeFile(REPORT_JSON, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(REPORT_MD, `${markdown}\n`, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.list) {
    for (const segment of PDF_SEGMENTS) {
      console.log(`${segment.name}: ${segment.steps.join(", ")} - ${segment.description}`);
    }
    return;
  }

  const selectedSegments = options.segment
    ? PDF_SEGMENTS.filter((segment) => segment.name === options.segment)
    : PDF_SEGMENTS.filter((segment) => !segment.requiresRealPdf || REAL_PDF_SOURCE_CONFIGURED);

  if (selectedSegments.length === 0) {
    throw new Error(`Unknown PDF browser regression segment "${options.segment}". Expected one of: ${PDF_SEGMENTS.map((segment) => segment.name).join(", ")}.`);
  }
  if (selectedSegments.some((segment) => segment.requiresRealPdf) && !REAL_PDF_SOURCE_CONFIGURED) {
    throw new Error(
      "Segment real-paper-interactions requires LATTICE_BROWSER_REGRESSION_REAL_PDF_PATH or LATTICE_BROWSER_REGRESSION_REAL_PDF_URL.",
    );
  }
  if (!options.segment && PDF_SEGMENTS.some((segment) => segment.requiresRealPdf) && !REAL_PDF_SOURCE_CONFIGURED) {
    console.log("[pdf-browser-regression] skip real-paper-interactions: set LATTICE_BROWSER_REGRESSION_REAL_PDF_PATH or LATTICE_BROWSER_REGRESSION_REAL_PDF_URL to include it.");
  }

  const results = [];
  for (const segment of selectedSegments) {
    console.log(`[pdf-browser-regression] start segment: ${segment.name} (${segment.steps.join(", ")})`);
    const result = await runSegment(segment);
    results.push(result);
    console.log(`[pdf-browser-regression] ${result.status} segment: ${segment.name} in ${formatDuration(result.durationMs)}`);
    if (result.status !== "passed" && !options.continueOnFailure) {
      break;
    }
  }

  await writeReports(results);

  const failed = results.filter((result) => result.status !== "passed");
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
