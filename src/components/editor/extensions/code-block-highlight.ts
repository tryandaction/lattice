/**
 * Code Block Highlight Extension for Tiptap
 * 
 * Provides syntax highlighting for code blocks using highlight.js
 * Features:
 * - Syntax highlighting for 15+ languages
 * - Language selector dropdown
 * - Copy button
 * - Line numbers (optional)
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import hljs from "highlight.js/lib/core";

// Register common languages
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import csharp from "highlight.js/lib/languages/csharp";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";
import latex from "highlight.js/lib/languages/latex";

// Register languages
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cs", csharp);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rb", ruby);
hljs.registerLanguage("php", php);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("kt", kotlin);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("latex", latex);
hljs.registerLanguage("tex", latex);

// Supported languages list for UI
export const SUPPORTED_LANGUAGES = [
  { value: "plaintext", label: "Plain Text" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "c", label: "C" },
  { value: "csharp", label: "C#" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "sql", label: "SQL" },
  { value: "bash", label: "Bash/Shell" },
  { value: "json", label: "JSON" },
  { value: "xml", label: "XML/HTML" },
  { value: "css", label: "CSS" },
  { value: "markdown", label: "Markdown" },
  { value: "yaml", label: "YAML" },
  { value: "latex", label: "LaTeX" },
];

/**
 * Highlight code using highlight.js
 */
function highlightCode(code: string, language: string | null): string {
  if (!language || language === "plaintext") {
    return escapeHtml(code);
  }

  try {
    const result = hljs.highlight(code, { language, ignoreIllegals: true });
    return result.value;
  } catch {
    // Fallback to plain text if language not supported
    return escapeHtml(code);
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Code Block with Syntax Highlighting
 */
export const CodeBlockHighlight = Node.create({
  name: "codeBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,

  addAttributes() {
    return {
      language: {
        default: null,
        parseHTML: (element) => {
          const classNames = element.className?.split(" ") || [];
          const langClass = classNames.find((c) => c.startsWith("language-"));
          return langClass ? langClass.replace("language-", "") : null;
        },
        renderHTML: (attributes) => {
          if (!attributes.language) {
            return {};
          }
          return {
            class: `language-${attributes.language}`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "pre",
        preserveWhitespace: "full",
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const language = node.attrs.language || "plaintext";
    const code = node.textContent;
    const highlighted = highlightCode(code, language);

    return [
      "div",
      { class: "code-block-wrapper", "data-language": language },
      [
        "div",
        { class: "code-block-header" },
        [
          "select",
          {
            class: "code-language-select",
            "data-language-select": "true",
          },
          ...SUPPORTED_LANGUAGES.map((lang) => [
            "option",
            { value: lang.value, ...(lang.value === language ? { selected: "selected" } : {}) },
            lang.label,
          ]),
        ],
        [
          "button",
          {
            class: "code-copy-btn",
            "data-copy-code": "true",
            title: "Copy code",
          },
          "Copy",
        ],
      ],
      [
        "pre",
        mergeAttributes(HTMLAttributes, { class: `language-${language}` }),
        ["code", { class: `hljs language-${language}` }],
      ],
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-c": () => this.editor.commands.setNode("codeBlock"),
      // Tab for indentation inside code block
      Tab: () => {
        if (this.editor.isActive("codeBlock")) {
          return this.editor.commands.insertContent("  ");
        }
        return false;
      },
      // Shift+Tab for outdent
      "Shift-Tab": () => {
        if (this.editor.isActive("codeBlock")) {
          // Simple outdent - remove leading spaces
          const { state } = this.editor;
          const { from } = state.selection;
          const $from = state.doc.resolve(from);
          const lineStart = from - $from.parentOffset;
          const lineText = state.doc.textBetween(lineStart, from);
          
          if (lineText.startsWith("  ")) {
            this.editor.commands.deleteRange({ from: lineStart, to: lineStart + 2 });
            return true;
          }
        }
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      // Syntax highlighting decoration plugin
      new Plugin({
        key: new PluginKey("codeBlockHighlight"),
        state: {
          init(_, { doc }) {
            return getDecorations(doc);
          },
          apply(tr, decorationSet, oldState, newState) {
            if (tr.docChanged) {
              return getDecorations(newState.doc);
            }
            return decorationSet;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
      // Event handler plugin for copy button and language select
      new Plugin({
        key: new PluginKey("codeBlockEvents"),
        props: {
          handleDOMEvents: {
            click(view, event) {
              const target = event.target as HTMLElement;
              
              // Handle copy button click
              if (target.hasAttribute("data-copy-code") || target.closest("[data-copy-code]")) {
                const wrapper = target.closest(".code-block-wrapper");
                const pre = wrapper?.querySelector("pre");
                const code = pre?.textContent || "";
                
                navigator.clipboard.writeText(code).then(() => {
                  const btn = target.closest("[data-copy-code]") || target;
                  const originalText = btn.textContent;
                  btn.textContent = "Copied!";
                  setTimeout(() => {
                    btn.textContent = originalText;
                  }, 2000);
                });
                
                return true;
              }
              
              return false;
            },
            change(view, event) {
              const target = event.target as HTMLSelectElement;
              
              // Handle language select change
              if (target.hasAttribute("data-language-select")) {
                const newLanguage = target.value;
                const wrapper = target.closest(".code-block-wrapper");
                
                if (wrapper) {
                  // Find the code block node position
                  const pre = wrapper.querySelector("pre");
                  if (pre) {
                    const pos = view.posAtDOM(pre, 0);
                    const $pos = view.state.doc.resolve(pos);
                    const node = $pos.parent;
                    
                    if (node.type.name === "codeBlock") {
                      const nodePos = $pos.before($pos.depth);
                      editor.chain()
                        .focus()
                        .setNodeSelection(nodePos)
                        .updateAttributes("codeBlock", { language: newLanguage })
                        .run();
                    }
                  }
                }
                
                return true;
              }
              
              return false;
            },
          },
        },
      }),
    ];
  },
});

/**
 * Generate decorations for syntax highlighting
 */
function getDecorations(doc: any): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node: any, pos: number) => {
    if (node.type.name === "codeBlock") {
      const language = node.attrs.language || "plaintext";
      const code = node.textContent;

      if (code && language !== "plaintext") {
        try {
          const result = hljs.highlight(code, { language, ignoreIllegals: true });
          
          // Parse highlighted HTML and create decorations
          const tokens = parseHighlightedTokens(result.value);
          let offset = pos + 1; // +1 for the node start

          tokens.forEach((token) => {
            if (token.className) {
              decorations.push(
                Decoration.inline(offset, offset + token.text.length, {
                  class: token.className,
                })
              );
            }
            offset += token.text.length;
          });
        } catch {
          // Ignore highlighting errors
        }
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}

interface HighlightToken {
  text: string;
  className: string | null;
}

/**
 * Parse highlight.js output into tokens
 */
function parseHighlightedTokens(html: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  const regex = /<span class="([^"]+)">([^<]*)<\/span>|([^<]+)/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    if (match[1] && match[2]) {
      // Span with class
      tokens.push({ text: decodeHtml(match[2]), className: match[1] });
    } else if (match[3]) {
      // Plain text
      tokens.push({ text: decodeHtml(match[3]), className: null });
    }
  }

  return tokens;
}

/**
 * Decode HTML entities
 */
function decodeHtml(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

export default CodeBlockHighlight;
