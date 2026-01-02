/**
 * Tests for Jupyter Notebook utilities
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  parseNotebook,
  serializeNotebook,
  normalizeSource,
  sourceToArray,
  addCellAfter,
  addCellBefore,
  deleteCell,
  updateCellSource,
  setActiveCell,
  changeCellType,
  type NotebookEditorState,
} from "../notebook-utils";

describe("notebook-utils", () => {
  describe("normalizeSource", () => {
    it("should return string as-is", () => {
      expect(normalizeSource("hello")).toBe("hello");
    });

    it("should join array of strings", () => {
      expect(normalizeSource(["hello\n", "world"])).toBe("hello\nworld");
    });

    it("should handle empty array", () => {
      expect(normalizeSource([])).toBe("");
    });
  });

  describe("sourceToArray", () => {
    it("should split string into lines with newlines preserved", () => {
      const result = sourceToArray("line1\nline2\nline3");
      expect(result).toEqual(["line1\n", "line2\n", "line3"]);
    });

    it("should handle single line", () => {
      expect(sourceToArray("hello")).toEqual(["hello"]);
    });

    it("should handle empty string", () => {
      expect(sourceToArray("")).toEqual([]);
    });
  });

  describe("parseNotebook", () => {
    it("should parse valid notebook JSON", () => {
      const json = JSON.stringify({
        cells: [
          { cell_type: "code", source: "print('hello')", metadata: {} },
          { cell_type: "markdown", source: "# Title", metadata: {} },
        ],
        metadata: { kernelspec: { name: "python3" } },
        nbformat: 4,
        nbformat_minor: 5,
      });

      const state = parseNotebook(json);
      expect(state.cells).toHaveLength(2);
      expect(state.cells[0].cell_type).toBe("code");
      expect(state.cells[0].source).toBe("print('hello')");
      expect(state.cells[1].cell_type).toBe("markdown");
      expect(state.nbformat).toBe(4);
    });

    it("should handle array source format", () => {
      const json = JSON.stringify({
        cells: [
          { cell_type: "code", source: ["line1\n", "line2"], metadata: {} },
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      });

      const state = parseNotebook(json);
      expect(state.cells[0].source).toBe("line1\nline2");
    });

    it("should convert raw cells to code", () => {
      const json = JSON.stringify({
        cells: [
          { cell_type: "raw", source: "raw content", metadata: {} },
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      });

      const state = parseNotebook(json);
      expect(state.cells[0].cell_type).toBe("code");
    });

    it("should create default cell for empty notebook", () => {
      const json = JSON.stringify({
        cells: [],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      });

      const state = parseNotebook(json);
      expect(state.cells).toHaveLength(1);
      expect(state.cells[0].cell_type).toBe("code");
    });

    it("should handle invalid JSON gracefully", () => {
      const state = parseNotebook("invalid json");
      expect(state.cells).toHaveLength(1);
      expect(state.nbformat).toBe(4);
    });
  });

  describe("serializeNotebook", () => {
    it("should serialize state back to valid JSON", () => {
      const state: NotebookEditorState = {
        cells: [
          {
            id: "cell-1",
            cell_type: "code",
            source: "print('hello')",
            metadata: {},
            outputs: [],
            execution_count: 1,
          },
        ],
        activeCellId: "cell-1",
        metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" } },
        nbformat: 4,
        nbformat_minor: 5,
      };

      const json = serializeNotebook(state);
      const parsed = JSON.parse(json);

      expect(parsed.cells).toHaveLength(1);
      expect(parsed.cells[0].cell_type).toBe("code");
      expect(parsed.cells[0].source).toEqual(["print('hello')"]);
      expect(parsed.cells[0].outputs).toEqual([]);
      expect(parsed.nbformat).toBe(4);
    });

    it("should not include outputs for markdown cells", () => {
      const state: NotebookEditorState = {
        cells: [
          {
            id: "cell-1",
            cell_type: "markdown",
            source: "# Title",
            metadata: {},
          },
        ],
        activeCellId: "cell-1",
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      };

      const json = serializeNotebook(state);
      const parsed = JSON.parse(json);

      expect(parsed.cells[0].outputs).toBeUndefined();
      expect(parsed.cells[0].execution_count).toBeUndefined();
    });
  });

  describe("parse-serialize round-trip", () => {
    it("should preserve content through round-trip", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              cell_type: fc.constantFrom("code", "markdown"),
              source: fc.string({ minLength: 0, maxLength: 500 }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (cells) => {
            const original = JSON.stringify({
              cells: cells.map((c) => ({
                cell_type: c.cell_type,
                source: c.source,
                metadata: {},
                ...(c.cell_type === "code" && { outputs: [], execution_count: null }),
              })),
              metadata: {},
              nbformat: 4,
              nbformat_minor: 5,
            });

            const state = parseNotebook(original);
            const serialized = serializeNotebook(state);
            const reparsed = parseNotebook(serialized);

            // Cell count should match
            expect(reparsed.cells.length).toBe(cells.length);

            // Cell types should match
            for (let i = 0; i < cells.length; i++) {
              expect(reparsed.cells[i].cell_type).toBe(cells[i].cell_type);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe("cell operations", () => {
    const createTestState = (): NotebookEditorState => ({
      cells: [
        { id: "cell-1", cell_type: "code", source: "code 1", metadata: {} },
        { id: "cell-2", cell_type: "markdown", source: "# Title", metadata: {} },
        { id: "cell-3", cell_type: "code", source: "code 2", metadata: {} },
      ],
      activeCellId: "cell-2",
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    });

    describe("addCellAfter", () => {
      it("should add cell after specified cell", () => {
        const state = createTestState();
        const newState = addCellAfter(state, "cell-1", "code");

        expect(newState.cells).toHaveLength(4);
        expect(newState.cells[1].cell_type).toBe("code");
        expect(newState.cells[1].source).toBe("");
        expect(newState.activeCellId).toBe(newState.cells[1].id);
      });

      it("should return unchanged state for invalid cell id", () => {
        const state = createTestState();
        const newState = addCellAfter(state, "invalid", "code");

        expect(newState).toBe(state);
      });
    });

    describe("addCellBefore", () => {
      it("should add cell before specified cell", () => {
        const state = createTestState();
        const newState = addCellBefore(state, "cell-2", "markdown");

        expect(newState.cells).toHaveLength(4);
        expect(newState.cells[1].cell_type).toBe("markdown");
        expect(newState.activeCellId).toBe(newState.cells[1].id);
      });
    });

    describe("deleteCell", () => {
      it("should delete specified cell", () => {
        const state = createTestState();
        const newState = deleteCell(state, "cell-2");

        expect(newState.cells).toHaveLength(2);
        expect(newState.cells.find((c) => c.id === "cell-2")).toBeUndefined();
      });

      it("should update active cell when deleting active cell", () => {
        const state = createTestState();
        const newState = deleteCell(state, "cell-2");

        expect(newState.activeCellId).not.toBe("cell-2");
        expect(newState.activeCellId).toBeTruthy();
      });

      it("should not delete last cell", () => {
        const state: NotebookEditorState = {
          cells: [{ id: "cell-1", cell_type: "code", source: "", metadata: {} }],
          activeCellId: "cell-1",
          metadata: {},
          nbformat: 4,
          nbformat_minor: 5,
        };

        const newState = deleteCell(state, "cell-1");
        expect(newState.cells).toHaveLength(1);
      });
    });

    describe("updateCellSource", () => {
      it("should update cell source", () => {
        const state = createTestState();
        const newState = updateCellSource(state, "cell-1", "new code");

        expect(newState.cells[0].source).toBe("new code");
      });
    });

    describe("setActiveCell", () => {
      it("should set active cell", () => {
        const state = createTestState();
        const newState = setActiveCell(state, "cell-3");

        expect(newState.activeCellId).toBe("cell-3");
      });
    });

    describe("changeCellType", () => {
      it("should change cell type from code to markdown", () => {
        const state = createTestState();
        const newState = changeCellType(state, "cell-1", "markdown");

        expect(newState.cells[0].cell_type).toBe("markdown");
      });

      it("should add outputs when changing to code", () => {
        const state = createTestState();
        const newState = changeCellType(state, "cell-2", "code");

        expect(newState.cells[1].cell_type).toBe("code");
        expect(newState.cells[1].outputs).toEqual([]);
        expect(newState.cells[1].execution_count).toBeNull();
      });
    });
  });
});
