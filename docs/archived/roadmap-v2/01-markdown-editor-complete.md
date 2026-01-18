# Prompt 01: Markdown Editor Complete Enhancement

## Priority: P1 (High)

## Overview

Transform the Markdown editor into a **Notion/Obsidian-class** editing experience specifically optimized for STEM users. This prompt focuses on making tables, formulas, and structured content work flawlessly.

---

## Related Files

- `src/components/editor/advanced-markdown-editor.tsx` - Main editor
- `src/components/editor/extensions/` - All TipTap extensions
- `src/lib/content-normalizer.ts` - Content processing
- `src/styles/` - Editor styles (create if needed)

---

## Feature 1: Perfect Table Support

### Current State
- Tables may not render from Markdown syntax
- No easy way to create tables
- Cell editing may be awkward

### Target State
- Paste `| a | b |` converts to visual table
- Type `|---|---|` on empty line creates table
- Tables are fully editable with visual UI
- Can add/remove rows/columns easily
- Support alignment (left, center, right)

### Implementation Details

#### 1.1 Markdown Table Paste Detection
```typescript
// In markdown-paste-handler.ts
// Detect table patterns like:
// | Header 1 | Header 2 |
// |----------|----------|
// | Cell 1   | Cell 2   |

const TABLE_PATTERN = /^\|(.+\|)+\s*\n\|[\s:-]+\|/m;

function parseMarkdownTable(text: string): TableData | null {
  // Parse markdown table into rows/columns
  // Handle alignment markers (:---, :---:, ---:)
  // Return structured table data
}
```

#### 1.2 Table Input Rule
```typescript
// In table-input-rule.ts
// When user types |---|---| and presses Enter
// Create a 2-column table

const tableInputRule = new InputRule({
  find: /^\|[-:]+\|[-:|\s]+\|?\s*$/,
  handler: ({ state, range, chain }) => {
    // Count columns from dashes
    // Create table with appropriate columns
    // Insert and focus first cell
  }
});
```

#### 1.3 Table Toolbar Enhancement
```typescript
// Add floating toolbar when table is selected
// Options:
// - Add row above/below
// - Add column left/right
// - Delete row/column
// - Set column alignment
// - Delete entire table
// - Convert to Markdown (for copy)
```

#### 1.4 Table Styling
```css
/* Ensure tables look great */
.ProseMirror table {
  border-collapse: collapse;
  width: 100%;
  margin: 1rem 0;
}

.ProseMirror th,
.ProseMirror td {
  border: 1px solid var(--border);
  padding: 0.5rem 0.75rem;
  min-width: 80px;
}

.ProseMirror th {
  background: var(--muted);
  font-weight: 600;
}

/* Selected cell highlight */
.ProseMirror .selectedCell {
  background: var(--accent) / 0.2;
}
```

### Acceptance Criteria
- [ ] Pasting Markdown table creates visual table
- [ ] Typing `|---|---|` + Enter creates 2-column table
- [ ] Can add/remove rows and columns
- [ ] Column alignment works (left/center/right)
- [ ] Tab navigates between cells
- [ ] Table looks clean in both themes

---

## Feature 2: Formula Rendering in All Contexts

### Current State
- `$formula$` works in plain paragraphs
- May fail inside tables, bold, or other formatting
- Inconsistent behavior

### Target State
- Formulas render in ANY text context
- `**$E=mc^2$**` shows bold formula
- Table cells can contain formulas
- List items can contain formulas

### Implementation Details

#### 2.1 Math Detection Post-Processor
```typescript
// After content is set, scan for unprocessed math
// This catches math that was missed by input rules

function postProcessMath(editor: Editor): void {
  const doc = editor.state.doc;
  const mathPattern = /\$([^$]+)\$/g;

  // Find text nodes containing unprocessed $...$
  // Replace with proper math nodes
  // Handle inline and block math
}
```

