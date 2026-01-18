# MathLive Integration Plan - Quantum Keyboard

**Goal**: Implement visual formula editing with MathLive for the ultimate STEM formula editing experience.

**Status**: Week 3 - In Progress
**MathLive Version**: 0.108.2 (already installed)

---

## 🎯 User Requirements

From the original request:
> "量子键盘联合的公式编辑体验" (Quantum keyboard integrated formula editing experience)

**Interpretation**:
- Visual WYSIWYG formula editor (MathLive)
- Symbol palette for quick insertion
- Formula templates for common patterns
- Seamless integration with existing MathWidget

---

## 📚 MathLive API Overview

### Core Component: `<math-field>`

MathLive provides a custom HTML element `<math-field>` (MathfieldElement):

```typescript
import { MathfieldElement } from 'mathlive';

// Create math field
const mf = new MathfieldElement();
mf.value = 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}';

// Get/Set LaTeX
const latex = mf.value;
mf.value = '\\int_0^\\infty e^{-x^2} dx';

// Events
mf.addEventListener('input', (e) => {
  console.log('LaTeX changed:', mf.value);
});

// Focus/Blur
mf.focus();
mf.blur();
```

### Key Properties:

```typescript
interface MathfieldElement extends HTMLElement {
  // LaTeX content
  value: string;

  // Configuration
  options: MathfieldOptions;

  // Selection
  selection: Selection;

  // Methods
  insert(latex: string): void;
  executeCommand(command: string): void;
  focus(): void;
  blur(): void;

  // Events
  addEventListener('input', handler): void;
  addEventListener('change', handler): void;
  addEventListener('focus', handler): void;
  addEventListener('blur', handler): void;
}

interface MathfieldOptions {
  // Virtual keyboard
  virtualKeyboardMode: 'manual' | 'onfocus' | 'off';

  // Appearance
  defaultMode: 'math' | 'text';
  letterShapeStyle: 'auto' | 'tex' | 'iso' | 'french' | 'upright';

  // Behavior
  readOnly: boolean;
  removeExtraneousParentheses: boolean;

  // Macros
  macros: Record<string, string>;
}
```

---

## 🏗️ Integration Architecture

### Current State (Week 2):

```
User clicks formula → Cursor positioned → Raw LaTeX shown
User double-clicks → Formula selected → Can edit LaTeX source
User right-clicks → LaTeX copied to clipboard
```

### Target State (Week 3):

```
User clicks formula → Cursor positioned → Raw LaTeX shown (unchanged)
User double-clicks → MathLive editor opens → Visual WYSIWYG editing
User presses Ctrl+M → MathLive editor opens → Insert new formula
User right-clicks → LaTeX copied (unchanged)
```

### Integration Points:

1. **MathWidget Enhancement** (widgets.ts)
   - Add double-click handler to open MathLive
   - Create MathLive editor overlay
   - Handle save/cancel actions

2. **New Component: MathEditor** (math-editor.tsx)
   - React wrapper for MathfieldElement
   - Manages editor lifecycle
   - Handles keyboard shortcuts

3. **Symbol Palette** (math-symbol-palette.tsx)
   - Floating panel with categorized symbols
   - Click to insert into MathLive
   - Keyboard shortcut: Ctrl+Shift+M

4. **Formula Templates** (math-templates.ts)
   - Common formula patterns
   - Auto-complete: /frac → fraction
   - Quick insertion shortcuts

---

## 📝 Implementation Plan

### Phase 1: Basic MathLive Integration (Day 1-2)

**Goal**: Double-click formula → Open MathLive editor

**Files to Create:**
- `src/components/editor/math-editor.tsx` - React wrapper
- `src/components/editor/math-editor.css` - Styling

**Files to Modify:**
- `src/components/editor/codemirror/live-preview/widgets.ts` - MathWidget

**Implementation:**

