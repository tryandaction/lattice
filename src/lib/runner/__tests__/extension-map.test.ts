import { describe, expect, it } from "vitest";
import { getRunnerDefinition } from "@/lib/runner/extension-map";

describe("runner extension map", () => {
  it("maps python files to the local python runner", () => {
    const definition = getRunnerDefinition("py");
    expect(definition?.runnerType).toBe("python-local");
    expect(definition?.supportsInlineCode).toBe(true);
  });

  it("maps node-compatible files to external command execution", () => {
    const definition = getRunnerDefinition("js");
    expect(definition?.runnerType).toBe("external-command");
    expect(definition?.command).toBe("node");
    expect(definition?.buildArgs({ code: "console.log('x')", mode: "inline" })).toEqual([
      "-e",
      "console.log('x')",
    ]);
  });

  it("maps TypeScript files to Node type-transform execution", () => {
    const definition = getRunnerDefinition("ts");
    expect(definition?.runnerType).toBe("external-command");
    expect(definition?.command).toBe("node");
    expect(definition?.supportsInlineCode).toBe(true);
    expect(definition?.buildArgs({ filePath: "C:/workspace/demo.ts", mode: "file" })).toEqual([
      "--experimental-transform-types",
      "C:/workspace/demo.ts",
    ]);
    expect(definition?.buildArgs({ code: "const value: number = 42", mode: "inline" })).toEqual([
      "--experimental-transform-types",
      "-e",
      "const value: number = 42",
    ]);
  });

  it("maps julia and R files to external command templates", () => {
    expect(getRunnerDefinition("jl")?.command).toBe("julia");
    expect(getRunnerDefinition("r")?.command).toBe("Rscript");
  });

  it("maps C and C++ files to compiled native execution", () => {
    const cDefinition = getRunnerDefinition("c");
    expect(cDefinition?.runnerType).toBe("compiled-native");
    expect(cDefinition?.command).toBe("gcc");
    expect(cDefinition?.supportsInlineCode).toBe(false);
    expect(cDefinition?.buildArgs({ filePath: "C:/workspace/main.c", mode: "file" })).toEqual([]);

    const cppDefinition = getRunnerDefinition("cpp");
    expect(cppDefinition?.runnerType).toBe("compiled-native");
    expect(cppDefinition?.command).toBe("g++");
    expect(getRunnerDefinition("hxx")).toBe(cppDefinition);
  });

  it("returns null for unsupported extensions", () => {
    expect(getRunnerDefinition("tsx")).toBeNull();
  });
});
