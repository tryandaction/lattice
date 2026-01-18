# Prompt 00: Critical Bugs Fix Sprint

## Priority: P0 (CRITICAL - Do First)

## Overview

This prompt addresses ALL critical bugs reported by users that affect core functionality. These must be fixed before any feature work.

---

## Bug List

### Bug 1: Image Disappears During Editing
**Severity**: Critical
**Component**: `src/components/renderers/image-tldraw-adapter.tsx`

**Symptom**:
- User opens an image file
- Uses drawing tools (pencil, shapes, etc.)
- Image background suddenly disappears, leaving only drawings
- Cannot recover without closing and reopening

**Root Cause Analysis**:
- Tldraw's background image shape can be accidentally deleted or lost
- The `isLocked: true` property may not be sufficient protection
- Store operations might inadvertently remove the background

**Fix Requirements**:
```
1. Add background image existence check on every store change
2. Implement automatic recovery if background is lost
3. Prevent background shape from being selected or deleted
4. Add visual indicator when background is being restored
5. Log warnings when background recovery is triggered
```

**Files to Modify**:
- `src/components/renderers/image-tldraw-adapter.tsx`

**Acceptance Criteria**:
- [ ] Background image never disappears during normal editing
- [ ] If background is somehow lost, it auto-recovers within 2 seconds
- [ ] User cannot select or delete background image
- [ ] Console shows warning if recovery was needed

---

### Bug 2: Markdown Table Not Rendering
**Severity**: Critical
**Component**: `src/components/editor/advanced-markdown-editor.tsx`

**Symptom**:
- User pastes or types Markdown table syntax
- Table appears as plain text instead of rendered table
- Example: `| Header | Header |` shows as text

**Root Cause Analysis**:
- TipTap Table extension may not have proper input rules
- Markdown paste handler may not recognize table syntax
- Table HTML structure may not match expected format

**Fix Requirements**:
```
1. Verify Table extension is properly configured
2. Add Markdown table syntax detection in paste handler
3. Convert Markdown table to TipTap table nodes on paste
4. Add input rule for creating tables from `|---|---|` syntax
5. Ensure table renders correctly with borders and alignment
```

**Files to Modify**:
- `src/components/editor/advanced-markdown-editor.tsx`
- `src/components/editor/extensions/markdown-paste-handler.ts`
- `src/components/editor/extensions/table-input-rule.ts`

**Acceptance Criteria**:
- [ ] Pasted Markdown tables convert to visual tables
- [ ] Typing `| Cell | Cell |` + Enter creates table
- [ ] Tables show proper borders and styling
- [ ] Table cells are editable

---

### Bug 3: Formulas in Tables/Bold Not Rendering
**Severity**: Critical
**Component**: `src/components/editor/extensions/`

**Symptom**:
- Formula `$E=mc^2$` renders correctly in plain text
- Same formula inside table cell shows as `$E=mc^2$`
- Formula with bold `**$E=mc^2$**` doesn't render
- Formula detection fails in certain contexts

**Root Cause Analysis**:
- Math node detection regex may not work inside other nodes
- TipTap node nesting rules may prevent math inside certain nodes
- Paste handler may strip math markers in certain contexts

**Fix Requirements**:
```
1. Audit math detection regex for edge cases
2. Allow math nodes inside table cells, bold, italic
3. Ensure math paste handler works in all text contexts
4. Add post-processing pass to find missed math patterns
5. Test math in: tables, bold, italic, lists, blockquotes
```

**Files to Modify**:
- `src/components/editor/extensions/mathlive-node.tsx`
- `src/components/editor/extensions/latex-paste-handler.ts`
- `src/components/editor/extensions/markdown-paste-handler.ts`
- `src/lib/content-normalizer.ts`

**Acceptance Criteria**:
- [ ] `$formula$` renders in table cells
- [ ] `**$formula$**` renders (bold + math)
- [ ] `*$formula$*` renders (italic + math)
- [ ] Math in lists renders correctly
- [ ] Math in blockquotes renders correctly

---

### Bug 4: List/Bullet Point Format Incorrect
**Severity**: High
**Component**: `src/components/editor/advanced-markdown-editor.tsx`

**Symptom**:
- Nested lists don't indent correctly
- Bullet points may show wrong symbol
- Numbered lists restart numbering unexpectedly
- Mixed list types (bullet + number) display wrong

**Root Cause Analysis**:
- StarterKit list configuration may be incomplete
- CSS styles for nested lists may be missing
- Paste handler may not preserve list structure

**Fix Requirements**:
```
1. Configure bullet/ordered list extensions properly
2. Add CSS for proper nested list indentation
3. Support multiple indent levels (at least 4 levels)
4. Handle mixed list types correctly
5. Preserve list structure on paste
```

**Files to Modify**:
- `src/components/editor/advanced-markdown-editor.tsx`
- `src/styles/prose.css` (or create if needed)
- `src/components/editor/extensions/markdown-paste-handler.ts`

**Acceptance Criteria**:
- [ ] Nested lists indent correctly (visual hierarchy)
- [ ] Bullet lists use correct symbols (•, ◦, ▪)
- [ ] Numbered lists continue numbering correctly
- [ ] Tab/Shift+Tab changes indent level
- [ ] Pasted lists preserve structure

---

### Bug 5: Quantum Keyboard Blocks Editing Position
**Severity**: High
**Component**: `src/components/hud/keyboard-hud.tsx`

**Symptom**:
- User opens quantum keyboard (double-tap Tab)
- Keyboard appears but covers the formula being edited
- User cannot see what they're typing
- Keyboard doesn't move to avoid blocking

