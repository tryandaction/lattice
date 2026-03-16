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

  it("maps julia and R files to external command templates", () => {
    expect(getRunnerDefinition("jl")?.command).toBe("julia");
    expect(getRunnerDefinition("r")?.command).toBe("Rscript");
  });

  it("returns null for unsupported extensions", () => {
    expect(getRunnerDefinition("tsx")).toBeNull();
  });
});