```typescript
// math-editor.tsx
import { MathfieldElement } from 'mathlive';
import { useEffect, useRef, useState } from 'react';

interface MathEditorProps {
  initialLatex: string;
  isBlock: boolean;
  onSave: (latex: string) => void;
  onCancel: () => void;
  position: { top: number; left: number };
}

export function MathEditor({ initialLatex, isBlock, onSave, onCancel, position }: MathEditorProps) {
  const mathfieldRef = useRef<MathfieldElement | null>(null);

  useEffect(() => {
    // Create MathfieldElement
    const mf = new MathfieldElement();
    mf.value = initialLatex;
    mf.options = {
      virtualKeyboardMode: 'manual',
      defaultMode: 'math',
    };

    // Handle input
    mf.addEventListener('input', () => {
      // Live preview (optional)
    });

    // Handle keyboard shortcuts
    mf.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSave(mf.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    });

    mathfieldRef.current = mf;

    // Focus
    setTimeout(() => mf.focus(), 0);

    return () => {
      mf.remove();
    };
  }, []);

  return (
    <div
      className="math-editor-overlay"
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 1000,
      }}
    >
      <div className="math-editor-container">
        <div ref={(el) => el && el.appendChild(mathfieldRef.current!)} />
        <div className="math-editor-actions">
          <button onClick={() => onSave(mathfieldRef.current!.value)}>
            Save (Enter)
          </button>
          <button onClick={onCancel}>
            Cancel (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
```

**MathWidget Enhancement:**

```typescript
// In widgets.ts - MathWidget.toDOM()

// Add state management for editor
let editorOpen = false;

// Double-click handler (existing)
container.addEventListener('dblclick', (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (editorOpen) return;
  editorOpen = true;

  // Get position
  const rect = container.getBoundingClientRect();

  // Dispatch custom event to open MathEditor
  view.dom.dispatchEvent(new CustomEvent('open-math-editor', {
    detail: {
      latex: this.latex,
      isBlock: this.isBlock,
      from: this.from,
      to: this.to,
      position: { top: rect.bottom, left: rect.left },
    },
    bubbles: true,
  }));
});
```

**Integration in LivePreviewEditor:**

```typescript
// In live-preview-editor.tsx

const [mathEditor, setMathEditor] = useState<{
  latex: string;
  isBlock: boolean;
  from: number;
  to: number;
  position: { top: number; left: number };
} | null>(null);

useEffect(() => {
  const handleOpenMathEditor = (e: CustomEvent) => {
    setMathEditor(e.detail);
  };

  editorRef.current?.dom.addEventListener('open-math-editor', handleOpenMathEditor);

  return () => {
    editorRef.current?.dom.removeEventListener('open-math-editor', handleOpenMathEditor);
  };
}, []);

const handleMathSave = (latex: string) => {
  if (!mathEditor) return;

  // Update document
  editorRef.current?.dispatch({
    changes: {
      from: mathEditor.from,
      to: mathEditor.to,
      insert: mathEditor.isBlock ? `$$${latex}$$` : `$${latex}$`,
    },
  });

  setMathEditor(null);
};

// In render:
{mathEditor && (
  <MathEditor
    initialLatex={mathEditor.latex}
    isBlock={mathEditor.isBlock}
    onSave={handleMathSave}
    onCancel={() => setMathEditor(null)}
    position={mathEditor.position}
  />
)}
```

---

### Phase 2: Symbol Palette (Day 3)

**Goal**: Floating symbol palette for quick insertion

**File to Create:**
- `src/components/editor/math-symbol-palette.tsx`

**Symbol Categories:**

