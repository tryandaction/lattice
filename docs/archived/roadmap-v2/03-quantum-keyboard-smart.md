# Prompt 03: Quantum Keyboard Smart Positioning

## Priority: P1 (High)

## Overview

The Quantum Keyboard is a core differentiator for Lattice, enabling fast LaTeX input for STEM users. Currently, it may block the formula being edited. This prompt implements **intelligent positioning** that ensures the keyboard never obscures the user's work.

---

## Related Files

- `src/components/hud/keyboard-hud.tsx` - Main keyboard component
- `src/components/hud/hud-provider.tsx` - Global HUD management
- `src/stores/hud-store.ts` - HUD state
- `src/components/hud/shadow-keyboard.tsx` - Keyboard layout
- `src/styles/quantum-keyboard.css` - Keyboard styles

---

## Current Problems

1. **Blocking**: Keyboard may cover the formula being edited
2. **Static Position**: Doesn't adapt to where formula is on screen
3. **No Visual Connection**: Hard to see which formula is being edited
4. **Edge Cases**: May go off-screen at edges

---

## Feature 1: Smart Position Calculation

### Goal
Keyboard should position itself to **never overlap** the active math-field, preferring to be above if space allows, otherwise below.

### Implementation Details

#### 1.1 Get Math-Field Bounding Box
```typescript
// In hud-store.ts or keyboard-hud.tsx
function getActiveMathFieldBounds(): DOMRect | null {
  const mathField = document.querySelector('math-field:focus') as HTMLElement;
  if (mathField) {
    return mathField.getBoundingClientRect();
  }

  // Fallback: check for active math-field from provider
  const { getActiveMathField } = require('./hud-provider');
  const activeMf = getActiveMathField();
  if (activeMf) {
    return activeMf.getBoundingClientRect();
  }

  return null;
}
```

#### 1.2 Calculate Optimal Position
```typescript
interface KeyboardPosition {
  x: number;
  y: number;
  placement: 'above' | 'below' | 'left' | 'right';
  arrowPosition: number; // For pointer arrow
}

function calculateOptimalPosition(
  mathFieldBounds: DOMRect,
  keyboardSize: { width: number; height: number },
  viewportSize: { width: number; height: number }
): KeyboardPosition {
  const MARGIN = 12; // Gap between keyboard and math-field
  const KEYBOARD_WIDTH = keyboardSize.width;
  const KEYBOARD_HEIGHT = keyboardSize.height;

  // Calculate available space in each direction
  const spaceAbove = mathFieldBounds.top;
  const spaceBelow = viewportSize.height - mathFieldBounds.bottom;
  const spaceLeft = mathFieldBounds.left;
  const spaceRight = viewportSize.width - mathFieldBounds.right;

  // Determine primary placement
  let placement: 'above' | 'below' | 'left' | 'right';
  let x: number;
  let y: number;

  // Prefer above or below (more natural for horizontal typing)
  if (spaceAbove >= KEYBOARD_HEIGHT + MARGIN) {
    placement = 'above';
    y = mathFieldBounds.top - KEYBOARD_HEIGHT - MARGIN;
  } else if (spaceBelow >= KEYBOARD_HEIGHT + MARGIN) {
    placement = 'below';
    y = mathFieldBounds.bottom + MARGIN;
  } else if (spaceRight >= KEYBOARD_WIDTH + MARGIN) {
    placement = 'right';
    y = Math.max(MARGIN, mathFieldBounds.top - KEYBOARD_HEIGHT / 2 + mathFieldBounds.height / 2);
    y = Math.min(y, viewportSize.height - KEYBOARD_HEIGHT - MARGIN);
  } else {
    placement = 'left';
    y = Math.max(MARGIN, mathFieldBounds.top - KEYBOARD_HEIGHT / 2 + mathFieldBounds.height / 2);
    y = Math.min(y, viewportSize.height - KEYBOARD_HEIGHT - MARGIN);
  }

  // Calculate horizontal position (center with math-field when above/below)
  if (placement === 'above' || placement === 'below') {
    x = mathFieldBounds.left + mathFieldBounds.width / 2 - KEYBOARD_WIDTH / 2;
    // Clamp to viewport
    x = Math.max(MARGIN, Math.min(x, viewportSize.width - KEYBOARD_WIDTH - MARGIN));
  } else if (placement === 'right') {
    x = mathFieldBounds.right + MARGIN;
  } else {
    x = mathFieldBounds.left - KEYBOARD_WIDTH - MARGIN;
  }

  // Calculate arrow position to point at math-field center
  const mathCenterX = mathFieldBounds.left + mathFieldBounds.width / 2;
  const arrowPosition = mathCenterX - x;

  return { x, y, placement, arrowPosition };
}
```

