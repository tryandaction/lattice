/**
 * MathLive Node Component for Tiptap
 * 
 * Wraps the MathLive web component as a Tiptap NodeView with:
 * - Structure-first editing (TeXmacs/Mogan inspired)
 * - Tab cycling navigation through placeholders
 * - Smart mode for function recognition
 * - Smart fence for auto-pairing delimiters
 */

"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, NodeViewProps, ReactNodeViewRenderer } from "@tiptap/react";
import { useEffect, useRef, useCallback, useState } from "react";
import type { MathfieldElement } from "mathlive";

// MathLive configuration for the "Mogan" experience
const MATHLIVE_CONFIG = {
  smartMode: true,           // Interpret sin as \sin, etc.
  smartFence: true,          // Auto-pair parentheses
  virtualKeyboardMode: "manual" as const,  // Allow manual toggle of virtual keyboard
  keypressSound: null,       // No sounds
  plonkSound: null,          // No sounds
};

// Flag to track if global MathLive config has been applied
let mathLiveGlobalConfigApplied = false;

/**
 * Apply global MathLive configuration to disable sounds
 * This is called once when the first MathLive element is created
 */
async function applyGlobalMathLiveConfig() {
  if (mathLiveGlobalConfigApplied) return;
  
  try {
    const mathlive = await import("mathlive");
    // Use MathfieldElement.soundsDirectory to disable sounds globally
    // Setting to empty string or null disables sound loading
    if (mathlive.MathfieldElement) {
      // soundsDirectory is a static property that may not be in types
      (mathlive.MathfieldElement as any).soundsDirectory = null;
    }
    mathLiveGlobalConfigApplied = true;
  } catch (e) {
    // Ignore errors during global config
  }
}

interface LatticeMathNodeProps {
  latex: string;
  displayMode: "inline" | "block";
  onLatexChange: (latex: string) => void;
  onFocusExit: (direction: "left" | "right") => void;
}

/**
 * React component wrapping MathLive mathfield
 */
function LatticeMathNode({ 
  latex, 
  displayMode, 
  onLatexChange, 
  onFocusExit 
}: LatticeMathNodeProps) {
  const mathfieldRef = useRef<MathfieldElement | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Initialize MathLive (lazy load)
  useEffect(() => {
    let mounted = true;

    const initMathLive = async () => {
      // Apply global config first (only runs once)
      await applyGlobalMathLiveConfig();
      
      // Dynamically import MathLive to avoid SSR issues
      const mathlive = await import("mathlive");
      
      if (!mounted || !containerRef.current) return;

      // Create mathfield element
      const mf = new mathlive.MathfieldElement();
      
      // Apply configuration
      mf.smartMode = MATHLIVE_CONFIG.smartMode;
      mf.smartFence = MATHLIVE_CONFIG.smartFence;
      // @ts-expect-error - virtualKeyboardMode exists but types may be outdated
      mf.virtualKeyboardMode = MATHLIVE_CONFIG.virtualKeyboardMode;
      
      // Disable all sounds to prevent 404 errors
      // Sound properties may not be in types
      (mf as any).keypressSound = null;
      (mf as any).plonkSound = null;
      
      // Also try setting sounds directory to empty
      try {
        if ((mf as any).soundsDirectory !== undefined) {
          (mf as any).soundsDirectory = null;
        }
      } catch (e) {
        // Ignore
      }
      
      // Set initial value
      mf.value = latex;
      
      // Style based on display mode
      if (displayMode === "block") {
        mf.style.display = "block";
        mf.style.textAlign = "center";
        mf.style.padding = "1rem 0";
        mf.style.fontSize = "1.2em";
      } else {
        mf.style.display = "inline-block";
        mf.style.verticalAlign = "middle";
      }
      
      // Common styles
      mf.style.outline = "none";
      mf.style.minWidth = "1em";
      
      // Append to container
      containerRef.current.appendChild(mf);
      mathfieldRef.current = mf;
      setIsLoaded(true);

      // Handle input changes
      mf.addEventListener("input", () => {
        onLatexChange(mf.value);
      });

      // Handle blur
      mf.addEventListener("blur", () => {
        onLatexChange(mf.value);
      });
    };

    initMathLive();

    return () => {
      mounted = false;
      if (mathfieldRef.current && containerRef.current) {
        containerRef.current.removeChild(mathfieldRef.current);
        mathfieldRef.current = null;
      }
    };
  }, [displayMode]); // Only re-init on display mode change

  // Update value when latex prop changes (external update)
  useEffect(() => {
    if (mathfieldRef.current && mathfieldRef.current.value !== latex) {
      mathfieldRef.current.value = latex;
    }
  }, [latex]);

  // Handle Tab cycling navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const mf = mathfieldRef.current;
    if (!mf) return;

    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey) {
        // Shift+Tab: move to previous placeholder or exit left
        const moved = mf.executeCommand("moveToPreviousPlaceholder");
        if (!moved) {
          // At left boundary, exit the node
          onFocusExit("left");
        }
      } else {
        // Tab: move to next placeholder or exit right
        const moved = mf.executeCommand("moveToNextPlaceholder");
        if (!moved) {
          // No more placeholders, try to move to right boundary
          // Check if we're already at the end
          const selection = mf.selection;
          const isAtEnd = selection.ranges[0]?.[1] === mf.value.length;
          
          if (isAtEnd) {
            // Already at right boundary, exit the node
            onFocusExit("right");
          } else {
            // Move to end
            mf.executeCommand("moveToMathfieldEnd");
          }
        }
      }
    } else if (e.key === "Escape") {
      // Escape: exit the node
      e.preventDefault();
      e.stopPropagation();
      onFocusExit("right");
    }
  }, [onFocusExit]);

  return (
    <span
      ref={containerRef}
      className={`mathlive-container ${displayMode}`}
      onKeyDown={handleKeyDown}
      data-display-mode={displayMode}
    >
      {!isLoaded && (
        <span className="mathlive-loading">
          {displayMode === "block" ? "$$...$$" : "$...$"}
        </span>
      )}
    </span>
  );
}

