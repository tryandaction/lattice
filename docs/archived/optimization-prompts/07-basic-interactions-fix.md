# Prompt 07: Basic Interaction Bugs Fix

## Priority: P1 (High)

## Context

There are several fundamental interaction bugs that affect the core user experience. These are basic functionality issues that should work reliably.

## Related Files

- `src/components/explorer/tree-view.tsx` - File tree component
- `src/components/explorer/tree-node.tsx` - Individual tree node
- `src/components/explorer/file-context-menu.tsx` - Right-click menu
- `src/components/main-area/tab-bar.tsx` - Tab management
- `src/components/main-area/tab.tsx` - Individual tab
- `src/components/main-area/pane-wrapper.tsx` - Pane container
- `src/components/ui/save-reminder-dialog.tsx` - Unsaved changes dialog
- `src/hooks/use-file-system.ts` - File system operations
- `src/hooks/use-unsaved-warning.ts` - Unsaved state tracking
- `src/stores/workspace-store.ts` - Workspace state
- `src/stores/content-cache-store.ts` - Content caching

## Current Issues

### Issue 1: File Tree Interactions
- Double-click to open sometimes doesn't register
- Folder expand/collapse animation janky
- Context menu appears in wrong position
- Drag-and-drop for file moving unreliable
- Rename inline editing loses focus

### Issue 2: Tab Management
- Closing tab doesn't always select adjacent tab
- Middle-click to close not working
- Tab drag-to-reorder drops in wrong position
- Duplicate tab detection not working
- Tab tooltip (full path) not showing

### Issue 3: Save/Unsaved State
- Dirty indicator (dot) not always showing
- Save reminder dialog appears multiple times
- Ctrl+S doesn't always trigger save
- Auto-save conflicts with manual save
- Content lost on unexpected close

### Issue 4: Keyboard Shortcuts
- Some shortcuts don't work when editor focused
- Shortcut conflicts between components
- No visual feedback for shortcut actions
- Shortcuts not working in dialogs
- Missing common shortcuts (Ctrl+W, Ctrl+Tab)

### Issue 5: Drag and Drop
- File drop zone not clearly indicated
- Dropping files from OS doesn't work
- Pane drag-to-split unreliable
- No drag preview for files
- Drop feedback delayed

## Tasks

### Task 1: Fix File Tree Interactions
```
1. Review tree-node.tsx click handling
2. Fix double-click timing detection
3. Smooth folder expand/collapse animation
4. Fix context menu positioning calculation
5. Improve drag-and-drop reliability
6. Fix inline rename focus management
```

### Task 2: Fix Tab Management
```
1. Review tab-bar.tsx tab selection logic
2. Implement middle-click close
3. Fix drag-and-drop reorder positioning
4. Add duplicate tab detection
5. Add tooltip with full file path
6. Fix tab close adjacent selection
```

### Task 3: Fix Save State
```
1. Review content-cache-store.ts dirty tracking
2. Ensure dirty indicator updates reliably
3. Fix save reminder dialog trigger logic
4. Improve Ctrl+S handling in all contexts
5. Implement proper auto-save with conflict resolution
6. Add recovery for unexpected close
```

### Task 4: Fix Keyboard Shortcuts
```
1. Review shortcut registration across components
2. Implement proper event propagation
3. Add visual feedback for shortcut actions
4. Fix shortcuts in modal dialogs
5. Add missing common shortcuts
6. Create shortcut conflict resolution
```

### Task 5: Fix Drag and Drop
```
1. Add clear drop zone indicators
2. Implement OS file drop handling
3. Fix pane split drag detection
4. Add drag preview for files
5. Improve drop feedback timing
```

## Acceptance Criteria

- [ ] Double-click reliably opens files
- [ ] Tab close selects correct adjacent tab
- [ ] Dirty indicator always accurate
- [ ] Ctrl+S works in all contexts
- [ ] All keyboard shortcuts work consistently
- [ ] Drag and drop works smoothly

## Testing

```bash
# Run existing tests
npm run test:run -- workspace
npm run test:run -- content-cache

# Manual testing checklist
1. Double-click files to open
2. Right-click for context menu
3. Close tabs with X button and middle-click
4. Drag tabs to reorder
5. Make changes and verify dirty indicator
6. Test Ctrl+S in different contexts
7. Test Ctrl+W to close tab
8. Test Ctrl+Tab to switch tabs
9. Drag files from OS into app
10. Drag pane dividers to resize
```

## Keyboard Shortcuts Reference

```
File Operations:
- Ctrl+S: Save current file
- Ctrl+Shift+S: Save all files
- Ctrl+O: Open file
- Ctrl+N: New file

Tab Operations:
- Ctrl+W: Close current tab
- Ctrl+Tab: Next tab
- Ctrl+Shift+Tab: Previous tab
- Ctrl+1-9: Go to tab N

Editor Operations:
- Ctrl+Z: Undo
- Ctrl+Y / Ctrl+Shift+Z: Redo
- Ctrl+F: Find
- Ctrl+H: Find and replace

View Operations:
- Ctrl+B: Toggle sidebar
- Ctrl+\: Split pane
- Ctrl+,: Open settings
```

## Event Handling Best Practices

```typescript
// Proper event handling pattern
const handleClick = (e: React.MouseEvent) => {
  e.stopPropagation(); // Prevent bubbling if needed
  e.preventDefault();  // Prevent default if needed
  // Handle the event
};

// Keyboard event with proper checks
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    handleSave();
  }
};

// Double-click detection
const DOUBLE_CLICK_DELAY = 300;
let lastClickTime = 0;

const handleClick = () => {
  const now = Date.now();
  if (now - lastClickTime < DOUBLE_CLICK_DELAY) {
    handleDoubleClick();
  }
  lastClickTime = now;
};
```

## Notes

- Test on both Windows and macOS for keyboard shortcuts
- Ensure touch equivalents exist for all interactions
- Add analytics to track interaction failures
- Consider adding an interaction tutorial for new users
