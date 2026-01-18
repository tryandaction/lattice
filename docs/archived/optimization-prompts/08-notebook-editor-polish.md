# Prompt 08: Jupyter Notebook Editor Polish

## Priority: P2 (Medium)

## Context

The Jupyter notebook editor has been implemented with basic editing capabilities, but needs polish to provide a smooth editing experience comparable to JupyterLab or VS Code notebooks.

## Related Files

- `src/components/notebook/notebook-editor.tsx` - Main notebook editor
- `src/components/notebook/notebook-cell.tsx` - Cell container
- `src/components/notebook/code-cell.tsx` - Code cell component
- `src/components/notebook/markdown-cell.tsx` - Markdown cell component
- `src/components/notebook/output-area.tsx` - Cell output display
- `src/components/notebook/kernel-status.tsx` - Kernel status indicator
- `src/components/notebook/ansi-text.tsx` - ANSI output rendering
- `src/hooks/use-notebook-editor.ts` - Notebook state management
- `src/hooks/use-python-runner.ts` - Python execution
- `src/lib/notebook-utils.ts` - Notebook utilities
- `src/lib/ansi-renderer.ts` - ANSI parsing
- `src/workers/pyodide.worker.ts` - Python worker

## Current Issues

### Issue 1: Cell Editing Experience
- Cursor jumps to start when typing fast
- Tab key doesn't insert proper indentation
- Code completion not working
- Syntax errors not highlighted
- Cell doesn't auto-resize with content

### Issue 2: Cell Navigation
- Arrow keys don't move between cells at boundaries
- Enter in last line doesn't create new cell
- Escape doesn't reliably exit edit mode
- No visual indicator of selected cell
- Shift+Enter execution inconsistent

### Issue 3: Output Rendering
- Large outputs cause performance issues
- Image outputs sometimes don't display
- Error tracebacks hard to read
- No output clearing option
- Rich outputs (HTML, plots) limited

### Issue 4: Markdown Cells
- Preview/edit toggle not smooth
- Math rendering in preview inconsistent
- Links don't open in new tab
- Images in markdown not loading
- Code blocks in markdown unstyled

### Issue 5: Kernel Management
- Kernel status indicator not accurate
- No way to interrupt long-running code
- Kernel restart doesn't clear state properly
- Memory usage not displayed
- Package installation feedback missing

## Tasks

### Task 1: Fix Cell Editing
```
1. Review code-cell.tsx cursor management
2. Fix Tab key handling for indentation
3. Implement basic code completion
4. Add syntax error highlighting
5. Implement auto-resize for cell height
```

### Task 2: Improve Cell Navigation
```
1. Implement arrow key navigation at cell boundaries
2. Add Enter to create new cell from last line
3. Fix Escape key handling
4. Add selected cell visual indicator
5. Fix Shift+Enter execution flow
```

### Task 3: Fix Output Rendering
```
1. Implement output virtualization for large outputs
2. Fix image output display
3. Improve error traceback formatting
4. Add clear output button
5. Expand rich output support
```

### Task 4: Polish Markdown Cells
```
1. Smooth preview/edit transition
2. Fix math rendering consistency
3. Make links open in new tab
4. Fix image loading in markdown
5. Style code blocks properly
```

### Task 5: Improve Kernel Management
```
1. Fix kernel status indicator accuracy
2. Implement interrupt functionality
3. Fix kernel restart state clearing
4. Add memory usage display
5. Improve package installation feedback
```

## Acceptance Criteria

- [ ] Typing in cells is smooth without cursor jumps
- [ ] Navigation between cells works with keyboard
- [ ] All output types render correctly
- [ ] Markdown preview matches edit content
- [ ] Kernel status accurately reflects state
- [ ] Large notebooks perform well

## Testing

```bash
# Run existing tests
npm run test:run -- notebook
npm run test:run -- python

# Manual testing
1. Create new notebook
2. Add code cells and execute
3. Add markdown cells with math
4. Test keyboard navigation
5. Test with large outputs
6. Test kernel restart
```

## Keyboard Shortcuts for Notebooks

```
Cell Mode (when cell selected, not editing):
- Enter: Edit cell
- Shift+Enter: Run cell, select next
- Ctrl+Enter: Run cell, stay
- A: Insert cell above
- B: Insert cell below
- D,D: Delete cell
- M: Change to markdown
- Y: Change to code
- Up/Down: Select previous/next cell

Edit Mode (when editing cell content):
- Escape: Exit edit mode
- Tab: Indent / autocomplete
- Shift+Tab: Dedent
- Ctrl+/: Toggle comment
- Ctrl+Enter: Run cell
- Shift+Enter: Run and move to next
```

## Output Types to Support

```
Text Outputs:
- stream (stdout, stderr)
- execute_result
- error (with traceback)

Rich Outputs:
- text/plain
- text/html
- text/markdown
- image/png
- image/jpeg
- image/svg+xml
- application/json
- application/javascript (careful with security)
```

## Notes

- Pyodide has limitations compared to native Python
- Consider adding cell execution time display
- Large notebooks should use virtualization
- Test with real-world notebooks from Kaggle, etc.
- Consider adding cell collapsing for long outputs
