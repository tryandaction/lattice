import { describe, expect, it } from "vitest";
import { parseOutputLocationLine, parseOutputLocations } from "@/lib/runner/output-location-parser";

describe("runner output location parser", () => {
  it("parses GCC and Clang style diagnostics", () => {
    const location = parseOutputLocationLine("src/main.c:12:5: error: expected ';' before 'return'");

    expect(location).toMatchObject({
      filePath: "src/main.c",
      line: 12,
      column: 5,
      severity: "error",
      source: "gcc",
      message: "expected ';' before 'return'",
    });
  });

  it("parses GCC warnings without a column", () => {
    const location = parseOutputLocationLine("src/main.c:8: warning: unused variable 'x'");

    expect(location).toMatchObject({
      filePath: "src/main.c",
      line: 8,
      severity: "warning",
      source: "gcc",
      message: "unused variable 'x'",
    });
    expect(location?.column).toBeUndefined();
  });

  it("parses MSVC diagnostics", () => {
    const location = parseOutputLocationLine("C:\\workspace\\main.cpp(21,9): error C2143: syntax error: missing ';'");

    expect(location).toMatchObject({
      filePath: "C:\\workspace\\main.cpp",
      line: 21,
      column: 9,
      severity: "error",
      source: "msvc",
      message: "C2143: syntax error: missing ';'",
    });
  });

  it("parses TypeScript diagnostics", () => {
    const location = parseOutputLocationLine("src/app.ts(4,13): error TS2322: Type 'string' is not assignable to type 'number'.");

    expect(location).toMatchObject({
      filePath: "src/app.ts",
      line: 4,
      column: 13,
      severity: "error",
      source: "typescript",
      message: "TS2322: Type 'string' is not assignable to type 'number'.",
    });
  });

  it("parses Node stack frame locations", () => {
    const location = parseOutputLocationLine("    at Object.<anonymous> (C:\\workspace\\demo.js:3:7)");

    expect(location).toMatchObject({
      filePath: "C:\\workspace\\demo.js",
      line: 3,
      column: 7,
      severity: "error",
      source: "node",
    });
  });

  it("parses multiple locations from stderr text", () => {
    const locations = parseOutputLocations([
      "src/main.c:12:5: error: expected ';'",
      "src/main.c:13:1: note: to match this '{'",
      "",
    ].join("\n"));

    expect(locations).toHaveLength(2);
    expect(locations[0].severity).toBe("error");
    expect(locations[1].severity).toBe("info");
  });

  it("ignores non-location log lines", () => {
    expect(parseOutputLocationLine("hello from stderr")).toBeNull();
  });
});
