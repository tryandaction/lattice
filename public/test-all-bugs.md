# Bug Test File - All Critical Bugs

This file tests all 5 critical bugs that were fixed.

## Bug #1: Long File Test

This file has 100+ lines to test long file rendering.

## Bug #2: File Switching Test

Switch between this file and other files to test file switching.

## Bug #3: Text Duplication Test

### Bold Text
This is **bold text** that should not duplicate.

### Italic Text
This is *italic text* that should not duplicate.

### Bold + Italic
This is ***bold and italic*** text.

### Links
This is a [regular link](https://example.com) that should not duplicate.

This is a [[wiki link]] that should not duplicate.

### Inline Code
This is `inline code` that should not duplicate.

### Strikethrough
This is ~~strikethrough~~ text.

### Highlight
This is ==highlighted== text.

## Bug #4: Formula Rendering Test

### Inline Formulas
Einstein's equation: $E=mc^2$

Pythagorean theorem: $a^2 + b^2 = c^2$

Quadratic formula: $x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$

### Block Formulas
$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$

$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$

### Formulas in Different Contexts

#### In Headings
# Formula in H1: $E=mc^2$
## Formula in H2: $a^2+b^2=c^2$

#### In Lists
- Item with formula: $E=mc^2$
- Another item: $F=ma$
  - Nested with formula: $v=\frac{d}{t}$

#### In Blockquotes
> Einstein said $E=mc^2$
> Newton said $F=ma$

#### In Tables
| Name | Formula |
|------|---------|
| Energy | $E=mc^2$ |
| Force | $F=ma$ |
| Velocity | $v=\frac{d}{t}$ |

## Bug #5: Markdown Syntax Markers Test

### Headings
# H1 - The # should be hidden
## H2 - The ## should be hidden
### H3 - The ### should be hidden

### Bold and Italic
**Bold** - The ** should be hidden
*Italic* - The * should be hidden
***Bold Italic*** - The *** should be hidden

### Links
[Link text](url) - The []() should be hidden
[[Wiki link]] - The [[ ]] should be hidden

### Lists
- Bullet item - The - should be replaced with bullet
* Another bullet - The * should be replaced with bullet
+ Plus bullet - The + should be replaced with bullet
1. Numbered item - The 1. should be styled

### Blockquotes
> Quote line 1 - The > should be hidden
> Quote line 2 - The > should be hidden

---

## Additional Lines for Long File Test

Line 100
Line 101
Line 102
Line 103
Line 104
Line 105
Line 106
Line 107
Line 108
Line 109
Line 110
Line 111
Line 112
Line 113
Line 114
Line 115
Line 116
Line 117
Line 118
Line 119
Line 120

## End of Test File

**If you can see this line, the long file rendering is working!**