#### 1.3 Position Update on Math-Field Change
```typescript
// In keyboard-hud.tsx
useEffect(() => {
  if (!isOpen) return;

  const updatePosition = () => {
    const bounds = getActiveMathFieldBounds();
    if (bounds) {
      const keyboardSize = containerRef.current?.getBoundingClientRect() || { width: 400, height: 200 };
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const position = calculateOptimalPosition(bounds, keyboardSize, viewport);
      setPosition(position);
    }
  };

  // Update immediately
  updatePosition();

  // Update when math-field focus changes
  const observer = new MutationObserver(updatePosition);
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

  // Update on scroll/resize
  window.addEventListener('scroll', updatePosition, { passive: true, capture: true });
  window.addEventListener('resize', updatePosition);

  return () => {
    observer.disconnect();
    window.removeEventListener('scroll', updatePosition);
    window.removeEventListener('resize', updatePosition);
  };
}, [isOpen]);
```

### Acceptance Criteria
- [ ] Keyboard never overlaps active math-field
- [ ] Prefers above when space allows
- [ ] Falls back to below, then sides
- [ ] Updates position when clicking different formulas
- [ ] Stays within viewport bounds

---

## Feature 2: Visual Connection Line

### Goal
Show a subtle visual indicator connecting the keyboard to the formula being edited.

### Implementation Details

#### 2.1 Arrow/Pointer Element
```typescript
function KeyboardPointer({ placement, arrowPosition }: { placement: string; arrowPosition: number }) {
  if (placement === 'above') {
    return (
      <div
        className="absolute bottom-0 translate-y-full w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-background"
        style={{ left: `${arrowPosition}px` }}
      />
    );
  }
  if (placement === 'below') {
    return (
      <div
        className="absolute top-0 -translate-y-full w-0 h-0 border-l-8 border-r-8 border-b-8 border-transparent border-b-background"
        style={{ left: `${arrowPosition}px` }}
      />
    );
  }
  // ... left/right arrows
}
```

#### 2.2 Math-Field Highlight
```typescript
// When keyboard is open, highlight the active math-field
useEffect(() => {
  if (!isOpen) return;

  const mathField = getActiveMathField();
  if (mathField) {
    mathField.classList.add('quantum-keyboard-active');
  }

  return () => {
    document.querySelectorAll('.quantum-keyboard-active').forEach(el => {
      el.classList.remove('quantum-keyboard-active');
    });
  };
}, [isOpen]);
```

#### 2.3 CSS Styles
```css
/* Highlight active math-field */
.quantum-keyboard-active {
  box-shadow: 0 0 0 2px var(--primary);
  border-radius: 4px;
}

/* Subtle animation */
@keyframes quantum-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--primary); }
  50% { box-shadow: 0 0 0 4px var(--primary) / 0.5; }
}

.quantum-keyboard-active {
  animation: quantum-pulse 2s ease-in-out infinite;
}
```

### Acceptance Criteria
- [ ] Arrow points toward active math-field
- [ ] Math-field has visible highlight border
- [ ] Subtle pulsing animation
- [ ] Highlight removed when keyboard closes

---

## Feature 3: Smooth Position Transitions

### Goal
When position changes (user clicks different formula), keyboard should animate smoothly to new position.

### Implementation Details

#### 3.1 Framer Motion Transition
```typescript
// In keyboard-hud.tsx
<motion.div
  ref={containerRef}
  className="quantum-bubble"
  animate={{
    x: position.x + dragOffset.x,
    y: position.y + dragOffset.y,
    opacity: 1,
    scale: 1,
  }}
  initial={{
    opacity: 0,
    scale: 0.8,
  }}
  exit={{
    opacity: 0,
    scale: 0.8,
  }}
  transition={{
    type: "spring",
    stiffness: 300,
    damping: 25,
    mass: 0.8,
  }}
>
  {/* Keyboard content */}
</motion.div>
```

#### 3.2 Drag Override
```typescript
// Allow user to drag to custom position
// But return to auto-position when focusing new formula

const [hasUserOffset, setHasUserOffset] = useState(false);

const handleDragEnd = (event, info) => {
  setHasUserOffset(true);
  setUserOffset({
    x: position.x + info.offset.x,
    y: position.y + info.offset.y,
  });
};

// Reset user offset when active math-field changes
useEffect(() => {
  if (activeMathFieldId !== prevActiveMathFieldId) {
    setHasUserOffset(false);
    setUserOffset(null);
  }
}, [activeMathFieldId]);
```

### Acceptance Criteria
- [ ] Smooth spring animation to new position
- [ ] User can drag to override position
- [ ] Position resets when clicking new formula
- [ ] No jarring jumps

---

## Feature 4: Mini Mode Option

