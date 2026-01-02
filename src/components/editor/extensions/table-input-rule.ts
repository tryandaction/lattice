/**
 * Table Input Rule Extension for Tiptap
 * 
 * Converts pipe-delimited text to tables.
 * Pattern: | Col1 | Col2 | followed by Enter creates a table.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";

/**
 * Parse a pipe-delimited line into column values
 */
function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  
  // Must start and end with |
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return null;
  }
  
  // Split by | and filter out empty first/last elements
  const parts = trimmed.split("|").slice(1, -1);
  
  if (parts.length < 2) {
    return null;
  }
  
  return parts.map(p => p.trim());
}

/**
 * Check if a line is a separator row (|---|---|)
 */
function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  return /^\|[\s\-:]+(\|[\s\-:]+)+\|$/.test(trimmed);
}

export const TableInputRule = Extension.create({
  name: "tableInputRule",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey("tableInputRule"),
        
        props: {
          handleKeyDown(view, event) {
            // Only handle Enter key
            if (event.key !== "Enter") {
              return false;
            }

            const { state } = view;
            const { selection, doc } = state;
            
            // Only handle at end of line
            if (!selection.empty) {
              return false;
            }

            const pos = selection.$from;
            const currentLine = doc.textBetween(
              pos.start(),
              pos.pos,
              "\n"
            );

            // Check if current line looks like a table header row
            const columns = parseTableRow(currentLine);
            if (!columns) {
              return false;
            }

            // Check if there's already a table at this position
            const resolvedPos = state.doc.resolve(pos.pos);
            if (resolvedPos.parent.type.name === "tableCell" || 
                resolvedPos.parent.type.name === "tableHeader") {
              return false;
            }

            // Create a table with the parsed columns
            const { tr } = state;
            
            // Delete the current line content
            const lineStart = pos.start();
            const lineEnd = pos.pos;
            
            // Use editor commands to insert table
            setTimeout(() => {
              editor
                .chain()
                .focus()
                .deleteRange({ from: lineStart, to: lineEnd })
                .insertTable({ 
                  rows: 2, 
                  cols: columns.length, 
                  withHeaderRow: true 
                })
                .run();

              // Fill in the header cells with column names
              const { state: newState } = editor.view;
              let cellIndex = 0;
              
              newState.doc.descendants((node, pos) => {
                if (node.type.name === "tableHeader" && cellIndex < columns.length) {
                  editor
                    .chain()
                    .focus()
                    .setTextSelection(pos + 1)
                    .insertContent(columns[cellIndex])
                    .run();
                  cellIndex++;
                }
                return cellIndex < columns.length;
              });
            }, 0);

            return true;
          },
        },
      }),
    ];
  },
});