```typescript
const SYMBOL_CATEGORIES = {
  'Greek': {
    lowercase: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω'],
    uppercase: ['Α', 'Β', 'Γ', 'Δ', 'Ε', 'Ζ', 'Η', 'Θ', 'Ι', 'Κ', 'Λ', 'Μ', 'Ν', 'Ξ', 'Ο', 'Π', 'Ρ', 'Σ', 'Τ', 'Υ', 'Φ', 'Χ', 'Ψ', 'Ω'],
    latex: {
      'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
      'ε': '\\epsilon', 'θ': '\\theta', 'λ': '\\lambda', 'μ': '\\mu',
      'π': '\\pi', 'σ': '\\sigma', 'ω': '\\omega',
      'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda',
      'Π': '\\Pi', 'Σ': '\\Sigma', 'Ω': '\\Omega',
    },
  },
  'Operators': {
    symbols: ['∑', '∏', '∫', '∮', '∂', '∇', '±', '∓', '×', '÷', '·', '∘', '√', '∛', '∜'],
    latex: {
      '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∮': '\\oint',
      '∂': '\\partial', '∇': '\\nabla', '±': '\\pm', '∓': '\\mp',
      '×': '\\times', '÷': '\\div', '·': '\\cdot', '∘': '\\circ',
      '√': '\\sqrt{}', '∛': '\\sqrt[3]{}', '∜': '\\sqrt[4]{}',
    },
  },
  'Relations': {
    symbols: ['≤', '≥', '≠', '≈', '≡', '∈', '∉', '⊂', '⊃', '⊆', '⊇', '∝', '∞'],
    latex: {
      '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx',
      '≡': '\\equiv', '∈': '\\in', '∉': '\\notin', '⊂': '\\subset',
      '⊃': '\\supset', '⊆': '\\subseteq', '⊇': '\\supseteq',
      '∝': '\\propto', '∞': '\\infty',
    },
  },
  'Arrows': {
    symbols: ['→', '←', '↔', '⇒', '⇐', '⇔', '↑', '↓', '↗', '↘', '↖', '↙'],
    latex: {
      '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow',
      '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow',
      '↑': '\\uparrow', '↓': '\\downarrow',
    },
  },
  'Logic': {
    symbols: ['∀', '∃', '∧', '∨', '¬', '⊕', '⊗', '⊤', '⊥'],
    latex: {
      '∀': '\\forall', '∃': '\\exists', '∧': '\\land', '∨': '\\lor',
      '¬': '\\neg', '⊕': '\\oplus', '⊗': '\\otimes',
      '⊤': '\\top', '⊥': '\\bot',
    },
  },
  'Sets': {
    symbols: ['∅', '∞', 'ℝ', 'ℤ', 'ℕ', 'ℚ', 'ℂ', '∪', '∩', '∖'],
    latex: {
      '∅': '\\emptyset', '∞': '\\infty', 'ℝ': '\\mathbb{R}',
      'ℤ': '\\mathbb{Z}', 'ℕ': '\\mathbb{N}', 'ℚ': '\\mathbb{Q}',
      'ℂ': '\\mathbb{C}', '∪': '\\cup', '∩': '\\cap', '∖': '\\setminus',
    },
  },
};
```

**Component:**