### Goal
Offer a compact "mini" keyboard mode for quick single-symbol input, expanding to full on demand.

### Implementation Details

#### 4.1 Mode Toggle
```typescript
type KeyboardMode = 'full' | 'mini';

function QuantumKeyboard({ mode, setMode }) {
  return (
    <div className={cn("quantum-keyboard", mode === 'mini' && "quantum-keyboard-mini")}>
      {/* Mode toggle button */}
      <button
        className="absolute top-1 right-1"
        onClick={() => setMode(mode === 'full' ? 'mini' : 'full')}
        title={mode === 'full' ? 'Collapse (Esc)' : 'Expand (Space)'}
      >
        {mode === 'full' ? <Minimize2 /> : <Maximize2 />}
      </button>

      {mode === 'mini' ? (
        <MiniKeyboard onExpandRequest={() => setMode('full')} />
      ) : (
        <FullKeyboard />
      )}
    </div>
  );
}
```

#### 4.2 Mini Keyboard Layout
```typescript
// Show only most-used symbols in a single row
function MiniKeyboard({ onExpandRequest, onInsert }) {
  const quickSymbols = [
    { label: 'α', latex: '\\alpha' },
    { label: 'β', latex: '\\beta' },
    { label: '∑', latex: '\\sum' },
    { label: '∫', latex: '\\int' },
    { label: '→', latex: '\\rightarrow' },
    { label: '±', latex: '\\pm' },
    { label: '√', latex: '\\sqrt{}' },
    { label: 'frac', latex: '\\frac{}{}' },
  ];

  return (
    <div className="flex items-center gap-1 p-2">
      {quickSymbols.map(s => (
        <button
          key={s.latex}
          className="w-8 h-8 rounded hover:bg-muted flex items-center justify-center text-sm"
          onClick={() => onInsert(s.latex)}
          title={s.latex}
        >
          {s.label}
        </button>
      ))}
      <button
        className="w-8 h-8 rounded hover:bg-muted flex items-center justify-center"
        onClick={onExpandRequest}
        title="More symbols (Space)"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Toggle between full and mini mode
- [ ] Mini shows common symbols in one row
- [ ] Click "..." expands to full
- [ ] Space key expands from mini
- [ ] Esc collapses to mini (or closes)

---

## Feature 5: Position Indicator

### Goal
Show which direction the keyboard is positioned relative to the formula.

### Implementation Details

```typescript
// In keyboard-hud.tsx
function PositionIndicator({ placement }) {
  const labels = {
    above: '↑ Above formula',
    below: '↓ Below formula',
    left: '← Left of formula',
    right: '→ Right of formula',
  };

  return (
    <div className="text-xs text-muted-foreground flex items-center gap-1 px-2 py-0.5 border-t">
      <span>{labels[placement]}</span>
      <button
        className="ml-auto hover:bg-muted rounded p-0.5"
        onClick={resetToAutoPosition}
        title="Reset position"
      >
        <RotateCcw className="h-3 w-3" />
      </button>
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Shows current position relative to formula
- [ ] Reset button returns to auto position
- [ ] Indicator updates when position changes

---

## Testing

### Manual Test Checklist

1. **Basic Positioning**
   - Create formula at TOP of document
   - Open quantum keyboard
   - Verify keyboard below formula

2. **Position at Bottom**
   - Create formula at BOTTOM of document
   - Open quantum keyboard
   - Verify keyboard above formula

3. **Position at Edges**
   - Create formula at LEFT edge
   - Verify keyboard doesn't go off-screen
   - Same for RIGHT edge

4. **Multiple Formulas**
   - Create 3 formulas at different positions
   - Open keyboard, click formula 1
   - Verify keyboard positions correctly
   - Click formula 2
   - Verify keyboard moves smoothly

5. **Drag Override**
   - Open keyboard
   - Drag to custom position
   - Verify it stays
   - Click different formula
   - Verify it resets to auto position

6. **Mini Mode**
   - Open keyboard
   - Toggle to mini
   - Insert symbol from mini
   - Expand to full
   - Verify functionality

---

## CSS Reference

```css
/* Add to quantum-keyboard.css */

.quantum-bubble {
  position: fixed;
  z-index: 9999;
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.quantum-bubble-mini {
  border-radius: 24px;
  padding: 4px;
}

/* Position arrows */
.quantum-arrow {
  position: absolute;
  width: 0;
  height: 0;
}

.quantum-arrow-down {
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-top: 10px solid var(--background);
  bottom: -10px;
}

.quantum-arrow-up {
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-bottom: 10px solid var(--background);
  top: -10px;
}
```

---

## Notes

- Test with different screen sizes
- Consider mobile touch interactions
- Performance: avoid excessive reflows
- Accessibility: ensure keyboard navigation works