**Root Cause Analysis**:
- `computeOptimalPosition` may not correctly detect formula position
- Keyboard doesn't update position when cursor/selection changes
- Fixed positioning doesn't account for formula element bounds

**Fix Requirements**:
```
1. Detect exact bounding box of active math-field
2. Position keyboard to NEVER overlap active math-field
3. Prefer positioning above if space, else below
4. Update position dynamically as user clicks different formulas
5. Add smooth animation when position changes
6. Handle edge cases: top of screen, bottom of screen
```

**Files to Modify**:
- `src/components/hud/keyboard-hud.tsx`
- `src/stores/hud-store.ts`
- `src/components/hud/hud-provider.tsx`

**Acceptance Criteria**:
- [ ] Keyboard never covers active formula
- [ ] Position updates when clicking different formulas
- [ ] Works correctly at screen edges
- [ ] Smooth transition when position changes
- [ ] Visual indicator shows which formula is being edited

---

### Bug 6: PDF Annotation Panel Toggle Button Wrong Side
**Severity**: Medium
**Component**: `src/components/renderers/pdf-highlighter-adapter.tsx`

**Symptom**:
- Annotation sidebar is correctly on the LEFT
- But the toggle button (to show/hide sidebar) is still on RIGHT
- Confusing UI: button far from what it controls

**Root Cause Analysis**:
- Sidebar was moved to left but toggle button position wasn't updated
- Button position may be hardcoded or in wrong flex order

**Fix Requirements**:
```
1. Move toggle button to left side, near the sidebar
2. Button should be visible when sidebar is hidden
3. Button icon should indicate show/hide state
4. Smooth transition when sidebar opens/closes
5. Button should have tooltip explaining function
```

**Files to Modify**:
- `src/components/renderers/pdf-highlighter-adapter.tsx`

**Acceptance Criteria**:
- [ ] Toggle button is on LEFT side
- [ ] Button is always visible (even when sidebar hidden)
- [ ] Icon changes to indicate state (show/hide)
- [ ] Clicking button toggles sidebar smoothly
- [ ] Has tooltip: "Show/Hide Annotations"

---

### Bug 7: Annotation Sidebar Default State
**Severity**: Medium
**Component**: `src/components/renderers/pdf-highlighter-adapter.tsx`

**Symptom**:
- Annotation sidebar opens by default when viewing PDF
- Takes up screen space before user wants annotations
- User has to manually close it every time

**Expected Behavior**:
- Sidebar should be CLOSED by default
- Open only when user explicitly clicks toggle
- Remember user preference (persist in localStorage)

**Fix Requirements**:
```
1. Set default sidebar state to CLOSED
2. Store sidebar preference in localStorage per file or global
3. Restore preference when reopening same file
4. Provide keyboard shortcut to toggle (e.g., Ctrl+Shift+A)
5. Show subtle indicator when annotations exist but sidebar is closed
```

**Files to Modify**:
- `src/components/renderers/pdf-highlighter-adapter.tsx`
- Create/update localStorage utility if needed

**Acceptance Criteria**:
- [ ] Sidebar closed by default on first open
- [ ] User preference persisted across sessions
- [ ] Keyboard shortcut works (document in UI)
- [ ] Badge/indicator shows annotation count when closed
- [ ] Preference persists after app restart

---

### Bug 8: Desktop App Layout Issues
**Severity**: Medium
**Component**: `src-tauri/` and layout components

**Symptom**:
- Desktop app window doesn't show bottom of UI
- Default window size/position cuts off content
- User has to manually resize/maximize
- Should default to fullscreen or maximized

**Root Cause Analysis**:
- Tauri window configuration may have incorrect default size
- CSS may assume larger viewport than window provides
- No maximize-on-start logic

**Fix Requirements**:
```
1. Set Tauri window to start MAXIMIZED by default
2. Or set reasonable minimum size that shows all content
3. Ensure UI is responsive to any window size
4. Add "maximize" button to title bar if not present
5. Persist window size/position for next launch
```

**Files to Modify**:
- `src-tauri/tauri.conf.json`
- `src-tauri/src/main.rs` (if programmatic control needed)
- Root layout CSS if needed

**Acceptance Criteria**:
- [ ] App starts maximized (or fullscreen)
- [ ] All UI elements visible without scrolling
- [ ] Window can be resized with content adapting
- [ ] Window state persisted between launches
- [ ] Works on different screen resolutions

---

## Implementation Order

Execute fixes in this order for maximum stability:

1. **Bug 8**: Desktop layout (affects all testing)
2. **Bug 7**: Sidebar default state (quick fix)
3. **Bug 6**: Toggle button position (quick fix)
4. **Bug 1**: Image disappearing (critical)
5. **Bug 5**: Quantum keyboard position (critical UX)
6. **Bug 2**: Table rendering (core feature)
7. **Bug 3**: Formula in context (core feature)
8. **Bug 4**: List formatting (polish)

---

## Testing Protocol

After ALL bugs are fixed:

```bash
# Run automated tests
npm run test:run

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

### Manual Test Checklist

- [ ] Open image, draw, verify image stays
- [ ] Paste Markdown table, verify renders
- [ ] Type formula in table cell, verify renders
- [ ] Create nested list, verify indentation
- [ ] Open quantum keyboard, verify doesn't block
- [ ] Open PDF, verify sidebar closed by default
- [ ] Toggle sidebar, verify button on left
- [ ] Launch desktop app, verify fullscreen/maximized

---

## Notes

- Fix bugs in order to avoid regression
- Commit after each bug fix
- Test the specific bug thoroughly before moving on
- Some bugs may be related (e.g., 2 and 3 both involve TipTap)
- Desktop testing requires `npm run tauri dev`