```typescript
export function MathSymbolPalette({
  onInsert,
  onClose
}: {
  onInsert: (latex: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="math-symbol-palette">
      <div className="palette-header">
        <h3>Math Symbols</h3>
        <button onClick={onClose}>×</button>
      </div>

      {Object.entries(SYMBOL_CATEGORIES).map(([category, data]) => (
        <div key={category} className="symbol-category">
          <h4>{category}</h4>
          <div className="symbol-grid">
            {data.symbols.map((symbol) => (
              <button
                key={symbol}
                className="symbol-button"
                onClick={() => onInsert(data.latex[symbol])}
                title={data.latex[symbol]}
              >
                {symbol}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Keyboard Shortcut:**
- `Ctrl+Shift+M`: Toggle symbol palette
- Palette appears next to MathEditor when open
- Can also be used standalone to insert formulas

---

### Phase 3: Formula Templates (Day 4-5)

**Goal**: Quick insertion of common formula patterns

**File to Create:**
- `src/lib/math-templates.ts`

**Template Library:**

```typescript
export const MATH_TEMPLATES = {
  // Fractions
  'frac': {
    latex: '\\frac{#?}{#?}',
    description: 'Fraction',
    category: 'Basic',
  },
  'dfrac': {
    latex: '\\dfrac{#?}{#?}',
    description: 'Display fraction',
    category: 'Basic',
  },

  // Roots
  'sqrt': {
    latex: '\\sqrt{#?}',
    description: 'Square root',
    category: 'Basic',
  },
  'nthroot': {
    latex: '\\sqrt[#?]{#?}',
    description: 'Nth root',
    category: 'Basic',
  },

  // Calculus
  'integral': {
    latex: '\\int_{#?}^{#?} #? \\, d#?',
    description: 'Definite integral',
    category: 'Calculus',
  },
  'iintegral': {
    latex: '\\int #? \\, d#?',
    description: 'Indefinite integral',
    category: 'Calculus',
  },
  'sum': {
    latex: '\\sum_{#?}^{#?} #?',
    description: 'Summation',
    category: 'Calculus',
  },
  'prod': {
    latex: '\\prod_{#?}^{#?} #?',
    description: 'Product',
    category: 'Calculus',
  },
  'limit': {
    latex: '\\lim_{#? \\to #?} #?',
    description: 'Limit',
    category: 'Calculus',
  },
  'derivative': {
    latex: '\\frac{d}{d#?} #?',
    description: 'Derivative',
    category: 'Calculus',
  },
  'partial': {
    latex: '\\frac{\\partial #?}{\\partial #?}',
    description: 'Partial derivative',
    category: 'Calculus',
  },

  // Linear Algebra
  'matrix': {
    latex: '\\begin{pmatrix} #? & #? \\\\ #? & #? \\end{pmatrix}',
    description: '2×2 Matrix',
    category: 'Linear Algebra',
  },
  'matrix3': {
    latex: '\\begin{pmatrix} #? & #? & #? \\\\ #? & #? & #? \\\\ #? & #? & #? \\end{pmatrix}',
    description: '3×3 Matrix',
    category: 'Linear Algebra',
  },
  'vector': {
    latex: '\\begin{pmatrix} #? \\\\ #? \\\\ #? \\end{pmatrix}',
    description: 'Column vector',
    category: 'Linear Algebra',
  },
  'determinant': {
    latex: '\\begin{vmatrix} #? & #? \\\\ #? & #? \\end{vmatrix}',
    description: 'Determinant',
    category: 'Linear Algebra',
  },

  // Physics
  'schrodinger': {
    latex: 'i\\hbar\\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi',
    description: 'Schrödinger equation',
    category: 'Physics',
  },
  'maxwell1': {
    latex: '\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\epsilon_0}',
    description: "Gauss's law",
    category: 'Physics',
  },
  'maxwell2': {
    latex: '\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}',
    description: "Faraday's law",
    category: 'Physics',
  },

  // Statistics
  'mean': {
    latex: '\\bar{#?} = \\frac{1}{n}\\sum_{i=1}^{n} #?_i',
    description: 'Mean',
    category: 'Statistics',
  },
  'variance': {
    latex: '\\sigma^2 = \\frac{1}{n}\\sum_{i=1}^{n} (#?_i - \\bar{#?})^2',
    description: 'Variance',
    category: 'Statistics',
  },
  'normal': {
    latex: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}',
    description: 'Normal distribution',
    category: 'Statistics',
  },
};

// Auto-complete function
export function getTemplateByPrefix(prefix: string): typeof MATH_TEMPLATES[keyof typeof MATH_TEMPLATES] | null {
  const key = prefix.toLowerCase().replace(/^\//, '');
  return MATH_TEMPLATES[key] || null;
}

// Insert template with placeholders
export function insertTemplate(mathfield: MathfieldElement, template: string): void {
  mathfield.insert(template);
  // Move to first placeholder
  mathfield.executeCommand('moveToNextPlaceholder');
}
```

**Auto-complete Integration:**

```typescript
// In MathEditor component
mf.addEventListener('input', () => {
  const value = mf.value;

  // Check for template trigger
  if (value.startsWith('/')) {
    const template = getTemplateByPrefix(value);
    if (template) {
      // Show template suggestion
      showTemplateSuggestion(template);
    }
  }
});

mf.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && currentSuggestion) {
    e.preventDefault();
    insertTemplate(mf, currentSuggestion.latex);
  }
});
```

---

## 🎨 UI/UX Design

### MathEditor Appearance:

```css
.math-editor-overlay {
  position: absolute;
  z-index: 1000;
  background: white;
  border: 2px solid var(--primary);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 12px;
  min-width: 400px;
}

.math-editor-container math-field {
  font-size: 18px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  min-height: 60px;
}

.math-editor-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  justify-content: flex-end;
}

.math-editor-actions button {
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--background);
  cursor: pointer;
}

