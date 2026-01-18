# Widget Test Document - All 14 Widgets

This document tests all 14 Widget classes in the unified decoration coordinator.

---

## 1. FormattedTextWidget Tests

### Bold Text
This is **bold text** in a sentence.
Multiple **bold** words **scattered** throughout.

### Italic Text
This is *italic text* using asterisks.
This is _italic text_ using underscores.

### Bold + Italic
This is ***bold and italic*** combined.

### Strikethrough
This is ~~strikethrough text~~ in a sentence.

### Highlight
This is ==highlighted text== for emphasis.

### Inline Code
Use `console.log()` to print output.
The variable `x = 42` is defined here.

---

## 2. LinkWidget Tests

### Markdown Links
Visit [Google](https://www.google.com) for search.
Check out [GitHub](https://github.com) for code.

### Wiki Links
See [[Other Page]] for more info.
Link with display: [[Target Page|Custom Display Text]]

---

## 3. AnnotationLinkWidget Tests

### PDF Annotation Links
See annotation: [[document.pdf#ann-abc123]]
Reference: [[research.pdf#ann-xyz789]]

---

## 4. ImageWidget Tests

### Basic Images
![Placeholder Image](https://via.placeholder.com/150)

### Images with Width
![Sized Image|300](https://via.placeholder.com/300)

### Image with Alt Text
![Beautiful Landscape](https://via.placeholder.com/400x200)

---

## 5. SuperscriptWidget Tests

### Superscript
E = mc^2^ is Einstein's equation.
x^2^ + y^2^ = z^2^ is Pythagorean theorem.

---

## 6. SubscriptWidget Tests

### Subscript
H~2~O is water.
CO~2~ is carbon dioxide.

---

## 7. KbdWidget Tests

### Keyboard Keys
Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy.
Use <kbd>Cmd</kbd>+<kbd>V</kbd> to paste on Mac.
Hit <kbd>Enter</kbd> to submit.

---

## 8. FootnoteRefWidget Tests

### Footnotes
This is a statement with a footnote[^1].
Another reference[^2] to check.

[^1]: This is the first footnote content.
[^2]: This is the second footnote content.

---

## 9. EmbedWidget Tests

### File Embeds
![[embedded-file.md]]
![[another-document]]

---

## 10. HeadingContentWidget Tests

# Heading 1 with $E=mc^2$ formula
## Heading 2 with **bold** text
### Heading 3 with *italic* text
#### Heading 4 with `code`
##### Heading 5 with [link](https://example.com)
###### Heading 6 with ~~strikethrough~~

---

## 11. BlockquoteContentWidget Tests

### Simple Blockquote
> This is a simple blockquote.

### Multi-line Blockquote
> This is the first line.
> This is the second line.
> This is the third line.

### Blockquote with Formatting
> This quote has **bold** and *italic* text.
> It also has `code` and [links](https://example.com).

---

## 12. ListBulletWidget Tests

### Unordered Lists
- First item
- Second item
- Third item

* Alternative bullet
* Another item
* Last item

+ Plus bullet
+ Another plus
+ Final plus

### Ordered Lists
1. First numbered item
2. Second numbered item
3. Third numbered item

### Task Lists
- [ ] Unchecked task
- [x] Checked task
- [ ] Another unchecked task
- [x] Another checked task

### Nested Lists
- Parent item
  - Child item 1
  - Child item 2
    - Grandchild item
- Another parent

1. Numbered parent
   1. Numbered child
   2. Another child
2. Second parent

---

## 13. HorizontalRuleWidget Tests

### Horizontal Rules

Above the rule.

---

Below the first rule.

***

Below the second rule.

___

Below the third rule.

---

## 14. MathWidget Tests

### Inline Math
The formula $E = mc^2$ is famous.
Pythagorean theorem: $a^2 + b^2 = c^2$.
Quadratic formula: $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$.

### Inline Math in Context
In physics, $F = ma$ relates force to mass and acceleration.
The area of a circle is $A = \pi r^2$ where $r$ is the radius.

### Block Math
$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

$$
\nabla \times \mathbf{E} = -\frac{\partial \mathbf{B}}{\partial t}
$$

### Complex Math
$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
\begin{pmatrix}
x \\
y
\end{pmatrix}
=
\begin{pmatrix}
ax + by \\
cx + dy
\end{pmatrix}
$$

---

## Combined Tests

### Multiple Widgets in One Line
This line has **bold**, *italic*, `code`, [link](https://example.com), and $x^2$ formula.

### Nested Formatting
**Bold with *italic* inside** and `code with **bold** inside`.

### Math in Headings
# Euler's Identity: $e^{i\pi} + 1 = 0$
## Schrödinger Equation: $i\hbar\frac{\partial}{\partial t}\Psi = \hat{H}\Psi$

### Math in Lists
- First formula: $\sin^2(x) + \cos^2(x) = 1$
- Second formula: $e^{ix} = \cos(x) + i\sin(x)$
- Third formula: $\frac{d}{dx}e^x = e^x$

### Math in Blockquotes
> Einstein said: $E = mc^2$
> Newton said: $F = ma$
> Pythagoras said: $a^2 + b^2 = c^2$

---

## Performance Test Section

### 100 Lines of Mixed Content

1. Line with **bold** text
2. Line with *italic* text
3. Line with `code` text
4. Line with [link](https://example.com)
5. Line with $x^2$ formula
6. Line with **bold** and *italic*
7. Line with `code` and [link](https://example.com)
8. Line with $\alpha$ and $\beta$
9. Line with ~~strikethrough~~ text
10. Line with ==highlight== text
11. Line with **bold** text
12. Line with *italic* text
13. Line with `code` text
14. Line with [link](https://example.com)
15. Line with $x^2$ formula
16. Line with **bold** and *italic*
17. Line with `code` and [link](https://example.com)
18. Line with $\alpha$ and $\beta$
19. Line with ~~strikethrough~~ text
20. Line with ==highlight== text
21. Line with **bold** text
22. Line with *italic* text
23. Line with `code` text
24. Line with [link](https://example.com)
25. Line with $x^2$ formula
26. Line with **bold** and *italic*
27. Line with `code` and [link](https://example.com)
28. Line with $\alpha$ and $\beta$
29. Line with ~~strikethrough~~ text
30. Line with ==highlight== text
31. Line with **bold** text
32. Line with *italic* text
33. Line with `code` text
34. Line with [link](https://example.com)
35. Line with $x^2$ formula
36. Line with **bold** and *italic*
37. Line with `code` and [link](https://example.com)
38. Line with $\alpha$ and $\beta$
39. Line with ~~strikethrough~~ text
40. Line with ==highlight== text
41. Line with **bold** text
42. Line with *italic* text
43. Line with `code` text
44. Line with [link](https://example.com)
45. Line with $x^2$ formula
46. Line with **bold** and *italic*
47. Line with `code` and [link](https://example.com)
48. Line with $\alpha$ and $\beta$
49. Line with ~~strikethrough~~ text
50. Line with ==highlight== text
51. Line with **bold** text
52. Line with *italic* text
53. Line with `code` text
54. Line with [link](https://example.com)
55. Line with $x^2$ formula
56. Line with **bold** and *italic*
57. Line with `code` and [link](https://example.com)
58. Line with $\alpha$ and $\beta$
59. Line with ~~strikethrough~~ text
60. Line with ==highlight== text
61. Line with **bold** text
62. Line with *italic* text
63. Line with `code` text
64. Line with [link](https://example.com)
65. Line with $x^2$ formula
66. Line with **bold** and *italic*
67. Line with `code` and [link](https://example.com)
68. Line with $\alpha$ and $\beta$
69. Line with ~~strikethrough~~ text
70. Line with ==highlight== text
71. Line with **bold** text
72. Line with *italic* text
73. Line with `code` text
74. Line with [link](https://example.com)
75. Line with $x^2$ formula
76. Line with **bold** and *italic*
77. Line with `code` and [link](https://example.com)
78. Line with $\alpha$ and $\beta$
79. Line with ~~strikethrough~~ text
80. Line with ==highlight== text
81. Line with **bold** text
82. Line with *italic* text
83. Line with `code` text
84. Line with [link](https://example.com)
85. Line with $x^2$ formula
86. Line with **bold** and *italic*
87. Line with `code` and [link](https://example.com)
88. Line with $\alpha$ and $\beta$
89. Line with ~~strikethrough~~ text
90. Line with ==highlight== text
91. Line with **bold** text
92. Line with *italic* text
93. Line with `code` text
94. Line with [link](https://example.com)
95. Line with $x^2$ formula
96. Line with **bold** and *italic*
97. Line with `code` and [link](https://example.com)
98. Line with $\alpha$ and $\beta$
99. Line with ~~strikethrough~~ text
100. Line with ==highlight== text

---

## Test Checklist

### Widget Rendering:
- [ ] FormattedTextWidget (bold, italic, code, strikethrough, highlight)
- [ ] LinkWidget (markdown links, wiki links)
- [ ] AnnotationLinkWidget (PDF annotations)
- [ ] ImageWidget (basic, sized, with alt)
- [ ] SuperscriptWidget (^text^)
- [ ] SubscriptWidget (~text~)
- [ ] KbdWidget (<kbd>text</kbd>)
- [ ] FootnoteRefWidget ([^1])
- [ ] EmbedWidget (![[file]])
- [ ] HeadingContentWidget (# with math)
- [ ] BlockquoteContentWidget (> with formatting)
- [ ] ListBulletWidget (-, *, +, 1., [ ], [x])
- [ ] HorizontalRuleWidget (---, ***, ___)
- [ ] MathWidget ($...$ and $$...$$)

### Interactions:
- [ ] Click on formatted text positions cursor correctly
- [ ] Click on link positions cursor
- [ ] Ctrl+Click on link opens URL
- [ ] Click on math positions cursor
- [ ] Double-click on math selects formula
- [ ] Right-click on math copies LaTeX
- [ ] Click on task checkbox toggles state
- [ ] Click on heading positions cursor
- [ ] Click on blockquote positions cursor precisely

### Performance:
- [ ] 100-line document loads quickly
- [ ] Scrolling is smooth (60fps)
- [ ] Typing has no lag (<16ms)
- [ ] Cursor movement is instant

### Cursor Reveal:
- [ ] Moving cursor to line reveals raw markdown
- [ ] Moving cursor away hides syntax markers
- [ ] Smooth transition between states

---

## Expected Results

All 14 Widget types should render correctly with:
- ✅ Proper visual styling
- ✅ Precise cursor positioning
- ✅ Smooth interactions
- ✅ No decoration conflicts
- ✅ Obsidian-like reveal behavior
- ✅ 60fps performance

**Test Date**: 2026-01-18
**Decorator Version**: Week 2 Refactor Complete
**Total Widgets**: 14
**Total Lines**: ~300
