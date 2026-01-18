# Prompt 03: PDF Annotation System Polish

## Priority: P1 (High)

## Context

The PDF annotation system uses react-pdf-highlighter and custom annotation layers. While basic functionality works, there are interaction issues that affect the professional annotation experience (targeting Zotero-level quality).

## Related Files

- `src/components/renderers/pdf-viewer-with-annotations.tsx` - Main PDF viewer
- `src/components/renderers/annotation-layer.tsx` - Annotation rendering layer
- `src/components/renderers/annotation-color-picker.tsx` - Color selection UI
- `src/components/renderers/annotation-comment-popup.tsx` - Comment editing popup
- `src/components/renderers/text-annotation-editor.tsx` - Text annotation editor
- `src/components/renderers/pdf-annotation-sidebar.tsx` - Annotation list sidebar
- `src/hooks/use-pdf-annotation.ts` - Annotation state management
- `src/lib/annotation-storage.ts` - Persistence layer
- `src/lib/annotation-coordinates.ts` - Coordinate transformations
- `src/lib/coordinate-transforms.ts` - Additional coordinate utilities
- `src/types/annotation.ts` - Type definitions

## Current Issues

### Issue 1: Text Selection and Highlighting
- Text selection sometimes doesn't register on first try
- Selection across page boundaries doesn't work
- Color picker appears in wrong position near edges
- Highlight doesn't always match selected text precisely

### Issue 2: Area Selection (Alt+Drag)
- Area selection coordinates are sometimes offset
- Minimum area threshold too sensitive
- No visual feedback during drag operation
- Area annotations don't scale correctly with zoom

### Issue 3: Text Annotations
- Click detection area too small
- Editor popup positioning issues
- Font size changes don't persist correctly
- Delete confirmation missing

### Issue 4: Annotation Interaction
- Clicking annotations in select mode unreliable
- Hover states don't show consistently
- Comment popup positioning can go off-screen
- Multiple overlapping annotations hard to select

### Issue 5: Zoom and Coordinate System
- Annotations shift position when zooming
- Coordinate transformation errors at extreme zoom levels
- Fit-to-width mode doesn't recalculate annotation positions
- Scroll position jumps when zooming

## Tasks

### Task 1: Fix Text Selection
```
1. Review text selection detection in pdf-viewer-with-annotations.tsx
2. Improve selection boundary calculation
3. Fix color picker positioning logic
4. Ensure highlight rectangles match text bounds precisely
5. Add visual feedback during selection
```

### Task 2: Fix Area Selection
```
1. Review area selection coordinate calculation
2. Adjust minimum area threshold (currently may be too small)
3. Add drag preview rectangle during selection
4. Fix scaling with zoom level
5. Improve Alt+drag detection reliability
```

### Task 3: Improve Text Annotations
```
1. Expand click detection area in annotation-layer.tsx
2. Fix editor popup positioning in text-annotation-editor.tsx
3. Ensure font size persists in annotation storage
4. Add delete confirmation dialog
5. Improve visual feedback on hover
```

### Task 4: Enhance Annotation Interaction
```
1. Review click handling in annotation-layer.tsx
2. Implement proper z-index for overlapping annotations
3. Fix hover state CSS transitions
4. Ensure comment popup stays within viewport
5. Add keyboard navigation for annotations
```

### Task 5: Fix Zoom Coordinate System
```
1. Review coordinate-transforms.ts calculations
2. Fix annotation position updates on zoom
3. Implement viewport center preservation
4. Test at various zoom levels (50% to 200%)
5. Fix fit-to-width annotation positioning
```

## Acceptance Criteria

- [ ] Text selection works reliably on first attempt
- [ ] Area selection creates correctly positioned annotations
- [ ] Text annotations are easy to click and edit
- [ ] Annotations remain correctly positioned at all zoom levels
- [ ] No coordinate drift after multiple zoom operations
- [ ] All annotation types persist correctly after save/reload

## Testing

```bash
# Run existing tests
npm run test:run -- annotation
npm run test:run -- coordinate
npm run test:run -- pdf

# Manual testing
1. Open a PDF with multiple pages
2. Create text highlights on different pages
3. Create area annotations with Alt+drag
4. Add text annotations
5. Zoom in/out and verify positions
6. Save, close, and reopen to verify persistence
```

## Coordinate System Reference

```
PDF Coordinate System:
- Origin: Bottom-left of page
- Units: PDF points (1/72 inch)
- Y increases upward

Screen Coordinate System:
- Origin: Top-left of viewport
- Units: CSS pixels
- Y increases downward

Normalized Coordinates (for storage):
- Range: 0.0 to 1.0
- Relative to page dimensions
- Zoom-independent
```

## Notes

- react-pdf-highlighter has known issues with certain PDF structures
- Consider implementing custom highlight layer for more control
- Test with PDFs containing different page sizes
- Annotation sidebar should sync with visible annotations