#### 2.2 Allow Math in Nested Nodes
```typescript
// Ensure math nodes can exist inside:
// - Table cells (td, th)
// - Bold (strong)
// - Italic (em)
// - Lists (li)
// - Blockquotes

// Update node specs to allow math as child
const TableCell = TableCell.extend({
  content: 'block+',
  // Ensure inlineMathLive is allowed in content
});
```

#### 2.3 Math in Paste Handler
```typescript
// When pasting, preserve math markers
// Even inside other formatting

function handlePasteWithMath(text: string): Fragment {
  // Tokenize text to identify math regions
  // Create appropriate nodes for each region
  // Preserve surrounding formatting
}
```

### Acceptance Criteria
- [ ] `$x^2$` in table cell renders
- [ ] `**$E=mc^2$**` renders as bold formula
- [ ] `- $formula$` in list renders
- [ ] `> $formula$` in blockquote renders
- [ ] Formulas editable with quantum keyboard in all contexts

---

## Feature 3: List Formatting Excellence

### Current State
- Basic lists work
- Nested lists may not indent properly
- Mixed list types problematic

### Target State
- Clean visual hierarchy for nested lists
- Proper symbols at each level
- Mixed lists (bullet + numbered) work
- Task lists (`- [ ]`) supported
- Easy indent/outdent with Tab/Shift+Tab

### Implementation Details

#### 3.1 List Extension Configuration
```typescript
// In advanced-markdown-editor.tsx
import { BulletList } from '@tiptap/extension-bullet-list';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { ListItem } from '@tiptap/extension-list-item';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';

// Configure for proper nesting
BulletList.configure({
  HTMLAttributes: {
    class: 'bullet-list',
  },
  itemTypeName: 'listItem',
  keepMarks: true,
  keepAttributes: true,
});
```

#### 3.2 List CSS
```css
/* Bullet list levels */
.ProseMirror ul {
  list-style-type: disc;
  padding-left: 1.5rem;
}
.ProseMirror ul ul {
  list-style-type: circle;
}
.ProseMirror ul ul ul {
  list-style-type: square;
}
.ProseMirror ul ul ul ul {
  list-style-type: disc;
}

/* Ordered list levels */
.ProseMirror ol {
  list-style-type: decimal;
  padding-left: 1.5rem;
}
.ProseMirror ol ol {
  list-style-type: lower-alpha;
}
.ProseMirror ol ol ol {
  list-style-type: lower-roman;
}

/* Task lists */
.ProseMirror .task-list {
  list-style-type: none;
  padding-left: 0;
}
.ProseMirror .task-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}
.ProseMirror .task-item input[type="checkbox"] {
  margin-top: 0.25rem;
}
```

#### 3.3 List Keyboard Shortcuts
```typescript
// Tab to indent, Shift+Tab to outdent
// Enter on empty list item exits list
// Backspace at start of list item outdents

const listKeymap = {
  'Tab': () => editor.commands.sinkListItem('listItem'),
  'Shift-Tab': () => editor.commands.liftListItem('listItem'),
  'Enter': handleListEnter,
  'Backspace': handleListBackspace,
};
```

### Acceptance Criteria
- [ ] 4 levels of nesting with visual differentiation
- [ ] Tab/Shift+Tab indent/outdent
- [ ] Bullet and numbered lists have distinct styles
- [ ] Task lists render with checkboxes
- [ ] Enter on empty item exits list
- [ ] Lists paste correctly from clipboard

---

## Feature 4: Enhanced Toolbar

### Current State
- Basic formatting buttons
- May be missing some features

### Target State
- Complete formatting toolbar
- Clear visual grouping
- Keyboard shortcuts shown in tooltips
- Active state clearly visible

### Implementation Details

#### 4.1 Toolbar Layout
```
[Undo][Redo] | [B][I][U][S] | [H1][H2][H3] | [•][1.][☑] | [</>][❝] | [≡][Σ][∑] | [📷][🔗]
```

