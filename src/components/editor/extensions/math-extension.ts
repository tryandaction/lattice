/**
 * Custom Math Extension for Tiptap
 * 
 * Provides inline and block math rendering using KaTeX.
 * - Double-click to edit math formulas
 * - Click outside or press Enter to save
 * - Escape to cancel editing
 * - Drag handle for moving nodes (text selection works inside input)
 */

import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import katex from "katex";

/**
 * Render LaTeX to HTML string safely
 */
function renderLatexToHtml(latex: string, displayMode: boolean): string {
  try {
    // Pre-process latex to handle common issues
    let processedLatex = latex;
    
    // Escape unescaped % (comment character in LaTeX)
    // But don't double-escape already escaped \%
    processedLatex = processedLatex.replace(/(?<!\\)%/g, '\\%');
    
    // Handle other common unescaped special characters
    // # $ & _ { } are special in LaTeX
    // Only escape if not already escaped
    processedLatex = processedLatex.replace(/(?<!\\)#/g, '\\#');
    processedLatex = processedLatex.replace(/(?<!\\)&(?!amp;)/g, '\\&');
    // Don't escape $ as it's used for math delimiters
    // Don't escape _ as it's used for subscripts
    // Don't escape { } as they're used for grouping
    
    return katex.renderToString(processedLatex, {
      throwOnError: false,
      displayMode,
      strict: false, // Don't throw on unknown commands
      trust: true,   // Allow all commands
      output: 'html',
      macros: {
        // Common macros
        "\\R": "\\mathbb{R}",
        "\\N": "\\mathbb{N}",
        "\\Z": "\\mathbb{Z}",
        "\\Q": "\\mathbb{Q}",
        "\\C": "\\mathbb{C}",
        "\\eps": "\\varepsilon",
        "\\epsilon": "\\varepsilon",
        // Physics
        "\\ket": "\\left|#1\\right\\rangle",
        "\\bra": "\\left\\langle#1\\right|",
        "\\braket": "\\left\\langle#1\\middle|#2\\right\\rangle",
        // Common operators
        "\\argmax": "\\operatorname{argmax}",
        "\\argmin": "\\operatorname{argmin}",
        "\\grad": "\\nabla",
        "\\div": "\\nabla\\cdot",
        "\\curl": "\\nabla\\times",
        // Probability
        "\\Pr": "\\operatorname{Pr}",
        "\\E": "\\mathbb{E}",
        "\\Var": "\\operatorname{Var}",
        "\\Cov": "\\operatorname{Cov}",
        // Linear algebra
        "\\tr": "\\operatorname{tr}",
        "\\rank": "\\operatorname{rank}",
        "\\diag": "\\operatorname{diag}",
        "\\det": "\\operatorname{det}",
        // Calculus
        "\\dd": "\\mathrm{d}",
        "\\dv": "\\frac{\\mathrm{d}#1}{\\mathrm{d}#2}",
        "\\pdv": "\\frac{\\partial#1}{\\partial#2}",
      },
    });
  } catch (error) {
    // If rendering fails, show the raw latex with error styling
    const delimiter = displayMode ? "$$" : "$";
    const errorMsg = error instanceof Error ? error.message : 'Parse error';
    const escapedLatex = latex
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<span class="math-error" title="${errorMsg.replace(/"/g, '&quot;')}">${delimiter}${escapedLatex}${delimiter}</span>`;
  }
}

/**
 * Safely get node position
 */
function safeGetPos(getPos: (() => number | undefined) | boolean): number | null {
  if (typeof getPos !== "function") return null;
  try {
    const pos = getPos();
    return typeof pos === "number" ? pos : null;
  } catch {
    return null;
  }
}

/**
 * Safely update node attributes
 */
function safeUpdateAttributes(
  editor: any,
  nodeType: string,
  pos: number | null,
  attrs: Record<string, any>
): void {
  if (pos === null) return;
  
  try {
    const { doc } = editor.state;
    if (pos < 0 || pos >= doc.content.size) return;
    
    const node = doc.nodeAt(pos);
    if (!node || node.type.name !== nodeType) return;
    
    editor.chain()
      .command(({ tr }: { tr: any }) => {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
        return true;
      })
      .run();
  } catch (error) {
    console.warn("Failed to update math node:", error);
  }
}

/**
 * Inline Math Node ($...$)
 */
