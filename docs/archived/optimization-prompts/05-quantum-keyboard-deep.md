# Prompt 05: Quantum Keyboard Deep Development

## Priority: P2 (Medium)

## Context

The Quantum Keyboard is a unique feature for math symbol input, mapping physical keyboard keys to mathematical symbols. While the basic implementation works, it needs deeper development to reach its full potential.

## Related Files

- `src/components/hud/keyboard-hud.tsx` - Main HUD component
- `src/components/hud/shadow-keyboard.tsx` - Visual keyboard layout
- `src/components/hud/keycap.tsx` - Individual key component
- `src/components/hud/symbol-selector.tsx` - Variant symbol selector
- `src/components/hud/variant-menu.tsx` - Variant menu popup
- `src/components/hud/hud-provider.tsx` - Context provider
- `src/components/hud/hud-logic.ts` - Core logic
- `src/stores/hud-store.ts` - State management
- `src/stores/quantum-custom-store.ts` - Custom symbol storage
- `src/config/quantum-keymap.ts` - Symbol mappings
- `src/hooks/use-double-tap.ts` - Trigger detection

## Current Issues

### Issue 1: Symbol Coverage
- Missing common mathematical symbols
- Greek letter variants incomplete
- Operator coverage gaps
- No support for combining characters
- Limited structure templates (matrices, etc.)

### Issue 2: User Customization
- Custom symbol addition UI not intuitive
- No way to reorder symbols
- Custom symbols don't persist reliably
- No import/export for custom mappings
- No preset symbol sets (physics, chemistry, etc.)

### Issue 3: Visual Feedback
- Key flash animation too subtle
- No indication of available variants
- Symbol preview too small
- Dark mode contrast issues
- Glassmorphism effect inconsistent

### Issue 4: Input Flow
- Shift+key for variants not discoverable
- Arrow key navigation in variant menu slow
- No search/filter for symbols
- Recent symbols not tracked
- No favorites system

### Issue 5: Integration
- Doesn't work in all math contexts
- Conflicts with MathLive's own keyboard
- Position doesn't adapt to different editors
- No support for non-MathLive math input
- Keyboard shortcuts conflict with system

## Tasks

### Task 1: Expand Symbol Coverage
```
1. Review quantum-keymap.ts for gaps
2. Add missing Greek letters and variants
3. Add more operators (set theory, logic, etc.)
4. Add structure templates (matrices, cases, etc.)
5. Add combining characters (accents, etc.)
```

### Task 2: Improve Customization
```
1. Redesign custom symbol addition UI
2. Implement drag-to-reorder for symbols
3. Fix persistence in quantum-custom-store.ts
4. Add import/export functionality
5. Create preset symbol sets
```

### Task 3: Enhance Visual Feedback
```
1. Improve key flash animation visibility
2. Add variant indicator (dot or badge)
3. Increase symbol preview size
4. Fix dark mode colors
5. Improve glassmorphism consistency
```

### Task 4: Improve Input Flow
```
1. Add tooltip hints for Shift+key
2. Speed up variant menu navigation
3. Implement symbol search
4. Add recent symbols section
5. Implement favorites with star toggle
```

### Task 5: Better Integration
```
1. Detect math context before showing HUD
2. Add option to disable MathLive keyboard
3. Implement smart positioning
4. Support CodeMirror math input
5. Review keyboard shortcut conflicts
```

## Acceptance Criteria

- [ ] All common math symbols accessible
- [ ] Custom symbols persist correctly
- [ ] Visual feedback is clear and consistent
- [ ] Symbol input flow is smooth and fast
- [ ] Works in all math editing contexts
- [ ] No conflicts with other keyboards

## Testing

```bash
# Run existing tests
npm run test:run -- hud
npm run test:run -- quantum
npm run test:run -- keymap

# Manual testing
1. Open markdown editor with MathLive
2. Double-tap Tab to open Quantum keyboard
3. Test all key mappings
4. Test Shift+key for variants
5. Add custom symbols and verify persistence
6. Test in different contexts (inline, block math)
```

## Symbol Categories to Cover

### Greek Letters
```
Lowercase: α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω
Uppercase: Α Β Γ Δ Ε Ζ Η Θ Ι Κ Λ Μ Ν Ξ Ο Π Ρ Σ Τ Υ Φ Χ Ψ Ω
Variants: ϵ ϑ ϰ ϕ ϱ ϖ
```

### Operators
```
Basic: + − × ÷ ± ∓
Relations: = ≠ < > ≤ ≥ ≪ ≫ ≈ ≡ ∝ ∼
Set: ∈ ∉ ⊂ ⊃ ⊆ ⊇ ∪ ∩ ∅
Logic: ∧ ∨ ¬ ⇒ ⇔ ∀ ∃
Calculus: ∂ ∇ ∫ ∮ ∑ ∏ √
```

### Structures
```
Fractions: \frac{}{} 
Roots: \sqrt{} \sqrt[]{}
Scripts: ^{} _{}
Matrices: \begin{matrix}...\end{matrix}
Cases: \begin{cases}...\end{cases}
```

## Notes

- Consider adding a "learning mode" that shows LaTeX equivalents
- Track usage statistics to optimize default symbol placement
- Consider voice input for accessibility
- Test with different keyboard layouts (QWERTY, AZERTY, etc.)
