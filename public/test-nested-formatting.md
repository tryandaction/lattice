# Nested Formatting Test

This file tests nested formatting scenarios to ensure no text duplication occurs.

## Basic Nested Formatting

### Bold with Italic
- **Bold with *italic* inside**
- ***Bold and italic together***
- *Italic with **bold** inside*

### Bold with Code
- **Bold with `code` inside**
- `Code with **bold** inside` (should not render bold)

### Bold with Math
- **Bold with $x^2$ formula**
- $x^2$ with **bold** nearby

### Italic with Code
- *Italic with `code` inside*
- `Code with *italic* inside` (should not render italic)

### Italic with Math
- *Italic with $y = mx + b$ formula*
- $y = mx + b$ with *italic* nearby

## Complex Nested Formatting

### Triple Nesting
- **Bold with *italic and `code`* inside**
- *Italic with **bold and `code`** inside*
- ***Bold italic with `code` inside***

### Formatting with Links
- **Bold [link](https://example.com) inside**
- *Italic [link](https://example.com) inside*
- [Link with **bold** text](https://example.com)
- [Link with *italic* text](https://example.com)

### Formatting with Images
- **Bold ![image](/icons/icon-72x72.png) inside**
- *Italic ![image](/icons/icon-72x72.png) inside*

### Formatting with Strikethrough
- **Bold with ~~strikethrough~~ inside**
- *Italic with ~~strikethrough~~ inside*
- ~~Strikethrough with **bold** inside~~
- ~~Strikethrough with *italic* inside~~

### Formatting with Highlight
- **Bold with ==highlight== inside**
- *Italic with ==highlight== inside*
- ==Highlight with **bold** inside==
- ==Highlight with *italic* inside==

## Edge Cases

### Adjacent Formatting
- **bold1** **bold2** (two bold elements side by side)
- *italic1* *italic2* (two italic elements side by side)
- `code1` `code2` (two code elements side by side)

### Overlapping Markers (Invalid Markdown)
- **bold *italic** still italic* (malformed)
- *italic **bold* still bold** (malformed)

### Multiple Formulas
- $x^2$ and $y^2$ in same line
- **Bold with $a$ and $b$ formulas**

### Formatting in Headings
# Heading with **bold**
## Heading with *italic*
### Heading with `code`
#### Heading with $x^2$ formula
##### Heading with **bold *and* italic**

### Formatting in Lists
- **Bold** item
- *Italic* item
- `Code` item
- $x^2$ formula item
- **Bold with *italic* and `code`** complex item

### Formatting in Blockquotes
> **Bold** quote
> *Italic* quote
> `Code` quote
> $x^2$ formula quote
> **Bold with *italic* and `code`** complex quote

### Formatting in Tables
| **Bold** | *Italic* | `Code` | $x^2$ |
|----------|----------|--------|-------|
| **B1**   | *I1*     | `C1`   | $a$   |
| **B2**   | *I2*     | `C2`   | $b$   |

## Expected Behavior

1. Each formatted text should appear **exactly once** (no duplication)
2. Nested formatting should render correctly
3. Syntax markers should be hidden when cursor is away
4. Syntax markers should reveal when cursor is on the element
5. Invalid/malformed markdown should degrade gracefully