export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      latex: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="inline-math"]',
        getAttrs: (dom) => ({
          latex: (dom as HTMLElement).getAttribute("data-latex") || "",
        }),
      },
      {
        tag: 'span.katex',
        getAttrs: (dom) => {
          const annotation = (dom as HTMLElement).querySelector('annotation[encoding="application/x-tex"]');
          return { latex: annotation?.textContent || "" };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inline-math",
        "data-latex": node.attrs.latex,
        class: "inline-math-node",
      }),
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.className = "inline-math";
      dom.setAttribute("data-type", "inline-math");
      dom.setAttribute("contenteditable", "false");

      let isEditing = false;
      let currentLatex = node.attrs.latex || "";
      let isDestroyed = false;

      // Edit wrapper with drag handle
      const editWrapper = document.createElement("span");
      editWrapper.className = "math-edit-wrapper";
      
      const dragHandle = document.createElement("span");
      dragHandle.className = "math-drag-handle";
      dragHandle.innerHTML = "⋮⋮";
      dragHandle.title = "Drag to move";
      dragHandle.draggable = true;
      
      const editInput = document.createElement("input");
      editInput.type = "text";
      editInput.className = "math-edit-input";
      editInput.spellcheck = false;

      const renderContainer = document.createElement("span");
      renderContainer.className = "math-render";

      const saveAndRender = () => {
        if (isDestroyed) return;
        isEditing = false;
        dom.draggable = true; // Re-enable dragging when not editing
        const pos = safeGetPos(getPos);
        safeUpdateAttributes(editor, "inlineMath", pos, { latex: currentLatex });
        renderMath();
      };

      const renderMath = () => {
        if (isDestroyed) return;
        dom.innerHTML = "";
        
        if (isEditing) {
          dom.draggable = false; // Disable dragging when editing
          editInput.value = currentLatex;
          editWrapper.innerHTML = "";
          editWrapper.appendChild(dragHandle);
          editWrapper.appendChild(editInput);
          dom.appendChild(editWrapper);
          setTimeout(() => {
            if (!isDestroyed) {
              editInput.focus();
              editInput.selectionStart = editInput.value.length;
              editInput.selectionEnd = editInput.value.length;
            }
          }, 10);
        } else {
          dom.draggable = true;
          if (currentLatex) {
            renderContainer.innerHTML = renderLatexToHtml(currentLatex, false);
            dom.appendChild(renderContainer);
          } else {
            dom.innerHTML = '<span class="math-placeholder">$math$</span>';
          }
        }
      };

      dom.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isEditing && !isDestroyed) {
          isEditing = true;
          renderMath();
        }
      });

      // Handle mousedown - critical for text selection vs drag
      dom.addEventListener("mousedown", (e) => {
        const target = e.target as HTMLElement;
        
        // In edit mode, only allow drag from handle
        if (isEditing) {
          if (target === dragHandle || dragHandle.contains(target)) {
            // Allow drag from handle
            return;
          }
          // For input, allow normal behavior (text selection)
          if (target === editInput) {
            e.stopPropagation();
            return;
          }
          // Block other mousedown in edit mode
          e.stopPropagation();
          return;
        }
        
        // Not editing - prevent ProseMirror selection issues
        e.preventDefault();
        e.stopPropagation();
      });

      dom.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!isEditing) {
          e.preventDefault();
        }
      });

      // Prevent drag events on input
      editInput.addEventListener("dragstart", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      editInput.addEventListener("input", (e) => {
        currentLatex = (e.target as HTMLInputElement).value;
      });

      editInput.addEventListener("blur", () => {
        if (!isDestroyed) saveAndRender();
      });

      editInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          editInput.blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          currentLatex = node.attrs.latex || "";
          isEditing = false;
          renderMath();
        }
        e.stopPropagation();
      });

      renderMath();

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "inlineMath") return false;
          currentLatex = updatedNode.attrs.latex || "";
          if (!isEditing) renderMath();
          return true;
        },
        selectNode: () => {
          if (!isDestroyed) dom.classList.add("ProseMirror-selectednode");
        },
        deselectNode: () => {
          if (!isDestroyed) dom.classList.remove("ProseMirror-selectednode");
        },
        destroy: () => { isDestroyed = true; },
      };
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|[^$\\])\$([^$\n]+)\$/,
        handler: ({ range, match, chain }) => {
          const latex = match[1];
          if (!latex || latex.trim() === "") return null;
          const fullMatch = match[0];
          const hasLeadingChar = fullMatch.length > latex.length + 2;
          const start = hasLeadingChar ? range.from + 1 : range.from;
          chain()
            .deleteRange({ from: start, to: range.to })
            .insertContentAt(start, { type: "inlineMath", attrs: { latex: latex.trim() } })
            .run();
        },
      }),
      new InputRule({
        find: /\\\(([^)]+)\\\)$/,
        handler: ({ range, match, chain }) => {
          const latex = match[1];
          if (!latex || latex.trim() === "") return null;
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .insertContentAt(range.from, { type: "inlineMath", attrs: { latex: latex.trim() } })
            .run();
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertInlineMath: (latex: string = "") => ({ chain }: { chain: any }) => {
        return chain().insertContent({ type: "inlineMath", attrs: { latex } }).run();
      },
    } as any;
  },
});


/**
 * Block Math Node ($$...$$)
 */