Groups:
1. History: Undo, Redo
2. Text: Bold, Italic, Underline, Strikethrough
3. Headings: H1, H2, H3
4. Lists: Bullet, Numbered, Task
5. Blocks: Code, Quote
6. Tables & Math: Table, Inline Math, Block Math
7. Media: Image, Link

#### 4.2 Tooltip with Shortcuts
```typescript
<ToolbarButton
  onClick={() => editor.chain().focus().toggleBold().run()}
  isActive={editor.isActive('bold')}
  title="Bold (Ctrl+B)"
  shortcut="Ctrl+B"
>
  <Bold className="h-4 w-4" />
</ToolbarButton>
```

### Acceptance Criteria
- [ ] All formatting options accessible
- [ ] Tooltips show keyboard shortcuts
- [ ] Active state clearly visible
- [ ] Responsive on narrow screens (collapse to menu)

---

## Feature 5: Code Block Enhancement

### Current State
- Basic code blocks work
- May lack syntax highlighting
- No language selector

### Target State
- Syntax highlighting for common languages
- Language selector dropdown
- Copy button on code blocks
- Line numbers option

### Implementation Details

#### 5.1 Code Block Extension
```typescript
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { lowlight } from 'lowlight';

// Register common languages
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import latex from 'highlight.js/lib/languages/latex';
// ... more languages

lowlight.registerLanguage('javascript', javascript);
lowlight.registerLanguage('python', python);
// ...

CodeBlockLowlight.configure({
  lowlight,
  defaultLanguage: 'plaintext',
});
```

#### 5.2 Code Block UI
```typescript
// Floating toolbar for code blocks
// - Language dropdown
// - Copy button
// - Line numbers toggle

function CodeBlockToolbar({ editor, node }) {
  return (
    <div className="code-block-toolbar">
      <LanguageSelect
        value={node.attrs.language}
        onChange={(lang) => /* update language */}
      />
      <Button onClick={() => copyCode()}>
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Syntax highlighting for 10+ languages
- [ ] Can change language via dropdown
- [ ] Copy button works
- [ ] Code is monospace with proper styling

---

## Feature 6: Image Enhancement

### Current State
- Images can be pasted
- Basic display

### Target State
- Drag & drop images
- Resize handles
- Caption support
- Alignment options

### Implementation Details

#### 6.1 Image Extension Enhancement
```typescript
import { Image } from '@tiptap/extension-image';

const EnhancedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },
      height: { default: null },
      align: { default: 'center' },
      caption: { default: null },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      // Return custom node view with:
      // - Resize handles
      // - Alignment buttons
      // - Caption input
    };
  },
});
```

### Acceptance Criteria
- [ ] Drag & drop to insert images
- [ ] Resize with handles
- [ ] Center/left/right alignment
- [ ] Optional caption
- [ ] Images saved to workspace

---

## Testing

### Automated
```bash
npm run test:run -- editor
```

### Manual Test Cases

1. **Tables**
   - Paste `| A | B |\n|---|---|\n| 1 | 2 |`
   - Verify renders as table
   - Add row, add column
   - Check alignment

2. **Formulas in Context**
   - Type `| $x^2$ | $y^2$ |` in table
   - Type `**$E=mc^2$**`
   - Verify all render

3. **Lists**
   - Create 4-level nested list
   - Check indentation visual
   - Tab/Shift+Tab
   - Create task list

4. **Code Blocks**
   - Create Python code block
   - Verify syntax highlighting
   - Change language
   - Copy code

---

## Priority Order

1. Tables (most requested)
2. Formulas in context (STEM critical)
3. Lists (frequently used)
4. Code blocks (developer use)
5. Images (nice to have)

---

## Notes

- Consider performance with large documents
- Test with existing user documents
- Ensure backwards compatibility with saved content
- Add analytics to track which features are used most
