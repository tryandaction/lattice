/**
 * LaTeX and Markdown Paste Handler Extension for Tiptap
 * 
 * Detects pasted LaTeX content and wraps it in math nodes.
 * Also handles pasted markdown content with math delimiters.
 * Converts markdown syntax to proper Tiptap nodes.
 * 
 * Supports both KaTeX (inlineMath/blockMath) and MathLive (inlineMathLive/blockMathLive) nodes.
 */

import { Extension, Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { detectLatexPatterns } from "@/lib/markdown-converter";

/**
 * Detect which math node types are available in the editor schema
 */
function getMathNodeTypes(editor: Editor): { inline: string; block: string } {
  const schema = editor.schema;
  
  // Check for MathLive nodes first (preferred if both are available)
  const hasInlineMathLive = schema.nodes.inlineMathLive !== undefined;
  const hasBlockMathLive = schema.nodes.blockMathLive !== undefined;
  
  // Check for KaTeX nodes
  const hasInlineMath = schema.nodes.inlineMath !== undefined;
  const hasBlockMath = schema.nodes.blockMath !== undefined;
  
  // Prefer MathLive if available, otherwise use KaTeX
  return {
    inline: hasInlineMathLive ? "inlineMathLive" : (hasInlineMath ? "inlineMath" : "inlineMath"),
    block: hasBlockMathLive ? "blockMathLive" : (hasBlockMath ? "blockMath" : "blockMath"),
  };
}

/**
 * Check if text is a block-level LaTeX expression
 */
function isBlockLatex(text: string): boolean {
  const trimmed = text.trim();
  
  // Check for display math indicators
  if (trimmed.startsWith("\\[") || trimmed.startsWith("$$")) {
    return true;
  }
  
  // Check for environment blocks
  if (/\\begin\{(equation|align|gather|matrix|pmatrix|bmatrix|cases)\*?\}/.test(trimmed)) {
    return true;
  }
  
  // Check for multi-line content with LaTeX
  if (trimmed.includes("\n") && detectLatexPatterns(trimmed)) {
    return true;
  }
  
  return false;
}

/**
 * Clean LaTeX content by removing existing delimiters
 */
function cleanLatexContent(text: string): string {
  let cleaned = text.trim();
  
  // Remove $$ delimiters
  if (cleaned.startsWith("$$") && cleaned.endsWith("$$")) {
    cleaned = cleaned.slice(2, -2).trim();
  }
  // Remove $ delimiters (single)
  else if (cleaned.startsWith("$") && cleaned.endsWith("$") && !cleaned.slice(1, -1).includes("$")) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  // Remove \[ \] delimiters
  else if (cleaned.startsWith("\\[") && cleaned.endsWith("\\]")) {
    cleaned = cleaned.slice(2, -2).trim();
  }
  // Remove \( \) delimiters
  else if (cleaned.startsWith("\\(") && cleaned.endsWith("\\)")) {
    cleaned = cleaned.slice(2, -2).trim();
  }
  
  return cleaned;
}

/**
 * Check if text contains markdown with math
 */
function containsMarkdownMath(text: string): boolean {
  // Check for inline math $...$
  if (/(?<!\$)\$(?!\$)[^$\n]+\$(?!\$)/.test(text)) {
    return true;
  }
  // Check for block math $$...$$
  if (/\$\$[^$]+\$\$/.test(text)) {
    return true;
  }
  return false;
}

/**
 * Check if text looks like markdown
 */
function looksLikeMarkdown(text: string): boolean {
  // Check for common markdown patterns
  const markdownPatterns = [
    /^#{1,6}\s+/m,           // Headings
    /^\s*[-*+]\s+/m,         // Unordered lists
    /^\s*\d+\.\s+/m,         // Ordered lists
    /^\s*>\s+/m,             // Blockquotes
    /```[\s\S]*```/,         // Code blocks
    /`[^`]+`/,               // Inline code
    /\*\*[^*]+\*\*/,         // Bold
    /\*[^*]+\*/,             // Italic
    /\[.+\]\(.+\)/,          // Links
    /^\|.+\|$/m,             // Tables
  ];
  
  return markdownPatterns.some(pattern => pattern.test(text));
}

interface ParsedNode {
  type: string;
  attrs?: Record<string, any>;
  content?: ParsedNode[] | string;
  text?: string;
}

interface MathTypes {
  inline: string;
  block: string;
}


/**
 * Parse markdown text and convert to Tiptap-compatible nodes
 */
function parseMarkdownContent(text: string, mathTypes: MathTypes): ParsedNode[] {
  const result: ParsedNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // Skip empty lines
    if (!line.trim()) {
      i++;
      continue;
    }
    
    // Check for code blocks
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      result.push({
        type: "codeBlock",
        attrs: { language: lang || null },
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }
    
    // Check for block math $$...$$
    if (line.trim().startsWith("$$")) {
      const mathLines: string[] = [line.trim().slice(2)];
      if (!line.trim().endsWith("$$") || line.trim() === "$$") {
        i++;
        while (i < lines.length && !lines[i].trim().endsWith("$$")) {
          mathLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          mathLines.push(lines[i].trim().slice(0, -2));
          i++;
        }
      } else {
        mathLines[0] = mathLines[0].slice(0, -2);
        i++;
      }
      result.push({
        type: mathTypes.block,
        attrs: { latex: mathLines.join("\n").trim() },
      });
      continue;
    }
    
    // Check for headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      result.push({
        type: "heading",
        attrs: { level },
        content: parseInlineContent(headingMatch[2], mathTypes),
      });
      i++;
      continue;
    }
    
    // Check for blockquotes
    if (line.trim().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().slice(1).trim());
        i++;
      }
      result.push({
        type: "blockquote",
        content: [{
          type: "paragraph",
          content: parseInlineContent(quoteLines.join(" "), mathTypes),
        }],
      });
      continue;
    }
    
    // Check for unordered lists
    if (/^\s*[-*+]\s+/.test(line)) {
      const listItems: ParsedNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*+]\s+/, "");
        listItems.push({
          type: "listItem",
          content: [{
            type: "paragraph",
            content: parseInlineContent(itemText, mathTypes),
          }],
        });
        i++;
      }
      result.push({
        type: "bulletList",
        content: listItems,
      });
      continue;
    }
    
    // Check for ordered lists
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems: ParsedNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*\d+\.\s+/, "");
        listItems.push({
          type: "listItem",
          content: [{
            type: "paragraph",
            content: parseInlineContent(itemText, mathTypes),
          }],
        });
        i++;
      }
      result.push({
        type: "orderedList",
        content: listItems,
      });
      continue;
    }
    
    // Default: paragraph
    result.push({
      type: "paragraph",
      content: parseInlineContent(line, mathTypes),
    });
    i++;
  }
  
  return result;
}

/**
 * Parse inline content (bold, italic, code, math, links)
 */
function parseInlineContent(text: string, mathTypes: MathTypes): ParsedNode[] {
  const result: ParsedNode[] = [];
  
  // Process inline elements
  const inlineRegex = /(\$\$[^$]+\$\$|\$[^$\n]+\$|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[.+?\]\(.+?\))/g;
  let lastIndex = 0;
  let match;
  
  while ((match = inlineRegex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore) {
        result.push({ type: "text", text: textBefore });
      }
    }
    
    const matched = match[1];
    
    // Block math $$...$$
    if (matched.startsWith("$$") && matched.endsWith("$$")) {
      result.push({
        type: mathTypes.block,
        attrs: { latex: matched.slice(2, -2).trim() },
      });
    }
    // Inline math $...$
    else if (matched.startsWith("$") && matched.endsWith("$")) {
      result.push({
        type: mathTypes.inline,
        attrs: { latex: matched.slice(1, -1).trim() },
      });
    }
    // Bold **...**
    else if (matched.startsWith("**") && matched.endsWith("**")) {
      result.push({
        type: "text",
        text: matched.slice(2, -2),
        marks: [{ type: "bold" }],
      } as any);
    }
    // Italic *...*
    else if (matched.startsWith("*") && matched.endsWith("*")) {
      result.push({
        type: "text",
        text: matched.slice(1, -1),
        marks: [{ type: "italic" }],
      } as any);
    }
    // Inline code `...`
    else if (matched.startsWith("`") && matched.endsWith("`")) {
      result.push({
        type: "text",
        text: matched.slice(1, -1),
        marks: [{ type: "code" }],
      } as any);
    }
    // Links [text](url)
    else if (matched.startsWith("[")) {
      const linkMatch = matched.match(/\[(.+?)\]\((.+?)\)/);
      if (linkMatch) {
        result.push({
          type: "text",
          text: linkMatch[1],
          marks: [{ type: "link", attrs: { href: linkMatch[2] } }],
        } as any);
      }
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    if (remainingText) {
      result.push({ type: "text", text: remainingText });
    }
  }
  
  // If no inline elements found, return the whole text
  if (result.length === 0 && text) {
    result.push({ type: "text", text });
  }
  
  return result;
}


export const LatexPasteHandler = Extension.create({
  name: "latexPasteHandler",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey("latexPasteHandler"),
        
        props: {
          handlePaste(view, event) {
            // Get pasted text
            const text = event.clipboardData?.getData("text/plain");
            
            if (!text) {
              return false;
            }

            // Detect which math node types are available
            const mathTypes = getMathNodeTypes(editor);

            // Check if it looks like markdown with structure
            if (looksLikeMarkdown(text) || containsMarkdownMath(text)) {
              event.preventDefault();
              
              const nodes = parseMarkdownContent(text, mathTypes);
              
              // Insert parsed content with error handling
              nodes.forEach((node) => {
                try {
                  editor.chain().focus().insertContent(node as any).run();
                } catch (error) {
                  console.warn("[LatexPasteHandler] Failed to insert node:", node.type, error);
                }
              });
              
              return true;
            }

            // Check if it contains raw LaTeX patterns (without delimiters)
            if (detectLatexPatterns(text)) {
              // Clean the LaTeX content
              const cleanedLatex = cleanLatexContent(text);
              
              // Determine if it should be block or inline math
              const isBlock = isBlockLatex(text);

              // Prevent default paste
              event.preventDefault();

              // Insert appropriate math node using detected types
              try {
                if (isBlock) {
                  editor
                    .chain()
                    .focus()
                    .insertContent({
                      type: mathTypes.block,
                      attrs: { latex: cleanedLatex },
                    })
                    .run();
                } else {
                  editor
                    .chain()
                    .focus()
                    .insertContent({
                      type: mathTypes.inline,
                      attrs: { latex: cleanedLatex },
                    })
                    .run();
                }
              } catch (error) {
                console.warn("[LatexPasteHandler] Failed to insert math node:", error);
              }

              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
