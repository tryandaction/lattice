/**
 * Code Block with Syntax Highlighting Extension for Tiptap
 * 
 * Extends the default code block with syntax highlighting using lowlight.
 */

import { Node, mergeAttributes, textblockTypeInputRule } from "@tiptap/core";

// Language detection patterns
const LANGUAGE_PATTERNS: Record<string, RegExp[]> = {
  python: [
    /^(import|from)\s+\w+/m,
    /^def\s+\w+\s*\(/m,
    /^class\s+\w+/m,
    /print\s*\(/,
    /__init__/,
  ],
  javascript: [
    /^(const|let|var)\s+\w+\s*=/m,
    /^function\s+\w+/m,
    /=>\s*{/,
    /console\.(log|error|warn)/,
    /^import\s+.*from\s+['"]/m,
  ],
  typescript: [
    /:\s*(string|number|boolean|any|void)\b/,
    /interface\s+\w+/,
    /type\s+\w+\s*=/,
    /<\w+>/,
  ],
  html: [
    /^<!DOCTYPE/i,
    /<html/i,
    /<\/?\w+[^>]*>/,
  ],
  css: [
    /^\s*\.\w+\s*{/m,
    /^\s*#\w+\s*{/m,
    /:\s*(flex|grid|block|inline)/,
    /background(-color)?:/,
  ],
  json: [
    /^\s*{[\s\S]*"[\w-]+":/m,
    /^\s*\[[\s\S]*{/m,
  ],
  latex: [
    /\\(begin|end)\{/,
    /\\(frac|sum|int|sqrt)/,
    /\\(alpha|beta|gamma)/,
  ],
  sql: [
    /^SELECT\s+/im,
    /^INSERT\s+INTO/im,
    /^UPDATE\s+\w+\s+SET/im,
    /^CREATE\s+(TABLE|DATABASE)/im,
  ],
  bash: [
    /^#!/,
    /^\$\s+/m,
    /\|\s*grep/,
    /&&\s*\w+/,
  ],
  cpp: [
    /#include\s*</,
    /std::/,
    /int\s+main\s*\(/,
    /cout\s*<</,
  ],
};

/**
 * Detect language from code content
 */
export function detectLanguage(code: string): string | null {
  for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(code)) {
        return lang;
      }
    }
  }
  return null;
}

/**
 * Code Block with Highlighting Extension
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
          if (!attributes.language) return {};
          return { class: `language-${attributes.language}` };
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
    return [
      "pre",
      mergeAttributes(HTMLAttributes, {
        class: `code-block ${HTMLAttributes.class || ""}`.trim(),
      }),
      ["code", {}, 0],
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "code-block-wrapper relative";

      const pre = document.createElement("pre");
      pre.className = "code-block rounded-lg bg-muted p-4 overflow-x-auto";
      pre.style.fontFamily = "var(--font-mono), ui-monospace, monospace";
      pre.style.fontSize = "0.875rem";
      pre.style.lineHeight = "1.5";

      const code = document.createElement("code");
      code.className = node.attrs.language ? `language-${node.attrs.language}` : "";
      code.textContent = node.textContent;

      // Language selector
      const langSelector = document.createElement("select");
      langSelector.className = "absolute top-2 right-2 text-xs bg-background border border-border rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity";
      langSelector.innerHTML = `
        <option value="">Auto</option>
        <option value="javascript">JavaScript</option>
        <option value="typescript">TypeScript</option>
        <option value="python">Python</option>
        <option value="html">HTML</option>
        <option value="css">CSS</option>
        <option value="json">JSON</option>
        <option value="sql">SQL</option>
        <option value="bash">Bash</option>
        <option value="cpp">C++</option>
        <option value="latex">LaTeX</option>
      `;
      langSelector.value = node.attrs.language || "";
      
      langSelector.addEventListener("change", (e) => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos !== null && pos !== undefined) {
          editor.chain().focus().updateAttributes("codeBlock", {
            language: (e.target as HTMLSelectElement).value || null,
          }).run();
        }
      });

      dom.classList.add("group");
      pre.appendChild(code);
      dom.appendChild(pre);
      dom.appendChild(langSelector);

      // Auto-detect language if not set
      if (!node.attrs.language && node.textContent) {
        const detected = detectLanguage(node.textContent);
        if (detected) {
          langSelector.value = detected;
          code.className = `language-${detected}`;
        }
      }

      return {
        dom,
        contentDOM: code,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "codeBlock") return false;
          
          const lang = updatedNode.attrs.language;
          code.className = lang ? `language-${lang}` : "";
          langSelector.value = lang || "";
          
          // Auto-detect if no language set
          if (!lang && updatedNode.textContent) {
            const detected = detectLanguage(updatedNode.textContent);
            if (detected) {
              code.className = `language-${detected}`;
            }
          }
          
          return true;
        },
      };
    };
  },

  addInputRules() {
    return [
      // ```language or ``` at start of line
      textblockTypeInputRule({
        find: /^```(\w+)?\s$/,
        type: this.type,
        getAttributes: (match) => ({
          language: match[1] || null,
        }),
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Tab to indent
      Tab: () => {
        if (this.editor.isActive("codeBlock")) {
          this.editor.commands.insertContent("  ");
          return true;
        }
        return false;
      },
      // Mod-` to toggle code block
      "Mod-`": () => {
        return this.editor.commands.toggleCodeBlock();
      },
    };
  },
});
