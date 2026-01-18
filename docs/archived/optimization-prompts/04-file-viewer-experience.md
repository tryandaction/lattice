# Prompt 04: Multi-Format File Viewer Experience

## Priority: P2 (Medium)

## Context

Lattice supports viewing multiple file formats (PDF, Markdown, Jupyter, Word, PowerPoint, Code, Images, HTML). Each viewer has different levels of polish and some have usability issues.

## Related Files

- `src/components/main-area/universal-file-viewer.tsx` - File type router
- `src/components/renderers/markdown-renderer.tsx` - Markdown viewer
- `src/components/renderers/jupyter-renderer.tsx` - Jupyter notebook viewer
- `src/components/renderers/word-viewer.tsx` - Word document viewer
- `src/components/renderers/html-viewer.tsx` - HTML viewer
- `src/components/renderers/image-viewer.tsx` - Image viewer
- `src/components/renderers/code-reader.tsx` - Code file viewer
- `src/components/renderers/code-editor-viewer.tsx` - Code editor
- `src/lib/file-utils.ts` - File type detection
- `src/hooks/use-pane-file-content.ts` - File content loading

## Current Issues

### Issue 1: Markdown Rendering
- Complex tables don't render correctly
- Nested lists have spacing issues
- Code blocks lack copy button
- Math rendering sometimes fails silently
- Frontmatter display could be improved

### Issue 2: Jupyter Notebook Viewer
- Output cells don't render all output types
- Large outputs cause performance issues
- Cell execution count display inconsistent
- Markdown cells don't render math correctly
- No syntax highlighting theme consistency

### Issue 3: Word Document Viewer
- Complex formatting lost in conversion
- Tables don't preserve styling
- Images sometimes missing
- Headers/footers not displayed
- No page break indication

### Issue 4: Code Viewer/Editor
- Language detection sometimes wrong
- Line numbers misaligned with content
- No word wrap option
- Search functionality missing
- Large files cause lag

### Issue 5: Image Viewer
- No zoom controls
- Pan/drag not smooth
- Image info (dimensions, size) not shown
- No fit-to-window option
- Annotation integration incomplete

## Tasks

### Task 1: Improve Markdown Rendering
```
1. Review markdown-renderer.tsx table handling
2. Fix nested list CSS spacing
3. Add copy button to code blocks
4. Improve math error handling with fallback display
5. Enhance frontmatter display with better styling
```

### Task 2: Enhance Jupyter Viewer
```
1. Review jupyter-renderer.tsx output handling
2. Add support for more output types (HTML, SVG, etc.)
3. Implement output truncation for large outputs
4. Fix math rendering in markdown cells
5. Unify syntax highlighting theme with code editor
```

### Task 3: Improve Word Viewer
```
1. Review mammoth.js conversion options
2. Improve table styling preservation
3. Add image loading error handling
4. Consider page break indicators
5. Add loading progress for large documents
```

### Task 4: Enhance Code Viewer
```
1. Improve language detection in file-utils.ts
2. Fix line number alignment CSS
3. Add word wrap toggle
4. Implement basic search (Ctrl+F)
5. Add virtual scrolling for large files
```

### Task 5: Improve Image Viewer
```
1. Add zoom controls (buttons and scroll)
2. Implement smooth pan/drag
3. Display image metadata
4. Add fit-to-window button
5. Integrate with annotation system
```

## Acceptance Criteria

- [ ] Markdown tables render correctly
- [ ] Jupyter outputs display properly
- [ ] Word documents preserve basic formatting
- [ ] Code files have correct syntax highlighting
- [ ] Images can be zoomed and panned smoothly
- [ ] All viewers handle errors gracefully

## Testing

```bash
# Run existing tests
npm run test:run -- renderer
npm run test:run -- markdown
npm run test:run -- notebook

# Manual testing
1. Open files of each supported type
2. Test with complex content (tables, formulas, images)
3. Test with large files
4. Test error handling with malformed files
5. Test dark mode rendering
```

## File Type Support Matrix

| Format | View | Edit | Annotate | Status |
|--------|------|------|----------|--------|
| PDF | ✅ | ❌ | ✅ | Good |
| Markdown | ✅ | ✅ | ❌ | Needs work |
| Jupyter | ✅ | ✅ | ❌ | Needs work |
| Word | ✅ | ❌ | ❌ | Basic |
| PowerPoint | ✅ | ❌ | ❌ | Needs work |
| Code | ✅ | ✅ | ❌ | Good |
| Image | ✅ | ❌ | ✅ | Basic |
| HTML | ✅ | ❌ | ❌ | Basic |

## Notes

- Prioritize formats most used in scientific work (PDF, Markdown, Jupyter)
- Consider lazy loading for heavy renderers
- Ensure consistent styling across all viewers
- Test with real-world files from different sources
