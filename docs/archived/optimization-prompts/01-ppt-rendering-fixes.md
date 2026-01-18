# Prompt 01: PowerPoint Rendering Quality Fixes

## Priority: P1 (High)

## Context

The PowerPoint viewer (`src/components/renderers/powerpoint-viewer.tsx`) uses `pptx-preview` library but has several rendering quality issues that affect user experience.

## Related Files

- `src/components/renderers/powerpoint-viewer.tsx` - Main viewer component
- `src/components/renderers/ppt-main-slide-area.tsx` - Slide display area
- `src/components/renderers/ppt-thumbnail-panel.tsx` - Thumbnail navigation
- `src/lib/pptx-formula-extractor.ts` - Formula extraction
- `src/lib/formula-enhancer.ts` - Formula rendering
- `src/lib/ppt-viewer-layout.ts` - Layout calculations
- `src/types/ppt-viewer.ts` - Type definitions

## Current Issues

### Issue 1: Slide Content Rendering Quality
- Some slides render with missing elements or incorrect positioning
- Text overflow issues on slides with dense content
- Background images/colors sometimes not rendering correctly

### Issue 2: Formula Rendering in Slides
- OMML (Office Math Markup Language) formulas extracted but not always rendered correctly
- KaTeX rendering sometimes fails silently
- Formula positioning doesn't match original slide layout

### Issue 3: Thumbnail Quality
- Thumbnails are blurry or low resolution
- Thumbnail aspect ratio sometimes incorrect
- Selected thumbnail highlight not always visible

### Issue 4: Slide Transitions and Navigation
- Keyboard navigation (arrow keys, Home/End) sometimes unresponsive
- Mouse wheel navigation can be jerky
- No smooth transition animation between slides

### Issue 5: Layout Responsiveness
- Viewer doesn't adapt well to narrow containers
- Thumbnail panel takes too much space on small screens
- Main slide area doesn't maximize available space

## Tasks

### Task 1: Improve Slide Content Rendering
```
1. Review pptx-preview initialization options in powerpoint-viewer.tsx
2. Increase render resolution (currently 2560x1920, may need adjustment)
3. Add CSS fixes for text overflow and positioning
4. Implement fallback rendering for unsupported elements
5. Add error boundary for individual slide rendering failures
```

### Task 2: Fix Formula Rendering
```
1. Review pptx-formula-extractor.ts for OMML extraction accuracy
2. Improve MathML to LaTeX conversion in formula-enhancer.ts
3. Add better error handling for KaTeX rendering failures
4. Implement formula overlay positioning that matches slide coordinates
5. Add visual indicator for formulas that failed to render
```

### Task 3: Enhance Thumbnail Quality
```
1. Generate higher resolution thumbnails
2. Implement lazy loading for thumbnails (virtual scrolling for many slides)
3. Fix aspect ratio calculation in thumbnail generation
4. Improve selected state visual feedback
5. Add loading skeleton for thumbnails
```

### Task 4: Improve Navigation
```
1. Review keyboard event handling in powerpoint-viewer.tsx
2. Add debouncing for mouse wheel navigation
3. Implement smooth CSS transitions between slides
4. Add touch/swipe support for mobile
5. Fix focus management for keyboard navigation
```

### Task 5: Responsive Layout
```
1. Review ppt-viewer-layout.ts calculations
2. Implement collapsible thumbnail panel for narrow screens
3. Add breakpoints for different screen sizes
4. Optimize main slide area to use maximum available space
5. Test on various viewport sizes
```

## Acceptance Criteria

- [ ] All slides render with correct content and positioning
- [ ] Formulas display correctly with proper positioning
- [ ] Thumbnails are crisp and correctly sized
- [ ] Navigation is smooth and responsive
- [ ] Layout adapts to different screen sizes
- [ ] No console errors during normal operation

## Testing

```bash
# Run existing tests
npm run test:run -- ppt

# Manual testing
1. Open a PPTX file with formulas
2. Navigate through all slides
3. Test keyboard navigation (arrows, Home, End)
4. Test mouse wheel navigation
5. Resize the window to test responsiveness
```

## Notes

- The pptx-preview library has limitations; document any workarounds needed
- Consider caching rendered slides for performance
- Formula rendering is complex; prioritize common formula types first
