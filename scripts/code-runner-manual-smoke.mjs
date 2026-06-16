#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STRICT = process.argv.includes("--strict");

const commandChecks = [
  {
    id: "python",
    label: "Python runner",
    commands: [
      ["python", ["--version"]],
      ["py", ["-3", "--version"]],
      ["python3", ["--version"]],
    ],
    required: true,
  },
  {
    id: "node",
    label: "JavaScript / TypeScript runner",
    commands: [["node", ["--version"]]],
    required: true,
  },
  {
    id: "gcc",
    label: "C runner",
    commands: [["gcc", ["--version"]]],
    required: false,
  },
  {
    id: "g++",
    label: "C++ runner",
    commands: [["g++", ["--version"]]],
    required: false,
  },
];

const manualSections = [
  {
    title: "Code editor baseline",
    steps: [
      "Open a .py, .ts, .json, .md, .c, and .cpp file.",
      "Confirm line numbers, current line, selection, bracket matching, folding, and syntax highlighting are visible.",
      "Use Search, Go to Line, and Outline from the command bar.",
      "Click at least one Outline symbol and confirm the editor scrolls to that line.",
    ],
    expected: [
      "The editor remains responsive and does not shift layout when Outline opens or closes.",
      "Search, Go to Line, and Outline are scoped to the active pane and active tab.",
    ],
  },
  {
    title: "Python file runner",
    steps: [
      "Create or open a saved .py file that prints stdout and then run it.",
      "Add a second run that raises an exception on a known line.",
      "Click the Problems entry or clickable stderr location.",
      "Run again, then Stop while a long-running script is active.",
    ],
    expected: [
      "Run / Stop / Rerun states move through idle, running, success, error, or stopped clearly.",
      "stdout and stderr appear in Run, structured failures appear in Problems, and line navigation highlights the target line.",
      "If Python is unavailable, the Problems panel shows actionable preflight diagnostics instead of failing silently.",
    ],
  },
  {
    title: "C / C++ compiled runner",
    steps: [
      "Open a saved .c file in a workspace path that contains spaces and run it.",
      "Open a saved .cpp file and run it.",
      "Introduce a compile error on a known line and run again.",
      "Stop a long-running compiled program.",
    ],
    expected: [
      "Compile and run phases are represented as one clear execution session.",
      "Windows paths with spaces compile and execute correctly.",
      "GCC, Clang, or MSVC-style error locations are clickable when emitted.",
      "If no compiler is available, the user sees a clear runner health or preflight problem.",
    ],
  },
  {
    title: "JavaScript / TypeScript runner",
    steps: [
      "Open a saved .js file and run it with Node.",
      "Open a saved .ts file that only uses Node-supported transformable TypeScript syntax and run it.",
      "Introduce a thrown error and verify the stack trace location is clickable.",
    ],
    expected: [
      ".js runs through Node and .ts uses Node transform-types when available.",
      "Node stack frame locations populate Problems or clickable stderr lines.",
      "Unsupported TS syntax fails with a visible diagnostic rather than a blank output panel.",
    ],
  },
  {
    title: "Notebook runner",
    steps: [
      "Open public/test-notebook.ipynb or an equivalent local Python notebook.",
      "Run a Markdown cell and confirm it remains readable.",
      "Run a Python code cell that defines a variable, then run a later cell that uses it.",
      "Run a failing cell and click the reported problem.",
      "Restart the kernel/session and run all cells again.",
    ],
    expected: [
      "The notebook does not start a noisy session before the user runs code.",
      "Python cells share the expected local session in desktop mode.",
      "Outputs, errors, Markdown cells, and Problems remain visually separated and recover after restart.",
    ],
  },
];

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 10_000,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || "available";
}

function checkCommandGroup(group) {
  for (const [command, args] of group.commands) {
    const output = runCommand(command, args);
    if (output) {
      return { ok: true, command: `${command} ${args.join(" ")}`.trim(), output };
    }
  }

  return { ok: false, command: group.commands.map(([command]) => command).join(" / "), output: null };
}

function checkNotebookFixture() {
  const fixturePath = join(ROOT, "public", "test-notebook.ipynb");
  if (!existsSync(fixturePath)) {
    return { ok: false, message: "public/test-notebook.ipynb is missing." };
  }

  try {
    const notebook = JSON.parse(readFileSync(fixturePath, "utf8"));
    const codeCells = Array.isArray(notebook.cells)
      ? notebook.cells.filter((cell) => cell.cell_type === "code").length
      : 0;
    return {
      ok: codeCells > 0,
      message: codeCells > 0
        ? `public/test-notebook.ipynb is valid JSON with ${codeCells} code cell(s).`
        : "public/test-notebook.ipynb has no code cells.",
    };
  } catch (error) {
    return { ok: false, message: `public/test-notebook.ipynb is not valid JSON: ${error.message}` };
  }
}

console.log("Lattice code / runner / notebook manual smoke checklist");
console.log("=".repeat(56));
console.log("");

console.log("Toolchain visibility");
console.log("-".repeat(24));
const toolResults = commandChecks.map((group) => ({ group, result: checkCommandGroup(group) }));
for (const { group, result } of toolResults) {
  const status = result.ok ? "OK" : group.required ? "MISSING" : "OPTIONAL MISSING";
  console.log(`${status}: ${group.label}`);
  console.log(`  command: ${result.command}`);
  if (result.output) {
    console.log(`  output: ${result.output}`);
  }
}

const fixture = checkNotebookFixture();
console.log(`${fixture.ok ? "OK" : "MISSING"}: Notebook fixture`);
console.log(`  ${fixture.message}`);
console.log("");

console.log("Manual smoke flow");
console.log("-".repeat(24));
manualSections.forEach((section, index) => {
  console.log(`${index + 1}. ${section.title}`);
  console.log("   Steps:");
  section.steps.forEach((step) => console.log(`   - ${step}`));
  console.log("   Expected:");
  section.expected.forEach((expectation) => console.log(`   - ${expectation}`));
  console.log("");
});

const missingRequired = toolResults.some(({ group, result }) => group.required && !result.ok);
const fixtureMissing = !fixture.ok;
if (STRICT && (missingRequired || fixtureMissing)) {
  process.exitCode = 1;
}
