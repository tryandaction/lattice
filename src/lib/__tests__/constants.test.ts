import { describe, expect, it } from "vitest";
import { isAllowedExtension } from "@/lib/constants";

describe("explorer allowed extensions", () => {
  it.each([
    "py",
    "ts",
    "tsx",
    "js",
    "jsx",
    "rs",
    "md",
    "json",
    "c",
    "h",
    "cpp",
    "hpp",
    "java",
    "go",
    "toml",
    "yaml",
    "yml",
    "sh",
    "ps1",
    "html",
    "css",
    "scss",
    "sql",
  ])("shows .%s code and runnable text files", (extension) => {
    expect(isAllowedExtension(extension)).toBe(true);
  });

  it.each(["exe", "dll", "bin"])("keeps .%s binary files hidden", (extension) => {
    expect(isAllowedExtension(extension)).toBe(false);
  });
});
