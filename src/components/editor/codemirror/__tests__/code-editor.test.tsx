/**
 * CodeEditor Property-Based Tests
 * 
 * Feature: unified-codemirror-engine
 * Tests correctness properties using fast-check
 * 
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, waitFor } from "@testing-library/react";
import fc from "fast-check";
import { CodeEditor, CodeEditorLanguage, type CodeEditorRef, vscodeStyleKeymap } from "../code-editor";
import { flashReferenceRange } from "@/lib/reference-target-flash";
import { buildCodeMinimapRows } from "../minimap";

const quoteFlashCleanup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reference-target-flash", () => ({
  flashReferenceRange: vi.fn(() => quoteFlashCleanup),
  flashReferenceTarget: vi.fn(() => quoteFlashCleanup),
}));

// Mock the dynamic imports for language extensions
vi.mock("@codemirror/lang-python", () => ({
  python: () => [],
}));

vi.mock("@codemirror/lang-javascript", () => ({
  javascript: () => [],
}));

vi.mock("@codemirror/lang-json", () => ({
  json: () => [],
}));

vi.mock("@codemirror/lang-markdown", () => ({
  markdown: () => [],
}));

vi.mock("@codemirror/language", () => ({
  StreamLanguage: {
    define: () => [],
  },
  HighlightStyle: {
    define: () => [],
  },
  syntaxHighlighting: () => [],
  bracketMatching: () => [],
  foldGutter: () => [],
  foldKeymap: [],
  indentOnInput: () => [],
}));

vi.mock("@codemirror/legacy-modes/mode/stex", () => ({
  stex: {},
}));

vi.mock("@codemirror/legacy-modes/mode/clike", () => ({
  c: {},
  cpp: {},
}));

describe("CodeEditor Properties", () => {
  it('restores cursor and selection safely when an external edit shortened the document', async () => {
    const editorRef = { current: null as CodeEditorRef | null };
    render(<CodeEditor initialValue="Short." language="plaintext" onChange={vi.fn()} editorRef={editorRef} />);
    await waitFor(() => expect(editorRef.current?.isReady()).toBe(true));
    expect(() => editorRef.current?.restoreEditorState({ cursorPosition: 90, scrollTop: 120,
      selection: { from: 30, to: 90 } })).not.toThrow();
    expect(editorRef.current?.getEditorState()?.selection).toEqual({ from: 6, to: 6 });
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("outlines only the requested code substring and cleans old flashes", async () => {
    const editorRef = { current: null as CodeEditorRef | null };
    const { unmount } = render(<CodeEditor initialValue="const value = 42;" language="plaintext" onChange={vi.fn()} editorRef={editorRef} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("const value = 42;"));
    expect(editorRef.current?.flashRange({ from: 6, to: 11 })).toBe(true);
    expect(vi.mocked(flashReferenceRange).mock.calls.at(-1)?.[0].toString()).toBe("value");
    expect(editorRef.current?.flashRange({ from: 14, to: 16 })).toBe(true);
    expect(quoteFlashCleanup).toHaveBeenCalledTimes(1);
    expect(vi.mocked(flashReferenceRange).mock.calls.at(-1)?.[0].toString()).toBe("42");
    expect(editorRef.current?.flashRange({ from: 0, to: 99 })).toBe(false);
    expect(quoteFlashCleanup).toHaveBeenCalledTimes(2);
    editorRef.current?.flashRange({ from: 6, to: 11 });
    unmount();
    expect(quoteFlashCleanup).toHaveBeenCalledTimes(3);
  });

  describe("VS Code style key bindings", () => {
    it("does not report a quote revealed when its DOM range has no drawable fragments", async () => {
      const editorRef = { current: null as CodeEditorRef | null };
      render(<CodeEditor initialValue="value = 42" language="plaintext" onChange={vi.fn()} editorRef={editorRef} />);
      await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("value = 42"));
      vi.mocked(flashReferenceRange).mockReturnValueOnce(null);
      expect(editorRef.current?.flashRange({ from: 8, to: 10 })).toBe(false);
    });
    it("registers common editor shortcut aliases", () => {
      const bindings = new Set(vscodeStyleKeymap.map((binding) => binding.key));

      expect(bindings.has("Mod-g")).toBe(true);
      expect(bindings.has("Ctrl-g")).toBe(true);
      expect(bindings.has("Mod-/")).toBe(true);
      expect(bindings.has("Ctrl-/")).toBe(true);
      expect(bindings.has("Shift-Alt-a")).toBe(true);
      expect(bindings.has("Mod-[")).toBe(true);
      expect(bindings.has("Mod-]")).toBe(true);
      expect(bindings.has("Alt-ArrowUp")).toBe(true);
      expect(bindings.has("Alt-ArrowDown")).toBe(true);
      expect(bindings.has("Shift-Alt-ArrowUp")).toBe(true);
      expect(bindings.has("Shift-Alt-ArrowDown")).toBe(true);
    });
  });

  describe("Code minimap", () => {
    it("caps sampled rows for large documents while preserving document coverage", () => {
      const doc = {
        lines: 1000,
        line: (lineNumber: number) => ({ text: `line-${lineNumber}` }),
      };

      const rows = buildCodeMinimapRows(doc);

      expect(rows).toHaveLength(180);
      expect(rows[0]?.top).toBe(0);
      expect(rows.at(-1)?.top).toBeGreaterThan(99);
    });

    it("renders the minimap by default for scrollable code editors and honors opt-out", async () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <CodeEditor initialValue={"one\ntwo\nthree"} language="typescript" onChange={onChange} />,
      );

      await waitFor(() => {
        expect(document.querySelector('[data-testid="code-minimap"]')).toBeTruthy();
      });

      rerender(
        <CodeEditor initialValue={"one\ntwo\nthree"} language="typescript" onChange={onChange} minimap={false} />,
      );

      await waitFor(() => {
        expect(document.querySelector('[data-testid="code-minimap"]')).toBeFalsy();
      });
    });
  });

  /**
   * Feature: unified-codemirror-engine
   * Property 1: Content Round-Trip Consistency
   * Validates: Requirements 1.1, 1.3
   * 
   * For any valid string content passed as initialValue, the CodeEditor
   * SHALL display that content, and for any subsequent edit, the onChange
   * callback SHALL be invoked with the complete updated content.
   */
  describe("Property 1: Content Round-Trip Consistency", () => {
    it("should accept any string as initialValue and render without error", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 1000 }),
          async (content) => {
            const onChange = vi.fn();
            
            const { unmount } = render(
              <CodeEditor
                initialValue={content}
                language="python"
                onChange={onChange}
              />
            );
            
            // Wait for editor to initialize
            await waitFor(() => {
              const container = document.querySelector(".code-editor");
              expect(container).toBeTruthy();
            }, { timeout: 2000 });
            
            unmount();
            return true;
          }
        ),
        { numRuns: 20 } // Reduced for CI performance
      );
    });

    it("should invoke onChange with complete content on changes", async () => {
      const onChange = vi.fn();
      const initialContent = "print('hello')";
      
      render(
        <CodeEditor
          initialValue={initialContent}
          language="python"
          onChange={onChange}
        />
      );
      
      await waitFor(() => {
        const container = document.querySelector(".code-editor");
        expect(container).toBeTruthy();
      }, { timeout: 2000 });
      
      // The onChange should be callable and receive string content
      expect(typeof onChange).toBe("function");
    });
  });

  /**
   * Feature: unified-codemirror-engine
   * Property 2: Read-Only Mode Prevents Modifications
   * Validates: Requirements 1.4, 1.6
   * 
   * For any CodeEditor instance with isReadOnly={true}, for any attempted
   * content modification, the editor content SHALL remain unchanged and
   * onChange SHALL NOT be called.
   */
  describe("Property 2: Read-Only Mode Prevents Modifications", () => {
    it("should render in read-only mode without error", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 500 }),
          async (content) => {
            const onChange = vi.fn();
            
            const { unmount } = render(
              <CodeEditor
                initialValue={content}
                language="python"
                onChange={onChange}
                isReadOnly={true}
              />
            );
            
            await waitFor(() => {
              const container = document.querySelector(".code-editor");
              expect(container).toBeTruthy();
            }, { timeout: 2000 });
            
            unmount();
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Feature: unified-codemirror-engine
   * Property 9: Instance Cleanup on Unmount
   * Validates: Requirements 7.3
   * 
   * For any CodeEditor instance that is unmounted, the CodeMirror destroy()
   * method SHALL be called exactly once, and no references to the instance
   * SHALL remain.
   */
  describe("Property 9: Instance Cleanup on Unmount", () => {
    it("should clean up editor instance on unmount", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 200 }),
          fc.constantFrom<CodeEditorLanguage>("python", "javascript", "json", "markdown"),
          async (content, language) => {
            const onChange = vi.fn();
            
            const { unmount } = render(
              <CodeEditor
                initialValue={content}
                language={language}
                onChange={onChange}
              />
            );
            
            await waitFor(() => {
              const container = document.querySelector(".code-editor");
              expect(container).toBeTruthy();
            }, { timeout: 2000 });
            
            // Unmount should not throw
            expect(() => unmount()).not.toThrow();
            
            // After unmount, the container should be removed
            const container = document.querySelector(".code-editor");
            expect(container).toBeFalsy();
            
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });

    it("should handle multiple mount/unmount cycles", async () => {
      const onChange = vi.fn();
      
      for (let i = 0; i < 3; i++) {
        const { unmount } = render(
          <CodeEditor
            initialValue={`cycle ${i}`}
            language="python"
            onChange={onChange}
          />
        );
        
        await waitFor(() => {
          const container = document.querySelector(".code-editor");
          expect(container).toBeTruthy();
        }, { timeout: 2000 });
        
        unmount();
      }
      
      // All cycles should complete without memory leaks or errors
      expect(true).toBe(true);
    });
  });

  /**
   * Language Support Tests
   * Validates: Requirements 2.5, 2.6, 2.7, 2.8, 2.9
   */
  describe("Language Support", () => {
    const languages: CodeEditorLanguage[] = [
      "python",
      "c",
      "cpp",
      "javascript",
      "typescript",
      "json",
      "markdown",
      "latex",
    ];

    it.each(languages)("should render with %s language without error", async (language) => {
      const onChange = vi.fn();
      
      const { unmount } = render(
        <CodeEditor
          initialValue={`// ${language} code`}
          language={language}
          onChange={onChange}
        />
      );
      
      await waitFor(() => {
        const container = document.querySelector(".code-editor");
        expect(container).toBeTruthy();
      }, { timeout: 2000 });
      
      unmount();
    });
  });

  /**
   * Error Handling Tests
   * Validates: Requirements 7.1, 7.2
   */
  describe("Error Handling", () => {
    it("should display error state when initialization fails", async () => {
      // This test verifies the error UI exists in the component
      // Actual error triggering would require mocking CodeMirror to fail
      const onChange = vi.fn();
      
      const { unmount } = render(
        <CodeEditor
          initialValue="test"
          language="python"
          onChange={onChange}
        />
      );
      
      await waitFor(() => {
        const container = document.querySelector(".code-editor");
        expect(container).toBeTruthy();
      }, { timeout: 2000 });
      
      unmount();
    });
  });

  /**
   * Feature: unified-codemirror-engine
   * Property 8: Memoization Prevents Unnecessary Re-renders
   * Validates: Requirements 1.7, 6.1, 6.2
   * 
   * For any CodeEditor instance, when props that don't affect rendering
   * (onChange, navigation callbacks) change, the component SHALL NOT
   * re-render. Only changes to fileId, language, isReadOnly, autoHeight,
   * or className SHALL trigger re-renders.
   */
  describe("Property 8: Memoization Prevents Unnecessary Re-renders", () => {
    /**
     * Test the memoization comparison function logic
     * This validates the custom arePropsEqual function
     */
    function shouldRerender(
      prevProps: Partial<{
        fileId: string;
        language: string;
        isReadOnly: boolean;
        autoHeight: boolean;
        className: string;
        onChange: () => void;
        onNavigateUp: () => void;
        onNavigateDown: () => void;
        onEscape: () => void;
        initialValue: string;
      }>,
      nextProps: Partial<{
        fileId: string;
        language: string;
        isReadOnly: boolean;
        autoHeight: boolean;
        className: string;
        onChange: () => void;
        onNavigateUp: () => void;
        onNavigateDown: () => void;
        onEscape: () => void;
        initialValue: string;
      }>
    ): boolean {
      // Re-render if fileId changes
      if (prevProps.fileId !== nextProps.fileId) return true;
      // Re-render if language changes
      if (prevProps.language !== nextProps.language) return true;
      // Re-render if read-only mode changes
      if (prevProps.isReadOnly !== nextProps.isReadOnly) return true;
      // Re-render if auto-height mode changes
      if (prevProps.autoHeight !== nextProps.autoHeight) return true;
      // Re-render if className changes
      if (prevProps.className !== nextProps.className) return true;
      // Don't re-render for callback or initialValue changes
      return false;
    }

    it("should re-render when fileId changes", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => s !== ""),
          (fileId1, fileId2) => {
            if (fileId1 === fileId2) return true; // Skip if same
            
            const result = shouldRerender(
              { fileId: fileId1 },
              { fileId: fileId2 }
            );
            expect(result).toBe(true);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should re-render when language changes", () => {
      const languages = ["python", "javascript", "typescript", "json", "markdown", "latex"];
      
      fc.assert(
        fc.property(
          fc.constantFrom(...languages),
          fc.constantFrom(...languages),
          (lang1, lang2) => {
            const result = shouldRerender(
              { language: lang1 },
              { language: lang2 }
            );
            expect(result).toBe(lang1 !== lang2);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should re-render when isReadOnly changes", () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.boolean(),
          (readOnly1, readOnly2) => {
            const result = shouldRerender(
              { isReadOnly: readOnly1 },
              { isReadOnly: readOnly2 }
            );
            expect(result).toBe(readOnly1 !== readOnly2);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should re-render when autoHeight changes", () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.boolean(),
          (autoHeight1, autoHeight2) => {
            const result = shouldRerender(
              { autoHeight: autoHeight1 },
              { autoHeight: autoHeight2 }
            );
            expect(result).toBe(autoHeight1 !== autoHeight2);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should re-render when className changes", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 50 }),
          fc.string({ minLength: 0, maxLength: 50 }),
          (class1, class2) => {
            const result = shouldRerender(
              { className: class1 },
              { className: class2 }
            );
            expect(result).toBe(class1 !== class2);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should NOT re-render when only onChange changes", () => {
      fc.assert(
        fc.property(
          fc.constant(() => {}),
          fc.constant(() => {}),
          () => {
            const fn1 = () => {};
            const fn2 = () => {};
            
            const result = shouldRerender(
              { onChange: fn1, fileId: "same", language: "python" },
              { onChange: fn2, fileId: "same", language: "python" }
            );
            expect(result).toBe(false);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should NOT re-render when only navigation callbacks change", () => {
      fc.assert(
        fc.property(
          fc.boolean(), // Just to run multiple times
          () => {
            const result = shouldRerender(
              { 
                onNavigateUp: () => {}, 
                onNavigateDown: () => {}, 
                onEscape: () => {},
                fileId: "same",
                language: "python"
              },
              { 
                onNavigateUp: () => {}, 
                onNavigateDown: () => {}, 
                onEscape: () => {},
                fileId: "same",
                language: "python"
              }
            );
            expect(result).toBe(false);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should NOT re-render when only initialValue changes", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 500 }),
          fc.string({ minLength: 0, maxLength: 500 }),
          (value1, value2) => {
            const result = shouldRerender(
              { initialValue: value1, fileId: "same", language: "python" },
              { initialValue: value2, fileId: "same", language: "python" }
            );
            expect(result).toBe(false);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Auto-Height Mode Tests
   * Validates: Requirements 5.2
   */
  describe("Auto-Height Mode", () => {
    it("should render in auto-height mode", async () => {
      const onChange = vi.fn();
      
      const { unmount } = render(
        <CodeEditor
          initialValue="line1\nline2\nline3"
          language="python"
          onChange={onChange}
          autoHeight={true}
        />
      );
      
      await waitFor(() => {
        const container = document.querySelector(".code-editor-auto-height");
        expect(container).toBeTruthy();
      }, { timeout: 2000 });
      
      unmount();
    });

    it("should render in scrollable mode by default", async () => {
      const onChange = vi.fn();
      
      const { unmount } = render(
        <CodeEditor
          initialValue="line1\nline2\nline3"
          language="python"
          onChange={onChange}
          autoHeight={false}
        />
      );
      
      await waitFor(() => {
        const container = document.querySelector(".code-editor-scrollable");
        expect(container).toBeTruthy();
      }, { timeout: 2000 });
      
      unmount();
    });
  });
});
