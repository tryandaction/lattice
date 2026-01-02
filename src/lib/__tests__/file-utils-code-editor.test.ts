/**
 * File Utils - CodeEditor Extension Routing Tests
 * 
 * Feature: unified-codemirror-engine
 * Property 3: File Extension to Language Mode Routing
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  isEditableCodeFile,
  getCodeEditorLanguage,
  EDITABLE_CODE_EXTENSIONS,
  isEditableFile,
} from "../file-utils";

describe("File Utils - CodeEditor Routing", () => {
  /**
   * Feature: unified-codemirror-engine
   * Property 3: File Extension to Language Mode Routing
   * Validates: Requirements 4.1, 4.2, 4.3, 4.4
   * 
   * For any file with extension in {.py, .js, .ts, .jsx, .tsx, .json, .tex},
   * the File_Viewer SHALL render a CodeEditor with the corresponding language mode.
   */
  describe("Property 3: File Extension to Language Mode Routing", () => {
    // Define the expected mappings
    const extensionToLanguage: Record<string, string> = {
      py: "python",
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      mjs: "javascript",
      cjs: "javascript",
      json: "json",
      jsonc: "json",
      tex: "latex",
      latex: "latex",
    };

    it("should correctly identify all editable code extensions", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...Object.keys(extensionToLanguage)),
          (extension) => {
            return isEditableCodeFile(extension) === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should map each extension to the correct language", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...Object.keys(extensionToLanguage)),
          (extension) => {
            const expectedLanguage = extensionToLanguage[extension];
            const actualLanguage = getCodeEditorLanguage(extension);
            return actualLanguage === expectedLanguage;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should handle case-insensitive extensions", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...Object.keys(extensionToLanguage)),
          fc.boolean(),
          (extension, uppercase) => {
            const testExt = uppercase ? extension.toUpperCase() : extension;
            return isEditableCodeFile(testExt) === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should return false for non-editable code extensions", () => {
      const nonEditableExtensions = ["pdf", "doc", "docx", "ppt", "png", "jpg", "gif"];
      
      fc.assert(
        fc.property(
          fc.constantFrom(...nonEditableExtensions),
          (extension) => {
            return isEditableCodeFile(extension) === false;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Python file routing (Requirement 4.1)", () => {
    it("should route .py files to python language", () => {
      expect(isEditableCodeFile("py")).toBe(true);
      expect(getCodeEditorLanguage("py")).toBe("python");
    });
  });

  describe("JavaScript/TypeScript file routing (Requirement 4.2)", () => {
    it("should route .js files to javascript language", () => {
      expect(isEditableCodeFile("js")).toBe(true);
      expect(getCodeEditorLanguage("js")).toBe("javascript");
    });

    it("should route .ts files to typescript language", () => {
      expect(isEditableCodeFile("ts")).toBe(true);
      expect(getCodeEditorLanguage("ts")).toBe("typescript");
    });

    it("should route .jsx files to javascript language", () => {
      expect(isEditableCodeFile("jsx")).toBe(true);
      expect(getCodeEditorLanguage("jsx")).toBe("javascript");
    });

    it("should route .tsx files to typescript language", () => {
      expect(isEditableCodeFile("tsx")).toBe(true);
      expect(getCodeEditorLanguage("tsx")).toBe("typescript");
    });
  });

  describe("JSON file routing (Requirement 4.3)", () => {
    it("should route .json files to json language", () => {
      expect(isEditableCodeFile("json")).toBe(true);
      expect(getCodeEditorLanguage("json")).toBe("json");
    });

    it("should route .jsonc files to json language", () => {
      expect(isEditableCodeFile("jsonc")).toBe(true);
      expect(getCodeEditorLanguage("jsonc")).toBe("json");
    });
  });

  describe("LaTeX file routing (Requirement 4.4)", () => {
    it("should route .tex files to latex language", () => {
      expect(isEditableCodeFile("tex")).toBe(true);
      expect(getCodeEditorLanguage("tex")).toBe("latex");
    });

    it("should route .latex files to latex language", () => {
      expect(isEditableCodeFile("latex")).toBe(true);
      expect(getCodeEditorLanguage("latex")).toBe("latex");
    });
  });

  describe("isEditableFile integration", () => {
    it("should include editable code files in isEditableFile", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...EDITABLE_CODE_EXTENSIONS),
          (extension) => {
            return isEditableFile(extension) === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should still include markdown and notebook files", () => {
      expect(isEditableFile("md")).toBe(true);
      expect(isEditableFile("txt")).toBe(true);
      expect(isEditableFile("ipynb")).toBe(true);
    });
  });
});
