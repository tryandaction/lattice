# Prompt 06: UI Adaptation and Responsive Design

## Priority: P2 (Medium)

## Context

Lattice needs to work well across different screen sizes and window configurations. The current UI has responsiveness issues that affect usability on smaller screens and when panels are resized.

## Related Files

- `src/components/layout/app-layout.tsx` - Main application layout
- `src/components/main-area/main-area.tsx` - Main content area
- `src/components/main-area/layout-renderer.tsx` - Pane layout system
- `src/components/main-area/pane-wrapper.tsx` - Individual pane container
- `src/components/main-area/tab-bar.tsx` - Tab navigation
- `src/components/explorer/explorer-sidebar.tsx` - File explorer sidebar
- `src/components/ui/resizable.tsx` - Resizable panel component
- `src/lib/layout-utils.ts` - Layout calculation utilities
- `src/lib/layout-persistence.ts` - Layout state persistence
- `src/types/layout.ts` - Layout type definitions
- `src/app/globals.css` - Global styles

## Current Issues

### Issue 1: Sidebar Responsiveness
- Sidebar doesn't collapse on narrow screens
- Minimum width too large for small windows
- Toggle button position inconsistent
- Sidebar state not remembered after resize

### Issue 2: Pane Layout Issues
- Panes don't have minimum size constraints
- Resizing can make content unusable
- Split direction doesn't adapt to aspect ratio
- Drag handles hard to grab on touch devices

### Issue 3: Tab Bar Overflow
- Too many tabs cause horizontal overflow
- No scroll or dropdown for overflow tabs
- Tab close buttons too small on mobile
- Active tab not always visible

### Issue 4: Toolbar Adaptation
- Toolbars don't collapse on narrow widths
- Icons too small on high-DPI displays
- No responsive icon-only mode
- Dropdown menus can go off-screen

### Issue 5: Content Scaling
- Font sizes don't adapt to container width
- Images overflow containers
- Tables don't scroll horizontally
- Code blocks don't wrap properly

## Tasks

### Task 1: Fix Sidebar Responsiveness
```
1. Add breakpoint-based sidebar collapse
2. Reduce minimum sidebar width
3. Fix toggle button positioning
4. Persist sidebar state in layout-persistence.ts
5. Add swipe gesture for mobile sidebar toggle
```

### Task 2: Improve Pane Layout
```
1. Add minimum size constraints to panes
2. Implement smart resize limits
3. Auto-switch split direction based on aspect ratio
4. Improve drag handle size for touch
5. Add pane collapse/expand functionality
```

### Task 3: Fix Tab Bar
```
1. Implement horizontal scroll for overflow tabs
2. Add dropdown menu for hidden tabs
3. Increase touch target size for close buttons
4. Ensure active tab scrolls into view
5. Add tab drag-to-reorder on mobile
```

### Task 4: Adapt Toolbars
```
1. Implement toolbar overflow menu
2. Scale icons for high-DPI displays
3. Add icon-only mode for narrow widths
4. Fix dropdown menu positioning
5. Add touch-friendly toolbar mode
```

### Task 5: Fix Content Scaling
```
1. Implement responsive typography
2. Add max-width constraints for images
3. Enable horizontal scroll for tables
4. Implement code block word wrap option
5. Test all content types at various widths
```

## Acceptance Criteria

- [ ] UI usable at 320px width (mobile)
- [ ] UI usable at 768px width (tablet)
- [ ] UI optimal at 1024px+ width (desktop)
- [ ] All interactive elements have adequate touch targets
- [ ] Layout state persists across sessions
- [ ] No horizontal overflow causing scroll issues

## Testing

```bash
# Manual testing at different viewport sizes
1. Test at 320px width (mobile portrait)
2. Test at 480px width (mobile landscape)
3. Test at 768px width (tablet)
4. Test at 1024px width (small desktop)
5. Test at 1440px width (large desktop)

# Test scenarios
- Open multiple files in tabs
- Resize sidebar
- Split panes horizontally and vertically
- View different file types
- Use toolbars and menus
```

## Breakpoint Reference

```css
/* Tailwind default breakpoints */
sm: 640px   /* Small devices */
md: 768px   /* Medium devices (tablets) */
lg: 1024px  /* Large devices (desktops) */
xl: 1280px  /* Extra large devices */
2xl: 1536px /* 2X large devices */

/* Suggested Lattice breakpoints */
mobile: < 640px     /* Single column, collapsed sidebar */
tablet: 640-1024px  /* Flexible layout, collapsible sidebar */
desktop: > 1024px   /* Full layout, persistent sidebar */
```

## CSS Utilities to Use

```css
/* Container queries for component-level responsiveness */
@container (max-width: 400px) { ... }

/* Responsive hiding */
.hidden sm:block  /* Hidden on mobile, visible on sm+ */

/* Responsive spacing */
.p-2 md:p-4 lg:p-6  /* Increasing padding at breakpoints */

/* Responsive text */
.text-sm md:text-base lg:text-lg
```

## Notes

- Use CSS container queries where possible for component-level responsiveness
- Test with both mouse and touch input
- Consider adding a "compact mode" toggle for power users
- Ensure keyboard navigation works at all sizes
- Test with screen readers at different sizes
