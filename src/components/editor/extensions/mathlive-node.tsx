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

type MathfieldElementWithSounds = MathfieldElement & {
  keypressSound?: string | null;
  plonkSound?: string | null;
  soundsDirectory?: string | null;
};

type MathfieldElementConstructor = {
  new (): MathfieldElement;
  soundsDirectory?: string | null;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathLive: {
      insertInlineMathLive: (latex?: string) => ReturnType;
      insertBlockMathLive: (latex?: string) => ReturnType;
    };
  }
}

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
    const MathfieldCtor = mathlive.MathfieldElement as MathfieldElementConstructor | undefined;
    if (MathfieldCtor && "soundsDirectory" in MathfieldCtor) {
      MathfieldCtor.soundsDirectory = null;
    }
    mathLiveGlobalConfigApplied = true;
  } catch (_error) {
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
  const onLatexChangeRef = useRef(onLatexChange);
  const initialLatexRef = useRef(latex);

  useEffect(() => {
    onLatexChangeRef.current = onLatexChange;
  }, [onLatexChange]);

  useEffect(() => {
    initialLatexRef.current = latex;
  }, [latex]);

  // Initialize MathLive (lazy load)
  useEffect(() => {
    let mounted = true;
    let containerEl: HTMLSpanElement | null = null;
    let mathfieldEl: MathfieldElementWithSounds | null = null;
    let handleInput: (() => void) | null = null;
    let handleBlur: (() => void) | null = null;

    const initMathLive = async () => {
      // Apply global config first (only runs once)
      await applyGlobalMathLiveConfig();
      
      // Dynamically import MathLive to avoid SSR issues
      const mathlive = await import("mathlive");
      
      if (!mounted) return;
      const container = containerRef.current;
      if (!container) return;
      containerEl = container;

      // Create mathfield element
      const MathfieldCtor = mathlive.MathfieldElement as MathfieldElementConstructor;
      const mf = new MathfieldCtor() as MathfieldElementWithSounds;
      mathfieldEl = mf;
      
      // Apply configuration
      mf.smartMode = MATHLIVE_CONFIG.smartMode;
      mf.smartFence = MATHLIVE_CONFIG.smartFence;
      // @ts-expect-error - virtualKeyboardMode exists but types may be outdated
      mf.virtualKeyboardMode = MATHLIVE_CONFIG.virtualKeyboardMode;
      
      // Disable all sounds to prevent 404 errors
      // Sound properties may not be in types
      mf.keypressSound = null;
      mf.plonkSound = null;
      
      // Also try setting sounds directory to empty
      try {
        if (mf.soundsDirectory !== undefined) {
          mf.soundsDirectory = null;
        }
      } catch (_error) {
        // Ignore
      }
      
      // Set initial value
      mf.value = initialLatexRef.current;
      
      // Style based on display mode
      if (displayMode === "block") {
        mf.style.display = "block";
        mf.style.textAlign = "center";
        mf.style.padding = "1rem 0";
        mf.style.fontSize = "1.2em";
      } else {
        mf.style.display = "inline-block";
        // Use baseline alignment for better text flow
        mf.style.verticalAlign = "baseline";
        // Adjust position slightly for visual alignment
        mf.style.position = "relative";
        mf.style.top = "0.1em";
      }

      // Common styles
      mf.style.outline = "none";
      mf.style.minWidth = "1em";
      // Inherit color for dark mode support
      mf.style.color = "inherit";
      
      // Append to container
      container.appendChild(mf);
      mathfieldRef.current = mf;
      if (mounted) {
        setIsLoaded(true);
      }

      // Handle input changes
      handleInput = () => {
        onLatexChangeRef.current(mf.value);
      };
      mf.addEventListener("input", handleInput);

      // Handle blur
      handleBlur = () => {
        onLatexChangeRef.current(mf.value);
      };
      mf.addEventListener("blur", handleBlur);
    };

    initMathLive();

    return () => {
      mounted = false;
      if (mathfieldEl) {
        if (handleInput) {
          mathfieldEl.removeEventListener("input", handleInput);
        }
        if (handleBlur) {
          mathfieldEl.removeEventListener("blur", handleBlur);
        }
        if (containerEl && containerEl.contains(mathfieldEl)) {
          containerEl.removeChild(mathfieldEl);
        }
      }
      if (mathfieldRef.current === mathfieldEl) {
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
        try {
          const moved = mf.executeCommand("moveToPreviousPlaceholder");
          // executeCommand may return void/undefined, so check if cursor actually moved
          if (!moved) {
            onFocusExit("left");
          }
        } catch {
          onFocusExit("left");
        }
      } else {
        // Tab: move to next placeholder or exit right
        try {
          const moved = mf.executeCommand("moveToNextPlaceholder");
          if (!moved) {
            // No more placeholders, check if we're at the end
            const selection = mf.selection;
            const atEnd = !selection || selection.ranges.length === 0 ||
              (selection.ranges[0]?.[1] ?? 0) >= mf.value.length;

            if (atEnd) {
              onFocusExit("right");
            } else {
              mf.executeCommand("moveToMathfieldEnd");
            }
          }
        } catch {
          onFocusExit("right");
        }
      }
    } else if (e.key === "Escape") {
      // Escape: exit the node
      e.preventDefault();
      e.stopPropagation();
      onFocusExit("right");
    }
  }, [onFocusExit]);

  // Handle click to focus the math field
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (mathfieldRef.current) {
      mathfieldRef.current.focus();
    }
  }, []);

  return (
    <span
      ref={containerRef}
      className={`mathlive-container ${displayMode}`}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
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
        } catch (_error) {
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
        } catch (_error) {
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
      insertInlineMathLive:
        (latex: string = "") =>
        ({ commands }) => {
          return commands.insertContent({ type: "inlineMathLive", attrs: { latex } });
        },
    };
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
      insertBlockMathLive:
        (latex: string = "") =>
        ({ commands }) => {
          return commands.insertContent({ type: "blockMathLive", attrs: { latex } });
        },
    };
  },
});

// Export configuration for testing
export { MATHLIVE_CONFIG };