.math-editor-actions button:hover {
  background: var(--accent);
}
```

### Symbol Palette Appearance:

```css
.math-symbol-palette {
  position: fixed;
  right: 20px;
  top: 100px;
  width: 300px;
  max-height: 600px;
  overflow-y: auto;
  background: white;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 16px;
  z-index: 999;
}

.symbol-category {
  margin-bottom: 16px;
}

.symbol-category h4 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--foreground);
}

.symbol-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
}

.symbol-button {
  aspect-ratio: 1;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--background);
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.symbol-button:hover {
  background: var(--accent);
  transform: scale(1.1);
}
```

---

## 🧪 Testing Plan

### Manual Testing:

1. **Basic Editing:**
   - [ ] Double-click inline formula opens MathLive
   - [ ] Double-click block formula opens MathLive
   - [ ] Enter saves changes
   - [ ] Escape cancels changes
   - [ ] Changes persist after save

2. **Symbol Palette:**
   - [ ] Ctrl+Shift+M opens palette
   - [ ] Click symbol inserts into MathLive
   - [ ] All 6 categories render correctly
   - [ ] Palette closes when clicking outside

3. **Templates:**
   - [ ] /frac auto-completes to fraction
   - [ ] Tab inserts template
   - [ ] Placeholders navigate correctly
   - [ ] All template categories work

4. **Integration:**
   - [ ] MathLive works with cursor reveal
   - [ ] No conflicts with existing MathWidget
   - [ ] Performance is smooth
   - [ ] No memory leaks

### Performance Testing:

- [ ] Opening MathLive < 100ms
- [ ] Symbol insertion < 50ms
- [ ] Template insertion < 50ms
- [ ] No lag when typing in MathLive

---

## 📊 Success Criteria

### Minimum Viable Product (MVP):
- ✅ Double-click formula opens MathLive editor
- ✅ Enter saves, Escape cancels
- ✅ Basic symbol palette (Greek, Operators)
- ✅ 5 essential templates (frac, sqrt, integral, sum, matrix)

### Full Feature Set:
- ✅ Complete symbol palette (6 categories, 100+ symbols)
- ✅ Complete template library (30+ templates)
- ✅ Auto-complete with /prefix
- ✅ Keyboard shortcuts (Ctrl+M, Ctrl+Shift+M)
- ✅ Visual polish and animations

### Excellence:
- ✅ Custom macros support
- ✅ Formula history/favorites
- ✅ Multi-cursor editing
- ✅ Collaborative editing support

---

## 🚀 Implementation Timeline

### Day 1-2: Basic MathLive Integration
- Create MathEditor component
- Enhance MathWidget with double-click
- Integrate with LivePreviewEditor
- Basic styling

### Day 3: Symbol Palette
- Create MathSymbolPalette component
- Implement 6 symbol categories
- Add keyboard shortcut
- Styling and animations

### Day 4-5: Formula Templates
- Create math-templates.ts
- Implement auto-complete
- Add Tab insertion
- Test all templates

### Day 6-7: Polish and Testing
- Visual refinements
- Performance optimization
- Comprehensive testing
- Documentation

---

## 📝 Notes

### MathLive Configuration:

```typescript
const mathfieldOptions: MathfieldOptions = {
  // Disable virtual keyboard (we have symbol palette)
  virtualKeyboardMode: 'off',

  // Math mode by default
  defaultMode: 'math',

  // Remove extra parentheses
  removeExtraneousParentheses: true,

  // Custom macros
  macros: {
    '\\RR': '\\mathbb{R}',
    '\\ZZ': '\\mathbb{Z}',
    '\\NN': '\\mathbb{N}',
    '\\QQ': '\\mathbb{Q}',
    '\\CC': '\\mathbb{C}',
  },
};
```

### Accessibility:

- MathLive has built-in screen reader support
- Keyboard navigation fully supported
- High contrast mode compatible
- Focus management handled automatically

### Browser Compatibility:

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support
- MathLive uses Web Components (widely supported)

---

**Status**: Ready to implement Phase 1
**Next Step**: Create MathEditor component
**Expected Completion**: Week 3 (5-7 days)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
