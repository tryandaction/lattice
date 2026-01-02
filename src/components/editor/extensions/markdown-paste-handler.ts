/**
 * Markdown Paste Handler Extension for Tiptap
 * 
 * Handles pasted markdown content and converts it to proper Tiptap nodes.
 * Uses the advanced markdown parser for comprehensive support.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { parseMarkdown, isMarkdown } from "@/lib/markdown-parser";

export const MarkdownPasteHandler = Extension.create({
  name: "markdownPasteHandler",
  
  // Lower priority so it runs after latex paste handler
  priority: 90,

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey("markdownPasteHandler"),
        
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain");
            
            if (!text || !isMarkdown(text)) {
              return false;
            }

            event.preventDefault();
            
            try {
              const nodes = parseMarkdown(text);
              
              // Insert all parsed nodes
              nodes.forEach((node) => {
                editor.chain().focus().insertContent(node as any).run();
              });
            } catch (error) {
              console.error("Failed to parse markdown:", error);
              // Fallback: insert as plain text
              editor.chain().focus().insertContent(text).run();
            }
            
            return true;
          },
        },
      }),
    ];
  },
});