/**
 * Check if latex content is empty or only whitespace
 */
function isLatexEmpty(latex: string): boolean {
  if (!latex) return true;
  // Remove whitespace and check if empty
  const trimmed = latex.trim();
  if (!trimmed) return true;
  // Check for placeholder-only content (like \placeholder{})
  if (/^\\placeholder\{[^}]*\}$/.test(trimmed)) return true;
  return false;
}

/**
 * Tiptap NodeView wrapper for inline math
 */
function InlineMathLiveView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const handleLatexChange = useCallback((latex: string) => {
    updateAttributes({ latex });
  }, [updateAttributes]);

  const handleFocusExit = useCallback((direction: "left" | "right") => {
    // Move cursor out of the node
    if (typeof getPos === 'function') {
      const pos = getPos();
      if (typeof pos === 'number') {
        const targetPos = direction === 'left' ? pos : pos + node.nodeSize;
        try {
          editor.commands.setTextSelection(targetPos);
          editor.commands.focus();
        } catch (e) {
          // Ignore selection errors
        }
      }
    }
  }, [editor, getPos, node.nodeSize]);

  const isEmpty = isLatexEmpty(node.attrs.latex);

  return (
    <NodeViewWrapper
      as="span"
      className={`inline-mathlive-wrapper ${selected ? "selected" : ""} ${isEmpty ? "empty" : "has-content"}`}
      data-type="inline-mathlive"
      data-empty={isEmpty ? "true" : "false"}
    >
      <LatticeMathNode
        latex={node.attrs.latex || ""}
        displayMode="inline"
        onLatexChange={handleLatexChange}
        onFocusExit={handleFocusExit}
      />
    </NodeViewWrapper>
  );
}

/**
 * Tiptap NodeView wrapper for block math
 */
function BlockMathLiveView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const handleLatexChange = useCallback((latex: string) => {
    updateAttributes({ latex });
  }, [updateAttributes]);

  const handleFocusExit = useCallback((direction: "left" | "right") => {
    // Move cursor out of the node
    if (typeof getPos === 'function') {
      const pos = getPos();
      if (typeof pos === 'number') {
        const targetPos = direction === 'left' ? pos : pos + node.nodeSize;
        try {
          editor.commands.setTextSelection(targetPos);
          editor.commands.focus();
        } catch (e) {
          // Ignore selection errors
        }
      }
    }
  }, [editor, getPos, node.nodeSize]);

  const isEmpty = isLatexEmpty(node.attrs.latex);

  return (
    <NodeViewWrapper
      as="div"
      className={`block-mathlive-wrapper ${selected ? "selected" : ""} ${isEmpty ? "empty" : "has-content"}`}
      data-type="block-mathlive"
      data-empty={isEmpty ? "true" : "false"}
    >
      <LatticeMathNode
        latex={node.attrs.latex || ""}
        displayMode="block"
        onLatexChange={handleLatexChange}
        onFocusExit={handleFocusExit}
      />
    </NodeViewWrapper>
  );
}

/**
 * Inline MathLive Node Extension ($...$)
 */
export const InlineMathLive = Node.create({
  name: "inlineMathLive",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false, // Disable dragging to prevent selection issues

  addAttributes() {
    return {
      latex: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="inline-mathlive"]',
        getAttrs: (dom) => ({
          latex: (dom as HTMLElement).getAttribute("data-latex") || "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inline-mathlive",
        "data-latex": node.attrs.latex,
        class: "inline-mathlive-node",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathLiveView, {
      // Prevent ProseMirror from handling clicks on the node
      stopEvent: () => {
        // Let the MathLive component handle all events
        return true;
      },
    });
  },

  addCommands() {
    return {
      insertInlineMathLive: (latex: string = "") => ({ chain }: { chain: any }) => {
        return chain()
          .insertContent({ type: "inlineMathLive", attrs: { latex } })
          .run();
      },
    } as any;
  },
});

/**
 * Block MathLive Node Extension ($$...$$)
 */
export const BlockMathLive = Node.create({
  name: "blockMathLive",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false, // Disable dragging to prevent selection issues

  addAttributes() {
    return {
      latex: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="block-mathlive"]',
        getAttrs: (dom) => ({
          latex: (dom as HTMLElement).getAttribute("data-latex") || "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "block-mathlive",
        "data-latex": node.attrs.latex,
        class: "block-mathlive-node",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockMathLiveView, {
      // Prevent ProseMirror from handling clicks on the node
      stopEvent: () => {
        // Let the MathLive component handle all events
        return true;
      },
    });
  },

  addCommands() {
    return {
      insertBlockMathLive: (latex: string = "") => ({ chain }: { chain: any }) => {
        return chain()
          .insertContent({ type: "blockMathLive", attrs: { latex } })
          .run();
      },
    } as any;
  },
});

// Export configuration for testing
export { MATHLIVE_CONFIG };
