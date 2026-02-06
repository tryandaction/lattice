/**
 * Table Input Rule Extension for Tiptap
 * 
 * Converts pipe-delimited text to tables.
 * Patterns supported:
 * 1. | Col1 | Col2 | followed by Enter creates a table
 * 2. |---|---| separator row triggers table creation from previous header row
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

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
  
  if (parts.length < 1) {
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
            
            // Only handle at end of line with empty selection
            if (!selection.empty) {
              return false;
            }

            const $from = selection.$from;
            
            // Check if we're already in a table
            for (let d = $from.depth; d > 0; d--) {
              const node = $from.node(d);
              if (node.type.name === "table" || 
                  node.type.name === "tableCell" || 
                  node.type.name === "tableHeader") {
                return false;
              }
            }

            // Get the current paragraph/block content
            const parent = $from.parent;
            if (parent.type.name !== "paragraph") {
              return false;
            }
            
            const currentText = parent.textContent;
            
            // Check if current line is a separator row (|---|---|)
            if (isSeparatorRow(currentText)) {
              // Look for header row in previous paragraph
              const parentPos = $from.before($from.depth);
              if (parentPos > 0) {
                const prevPos = doc.resolve(parentPos - 1);
                const prevNode = prevPos.parent;
                
                if (prevNode.type.name === "paragraph") {
                  const headerText = prevNode.textContent;
                  const headers = parseTableRow(headerText);
                  
                  if (headers && headers.length >= 1) {
                    event.preventDefault();
                    
                    // Calculate positions to delete both paragraphs
                    const headerStart = prevPos.before(prevPos.depth);
                    const separatorEnd = $from.after($from.depth);
                    
                    // Create table with headers
                    const numCols = headers.length;
                    
                    // Ensure table commands are available
                    const canInsertTable = typeof (editor.commands as any).insertTable === "function";
                    if (!canInsertTable) {
                      return false;
                    }

                    // Use setTimeout to avoid state conflicts
                    setTimeout(() => {
                      // Delete the header and separator lines, then insert table
                      (editor.chain() as any)
                        .focus()
                        .deleteRange({ from: headerStart, to: separatorEnd })
                        .insertTable({
                          rows: 2,
                          cols: numCols,
                          withHeaderRow: true,
                        })
                        .run();

                      // Fill in the header cells
                      setTimeout(() => {
                        const { state: newState } = editor.view;
                        let cellIndex = 0;
                        let firstDataCellPos: number | null = null;
                        
                        newState.doc.descendants((node, pos) => {
                          if (node.type.name === "tableHeader" && cellIndex < headers.length) {
                            const cellContent = headers[cellIndex];
                            if (cellContent) {
                              editor.view.dispatch(
                                editor.view.state.tr.insertText(cellContent, pos + 1)
                              );
                            }
                            cellIndex++;
                          } else if (node.type.name === "tableCell" && firstDataCellPos === null) {
                            firstDataCellPos = pos + 1;
                          }
                          return true;
                        });
                        
                        // Move cursor to first data cell
                        if (firstDataCellPos !== null) {
                          editor.commands.setTextSelection(firstDataCellPos);
                        }
                      }, 10);
                    }, 0);
                    
                    return true;
                  }
                }
              }
            }
            
            // Check if current line looks like a table header row (| Col1 | Col2 |)
            const columns = parseTableRow(currentText);
            if (columns && columns.length >= 1) {
              // Don't create table yet - wait for separator row
              // This allows user to type the separator row |---|---|
              return false;
            }

            return false;
          },
        },
      }),
    ];
  },
});
