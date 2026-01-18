# Prompt 02: Math Formula Editing Enhancement

## Priority: P1 (High)

## Context

The project uses MathLive for math formula editing, integrated with Tiptap editor. The current implementation has usability issues that affect the scientific writing experience.

## Related Files

- `src/components/editor/advanced-markdown-editor.tsx` - Main editor with math support
- `src/components/editor/extensions/mathlive-node.tsx` - MathLive Tiptap integration
- `src/components/editor/extensions/math-extension.tsx` - KaTeX-based math (alternative)
- `src/components/hud/keyboard-hud.tsx` - Quantum keyboard for symbol input
- `src/components/hud/hud-provider.tsx` - HUD context provider
- `src/stores/hud-store.ts` - HUD state management
- `src/config/quantum-keymap.ts` - Symbol key mappings
- `src/lib/formula-converter.ts` - LaTeX conversion utilities

## Current Issues

### Issue 1: MathLive Focus Management
- Clicking on a math field sometimes doesn't focus it properly
- Focus jumps unexpectedly when editing formulas
- Cursor position lost when switching between math fields
- Tab navigation between placeholders inconsistent

### Issue 2: Quantum Keyboard Integration
- Double-tap Tab trigger sometimes doesn't work
- Symbol insertion doesn't always go to the correct math field
- Keyboard position can block the formula being edited
- Closing the keyboard doesn't restore focus properly

### Issue 3: Formula Input Experience
- LaTeX paste handling is inconsistent
- Common shortcuts (/, ^, _) don't always work as expected
- No visual feedback when entering structure commands
- Error messages for invalid LaTeX not user-friendly

### Issue 4: Math Node Lifecycle
- Creating new math nodes sometimes causes editor errors
- Deleting math nodes can leave orphaned content
- Undo/redo doesn't work correctly with math nodes
- Math nodes sometimes lose content on save

### Issue 5: Rendering Quality
- Inline math vertical alignment issues
- Block math centering inconsistent
- Font size doesn't match surrounding text well
- Dark mode rendering has contrast issues

## Tasks

### Task 1: Fix Focus Management
```
1. Review mathlive-node.tsx focus handling
2. Implement proper focus tracking in hud-provider.tsx
3. Add focus restoration after keyboard closes
4. Fix Tab navigation between math field placeholders
5. Ensure cursor position is preserved during edits
```

### Task 2: Improve Quantum Keyboard
```
1. Review use-double-tap.ts timing and detection
2. Fix symbol insertion target in keyboard-hud.tsx
3. Implement smart positioning to avoid blocking content
4. Add visual indicator showing which field will receive input
5. Improve keyboard dismiss behavior
```

### Task 3: Enhance Input Experience
```
1. Review latex-paste-handler.ts for paste handling
2. Implement proper shortcut handling in MathLive config
3. Add visual feedback for structure creation (fractions, etc.)
4. Improve error messages for invalid LaTeX
5. Add autocomplete for common LaTeX commands
```

### Task 4: Fix Node Lifecycle
```
1. Review mathlive-node.tsx NodeView implementation
2. Fix content synchronization between MathLive and Tiptap
3. Implement proper undo/redo support
4. Add content validation before save
5. Handle edge cases (empty nodes, nested structures)
```

### Task 5: Improve Rendering
```
1. Fix inline math vertical alignment CSS
2. Ensure block math is properly centered
3. Match font size with surrounding prose
4. Fix dark mode color scheme for math
5. Add proper spacing around math elements
```

## Acceptance Criteria

- [ ] Math fields focus correctly on click
- [ ] Quantum keyboard inserts symbols to correct field
- [ ] LaTeX shortcuts work consistently
- [ ] Undo/redo works with math content
- [ ] Math renders correctly in both light and dark modes
- [ ] No console errors during math editing

## Testing

```bash
# Run existing tests
npm run test:run -- math
npm run test:run -- formula

# Manual testing
1. Create a new markdown file
2. Insert inline math with $...$
3. Insert block math with $$...$$
4. Test Quantum keyboard (double-tap Tab)
5. Test undo/redo with math content
6. Save and reload to verify persistence
```

## Code Examples

### Expected MathLive Focus Behavior
```typescript
// When clicking a math field, it should:
// 1. Focus the MathLive element
// 2. Update the active math field reference
// 3. Position cursor at click location
// 4. Enable Quantum keyboard trigger
```

### Expected Quantum Keyboard Flow
```typescript
// 1. User double-taps Tab in math field
// 2. Keyboard appears, positioned to not block field
// 3. User presses key (e.g., 'a' for α)
// 4. Symbol inserted at cursor in active math field
// 5. Keyboard remains open for more input
// 6. Escape closes keyboard, focus returns to math field
```

## Notes

- MathLive has its own virtual keyboard; ensure it doesn't conflict with Quantum keyboard
- Consider adding a toggle between MathLive keyboard and Quantum keyboard
- Test with complex formulas (matrices, integrals, nested fractions)
