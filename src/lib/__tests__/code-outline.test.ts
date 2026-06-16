import { describe, expect, it } from "vitest";
import { extractCodeOutlineSymbols } from "../code-outline";

describe("extractCodeOutlineSymbols", () => {
  it("extracts markdown headings and ignores fenced code", () => {
    const symbols = extractCodeOutlineSymbols(
      [
        "# Title",
        "",
        "```",
        "# Not a heading",
        "```",
        "## Section",
      ].join("\n"),
      "markdown",
    );

    expect(symbols.map(({ name, kind, line, level }) => ({ name, kind, line, level }))).toEqual([
      { name: "Title", kind: "heading", line: 1, level: 1 },
      { name: "Section", kind: "heading", line: 6, level: 2 },
    ]);
  });

  it("extracts python classes, functions, async functions, and methods", () => {
    const symbols = extractCodeOutlineSymbols(
      [
        "class App:",
        "    def run(self):",
        "        pass",
        "",
        "async def main():",
        "    pass",
      ].join("\n"),
      "python",
    );

    expect(symbols.map(({ name, kind, line, level }) => ({ name, kind, line, level }))).toEqual([
      { name: "App", kind: "class", line: 1, level: 1 },
      { name: "run", kind: "method", line: 2, level: 2 },
      { name: "main", kind: "function", line: 5, level: 1 },
    ]);
  });

  it("extracts JavaScript and TypeScript declarations", () => {
    const symbols = extractCodeOutlineSymbols(
      [
        "export interface User { id: string }",
        "type Mode = 'read' | 'write';",
        "export class Service {}",
        "export async function load() {}",
        "const render = () => null;",
        "let count = 0;",
      ].join("\n"),
      "typescript",
    );

    expect(symbols.map(({ name, kind, line }) => ({ name, kind, line }))).toEqual([
      { name: "User", kind: "interface", line: 1 },
      { name: "Mode", kind: "type", line: 2 },
      { name: "Service", kind: "class", line: 3 },
      { name: "load", kind: "function", line: 4 },
      { name: "render", kind: "function", line: 5 },
      { name: "count", kind: "variable", line: 6 },
    ]);
  });

  it("extracts C and C++ structs, classes, enums, and functions", () => {
    const symbols = extractCodeOutlineSymbols(
      [
        "#include <stdio.h>",
        "struct Point { int x; int y; };",
        "typedef enum Result { Pass, Fail } Result;",
        "class Runner { };",
        "enum Status { Ok, Error };",
        "int add(int a, int b) {",
        "}",
        "void Runner::start() {",
        "}",
      ].join("\n"),
      "cpp",
    );

    expect(symbols.map(({ name, kind, line, detail }) => ({ name, kind, line, detail }))).toEqual([
      { name: "Point", kind: "struct", line: 2, detail: undefined },
      { name: "Result", kind: "enum", line: 3, detail: undefined },
      { name: "Runner", kind: "class", line: 4, detail: undefined },
      { name: "Status", kind: "enum", line: 5, detail: undefined },
      { name: "add", kind: "function", line: 6, detail: "add" },
      { name: "start", kind: "function", line: 8, detail: "Runner::start" },
    ]);
  });
});