export const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      latex: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="block-math"]',
        getAttrs: (dom) => ({
          latex: (dom as HTMLElement).getAttribute("data-latex") || "",
        }),
      },
      {
        tag: 'div.katex-display',
        getAttrs: (dom) => {
          const annotation = (dom as HTMLElement).querySelector('annotation[encoding="application/x-tex"]');
          return { latex: annotation?.textContent || "" };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "block-math",
        "data-latex": node.attrs.latex,
        class: "block-math-node",
      }),
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "block-math";
      dom.setAttribute("data-type", "block-math");
      dom.setAttribute("contenteditable", "false");

      let isEditing = false;
      let currentLatex = node.attrs.latex || "";
      let isDestroyed = false;

      // Edit wrapper with drag handle
      const editWrapper = document.createElement("div");
      editWrapper.className = "math-edit-wrapper block";
      
      const dragHandle = document.createElement("div");
      dragHandle.className = "math-drag-handle block";
      dragHandle.innerHTML = "⋮⋮";
      dragHandle.title = "Drag to move";
      dragHandle.draggable = true;

      const editTextarea = document.createElement("textarea");
      editTextarea.className = "math-edit-textarea";
      editTextarea.spellcheck = false;
      editTextarea.rows = 3;

      const renderContainer = document.createElement("div");
      renderContainer.className = "math-render block-math-render";

      const saveAndRender = () => {
        if (isDestroyed) return;
        isEditing = false;
        dom.draggable = true; // Re-enable dragging when not editing
        const pos = safeGetPos(getPos);
        safeUpdateAttributes(editor, "blockMath", pos, { latex: currentLatex });
        renderMath();
      };

      const renderMath = () => {
        if (isDestroyed) return;
        dom.innerHTML = "";
        
        if (isEditing) {
          dom.draggable = false; // Disable dragging when editing
          dom.classList.add("editing");
          editTextarea.value = currentLatex;
          editWrapper.innerHTML = "";
          editWrapper.appendChild(dragHandle);
          editWrapper.appendChild(editTextarea);
          dom.appendChild(editWrapper);
          setTimeout(() => {
            if (!isDestroyed) {
              editTextarea.focus();
              editTextarea.selectionStart = editTextarea.value.length;
              editTextarea.selectionEnd = editTextarea.value.length;
              editTextarea.style.height = "auto";
              editTextarea.style.height = Math.max(80, editTextarea.scrollHeight) + "px";
            }
          }, 10);
        } else {
          dom.draggable = true;
          dom.classList.remove("editing");
          if (currentLatex) {
            renderContainer.innerHTML = renderLatexToHtml(currentLatex, true);
            dom.appendChild(renderContainer);
          } else {
            dom.innerHTML = '<div class="math-placeholder">$$block math$$</div>';
          }
        }
      };

      dom.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isEditing && !isDestroyed) {
          isEditing = true;
          renderMath();
        }
      });

      // Handle mousedown - critical for text selection vs drag
      dom.addEventListener("mousedown", (e) => {
        const target = e.target as HTMLElement;
        
        // In edit mode, only allow drag from handle
        if (isEditing) {
          if (target === dragHandle || dragHandle.contains(target)) {
            // Allow drag from handle
            return;
          }
          // For textarea, allow normal behavior (text selection)
          if (target === editTextarea) {
            e.stopPropagation();
            return;
          }
          // Block other mousedown in edit mode
          e.stopPropagation();
          return;
        }
        
        // Not editing - prevent ProseMirror selection issues
        e.preventDefault();
        e.stopPropagation();
      });

      dom.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!isEditing) {
          e.preventDefault();
        }
      });

      // Prevent drag events on textarea
      editTextarea.addEventListener("dragstart", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      editTextarea.addEventListener("input", (e) => {
        currentLatex = (e.target as HTMLTextAreaElement).value;
        editTextarea.style.height = "auto";
        editTextarea.style.height = Math.max(80, editTextarea.scrollHeight) + "px";
      });

      editTextarea.addEventListener("blur", () => {
        if (!isDestroyed) saveAndRender();
      });

      editTextarea.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          currentLatex = node.attrs.latex || "";
          isEditing = false;
          renderMath();
        }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          editTextarea.blur();
        }
        e.stopPropagation();
      });

      renderMath();

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "blockMath") return false;
          currentLatex = updatedNode.attrs.latex || "";
          if (!isEditing) renderMath();
          return true;
        },
        selectNode: () => {
          if (!isDestroyed) dom.classList.add("ProseMirror-selectednode");
        },
        deselectNode: () => {
          if (!isDestroyed) dom.classList.remove("ProseMirror-selectednode");
        },
        destroy: () => { isDestroyed = true; },
      };
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$([^$]+)\$\$/,
        handler: ({ range, match, chain }) => {
          const latex = match[1];
          if (!latex || latex.trim() === "") return null;
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .insertContentAt(range.from, { type: "blockMath", attrs: { latex: latex.trim() } })
            .run();
        },
      }),
      new InputRule({
        find: /^\\\[([^\]]+)\\\]$/,
        handler: ({ range, match, chain }) => {
          const latex = match[1];
          if (!latex || latex.trim() === "") return null;
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .insertContentAt(range.from, { type: "blockMath", attrs: { latex: latex.trim() } })
            .run();
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertBlockMath: (latex: string = "") => ({ chain }: { chain: any }) => {
        return chain().insertContent({ type: "blockMath", attrs: { latex } }).run();
      },
    } as any;
  },
});
