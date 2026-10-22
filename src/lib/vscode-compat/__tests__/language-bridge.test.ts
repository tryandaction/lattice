import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  firstVSCodeDefinitionLocation,
  applyVSCodeFormattingResponse,
  applyVSCodeRenameResponse,
  resolveVSCodeCodeActionResponse,
  mapVSCodeReferenceLocations,
  mapVSCodeCompletionResponse,
  mapVSCodeDiagnosticsResponse,
  offsetToVSCodePosition,
} from "@/lib/vscode-compat/language-bridge";

describe("VS Code language bridge", () => {
  it("converts CodeMirror offsets into VS Code zero-based positions", () => {
    const state = EditorState.create({ doc: "const value = 1;\nvalue." });

    expect(offsetToVSCodePosition(state.doc, state.doc.length)).toEqual({
      line: 1,
      character: 6,
    });
  });

  it("maps completion items and discards stale responses", () => {
    const fresh = mapVSCodeCompletionResponse({
      ok: true,
      feature: "completion",
      documentVersion: 4,
      providers: [],
      results: [{ label: "answer", detail: "number", insertText: "answer" }],
    }, 4, 8);
    const stale = mapVSCodeCompletionResponse({
      ok: true,
      feature: "completion",
      documentVersion: 3,
      providers: [],
      results: [{ label: "old" }],
    }, 4, 8);

    expect(fresh).toEqual({
      from: 8,
      options: [{ label: "answer", detail: "number", apply: "answer", type: "variable" }],
    });
    expect(stale).toBeNull();
  });

  it("maps extension diagnostics into CodeMirror ranges and severity", () => {
    const state = EditorState.create({ doc: "const broken = true;\n" });
    const diagnostics = mapVSCodeDiagnosticsResponse({
      ok: true,
      feature: "diagnostics",
      documentVersion: 2,
      providers: [],
      results: [{
        message: "Broken value",
        severity: 1,
        source: "fixture",
        range: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 12 },
        },
      }],
    }, 2, state.doc);

    expect(diagnostics).toEqual([expect.objectContaining({
      from: 6,
      to: 12,
      severity: "warning",
      message: "Broken value",
      source: "fixture",
    })]);
  });

  it("returns the first current-version definition location", () => {
    expect(firstVSCodeDefinitionLocation({
      ok: true,
      feature: "definition",
      documentVersion: 7,
      providers: [],
      results: [{
        filePath: "C:/vault/answer.ts",
        range: {
          start: { line: 2, character: 4 },
          end: { line: 2, character: 10 },
        },
      }],
    }, 7)).toEqual({
      filePath: "C:/vault/answer.ts",
      line: 3,
      column: 5,
    });
  });

  it("maps current-version reference locations", () => {
    expect(mapVSCodeReferenceLocations({
      ok: true,
      feature: "references",
      documentVersion: 3,
      providers: [],
      results: [{
        filePath: "C:/vault/demo.ts",
        range: {
          start: { line: 4, character: 2 },
          end: { line: 4, character: 8 },
        },
      }],
    }, 3)).toEqual([{
      filePath: "C:/vault/demo.ts",
      line: 5,
      column: 3,
    }]);
  });

  it("applies non-overlapping formatting edits from the end of the document", () => {
    expect(applyVSCodeFormattingResponse("const answer=42;\n", {
      ok: true,
      feature: "formatting",
      documentVersion: 5,
      providers: [],
      results: [{
        range: {
          start: { line: 0, character: 12 },
          end: { line: 0, character: 15 },
        },
        newText: " = 42",
      }],
    }, 5)).toBe("const answer = 42;\n");
  });

  it("applies current-document rename edits and rejects cross-file edits", () => {
    const local = applyVSCodeRenameResponse("const answer = answer;\n", {
      ok: true,
      feature: "rename",
      documentVersion: 6,
      providers: [],
      results: [{
        changes: [{
          filePath: "C:/vault/demo.ts",
          edits: [{
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 12 },
            },
            newText: "result",
          }, {
            range: {
              start: { line: 0, character: 15 },
              end: { line: 0, character: 21 },
            },
            newText: "result",
          }],
        }],
      }],
    }, 6, "C:/vault/demo.ts");
    const crossFile = applyVSCodeRenameResponse("const answer = 1;\n", {
      ok: true,
      feature: "rename",
      documentVersion: 6,
      providers: [],
      results: [{
        changes: [{
          filePath: "C:/vault/other.ts",
          edits: [],
        }],
      }],
    }, 6, "C:/vault/demo.ts");

    expect(local).toEqual({ supported: true, content: "const result = result;\n" });
    expect(crossFile.supported).toBe(false);
  });

  it("selects a preferred current-document quick fix with an optional command", () => {
    expect(resolveVSCodeCodeActionResponse("const answer = 1;\n", {
      ok: true,
      feature: "codeAction",
      documentVersion: 8,
      providers: [],
      results: [{
        title: "Use result",
        kind: "quickfix",
        isPreferred: true,
        edit: {
          changes: [{
            filePath: "C:/vault/demo.ts",
            edits: [{
              range: {
                start: { line: 0, character: 6 },
                end: { line: 0, character: 12 },
              },
              newText: "result",
            }],
          }],
        },
        command: {
          command: "fixture.afterFix",
          arguments: ["result"],
        },
      }],
    }, 8, "C:/vault/demo.ts")).toEqual({
      supported: true,
      title: "Use result",
      content: "const result = 1;\n",
      command: {
        command: "fixture.afterFix",
        arguments: ["result"],
      },
    });
  });
});
