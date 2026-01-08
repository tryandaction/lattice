# Live Preview Editor Test

This is a test document for the **Obsidian-style** Live Preview editor.

## Features to Test

### Inline Formatting

- **Bold text** should render without asterisks
- *Italic text* should render without asterisks
- ~~Strikethrough~~ should have a line through it
- ==Highlighted text== should have a yellow background
- `inline code` should have a code background

### Links

- [External link](https://example.com) - Ctrl+Click to open
- [[wiki-link]] - Internal wiki link
- [[wiki-link|Custom Display]] - Aliased wiki link

### Math

Inline math: $E = mc^2$

Block math:

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

### Code Block

```javascript
function hello() {
  console.log("Hello, Live Preview!");
  return 42;
}
```

```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
```

### Lists

#### Bullet List
- First item
- Second item
  - Nested item
  - Another nested
- Third item

#### Numbered List
1. First step
2. Second step
3. Third step

#### Task List
- [ ] Unchecked task
- [x] Completed task
- [ ] Another task

### Blockquote

> This is a blockquote.
> It can span multiple lines.
> 
> And have multiple paragraphs.

### Table

| Feature | Status | Notes |
|---------|--------|-------|
| Bold | ✅ | Working |
| Italic | ✅ | Working |
| Links | ✅ | Working |
| Math | ✅ | KaTeX |
| Code | ✅ | Highlight.js |

### Horizontal Rule

---

### Image

![Sample Image](https://via.placeholder.com/300x200)

## Keyboard Shortcuts

- `Ctrl+B` - Bold
- `Ctrl+I` - Italic
- `Ctrl+K` - Insert link
- `Ctrl+E` - Cycle view modes
- `Ctrl+S` - Save
- `Ctrl+F` - Find
- `Ctrl+H` - Find and replace

## View Modes

Press `Ctrl+E` to cycle between:
1. **Live Preview** - Rendered with cursor-based syntax reveal
2. **Source** - Raw markdown with syntax highlighting
3. **Reading** - Fully rendered, non-editable

---

*End of test document*
