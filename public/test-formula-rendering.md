# Formula Rendering Test File

This file tests for formula rendering issues in the Live Preview editor.

## Test 1: Basic Inline Math

Simple inline formula: $E=mc^2$

Another formula: $a^2 + b^2 = c^2$

## Test 2: Inline Math in Different Contexts

### In Headings
# Heading with $E=mc^2$ formula
## Heading with $\alpha + \beta$ formula
### Heading with $\sum_{i=1}^{n} i$ formula

### In Lists
- List item with $E=mc^2$ formula
- List item with $\int_0^1 x dx$ formula
- List item with $\frac{a}{b}$ formula

### In Blockquotes
> Quote with $E=mc^2$ formula
> Quote with $\sqrt{2}$ formula

### In Bold/Italic
This is **bold with $E=mc^2$ formula** inside.

This is *italic with $\alpha$ formula* inside.

## Test 3: Block Math

Block formula:

$
E = mc^2
$

Another block formula:

$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$

## Test 4: Complex Formulas

Inline: $\sum_{i=1}^{n} \frac{1}{i^2} = \frac{\pi^2}{6}$

Block:

$
\begin{aligned}
\nabla \times \vec{\mathbf{B}} -\, \frac1c\, \frac{\partial\vec{\mathbf{E}}}{\partial t} &= \frac{4\pi}{c}\vec{\mathbf{j}} \\
\nabla \cdot \vec{\mathbf{E}} &= 4 \pi \rho \\
\nabla \times \vec{\mathbf{E}}\, +\, \frac1c\, \frac{\partial\vec{\mathbf{B}}}{\partial t} &= \vec{\mathbf{0}} \\
\nabla \cdot \vec{\mathbf{B}} &= 0
\end{aligned}
$

## Test 5: Edge Cases

Empty formula: $$

Formula with spaces: $ x + y $

Formula at line start: $E=mc^2$ is Einstein's equation.

Formula at line end: Einstein's equation is $E=mc^2$

Multiple formulas: $a$ and $b$ and $c$

## Test 6: Greek Letters

Alpha: $\alpha$, Beta: $\beta$, Gamma: $\gamma$, Delta: $\delta$

Uppercase: $\Alpha$, $\Beta$, $\Gamma$, $\Delta$

## Test 7: Fractions and Roots

Fraction: $\frac{a}{b}$

Square root: $\sqrt{x}$

Nth root: $\sqrt[n]{x}$

## Test 8: Subscripts and Superscripts

Subscript: $x_1$, $x_{12}$

Superscript: $x^2$, $x^{23}$

Both: $x_1^2$, $x_{12}^{34}$

## Test 9: Summation and Integration

Sum: $\sum_{i=1}^{n} i$

Product: $\prod_{i=1}^{n} i$

Integral: $\int_0^1 x dx$

Double integral: $\iint_D f(x,y) dA$

## Test 10: Matrices

Inline matrix: $\begin{pmatrix} a & b \\ c & d \end{pmatrix}$

Block matrix:

$
\begin{bmatrix}
1 & 2 & 3 \\
4 & 5 & 6 \\
7 & 8 & 9
\end{bmatrix}
$

## Expected Behavior

- All formulas should render correctly using KaTeX
- No "undefined" text should appear
- Formulas in headings, lists, quotes should work
- Formulas inside bold/italic should work
- Block formulas should be centered and properly formatted
- Invalid formulas should show error message or fallback to raw LaTeX

## Common Issues to Check

1. **"undefined" rendering**: Formula shows as "undefined" instead of math
2. **Missing KaTeX**: Formula shows as raw LaTeX (e.g., "$E=mc^2$")
3. **Context issues**: Formula fails in specific contexts (headings, lists, etc.)
4. **Syntax errors**: Invalid LaTeX causes crashes or blank output

## How to Test

1. Open this file in Live Preview mode
2. Scroll through and check each formula
3. Verify formulas render correctly (not as "undefined" or raw LaTeX)
4. Check formulas in different contexts (headings, lists, quotes, bold/italic)
5. Open browser console (F12) and check for KaTeX errors
