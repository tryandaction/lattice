# Performance Test Document - 500 Lines

This document tests the performance of the unified decoration coordinator with 500 lines of mixed Markdown content.

## Section 1: Headings and Text (50 lines)

# Heading 1 - Performance Test
## Heading 2 - Decorator System
### Heading 3 - Widget Rendering
#### Heading 4 - Inline Elements
##### Heading 5 - Block Elements
###### Heading 6 - Math Formulas

This is a paragraph with **bold text**, *italic text*, and `inline code`. We also have ~~strikethrough~~ and ==highlighted== text.

The formula $E = mc^2$ is inline, while this is a link: [GitHub](https://github.com).

> This is a blockquote with **bold** and *italic* text.
> It spans multiple lines for testing.

- List item 1 with **bold**
- List item 2 with *italic*
- List item 3 with `code`

1. Numbered item 1
2. Numbered item 2
3. Numbered item 3

- [ ] Task 1 unchecked
- [x] Task 2 checked
- [ ] Task 3 unchecked

---

## Section 2: Mathematical Formulas (100 lines)

Inline formulas: $\alpha$, $\beta$, $\gamma$, $\delta$, $\epsilon$, $\zeta$, $\eta$, $\theta$

More formulas: $\sum_{i=1}^{n} x_i$, $\int_0^\infty e^{-x} dx$, $\frac{d}{dx} f(x)$

Complex formula: $\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$

Physics: $F = ma$, $E = mc^2$, $p = mv$, $W = Fd$

Calculus: $\lim_{x \to 0} \frac{\sin x}{x} = 1$

Statistics: $\bar{x} = \frac{1}{n}\sum_{i=1}^{n} x_i$

Linear algebra: $\det(A) = ad - bc$ for $2 \times 2$ matrix

Quantum: $\hat{H}\psi = E\psi$

Maxwell: $\nabla \cdot \mathbf{E} = \frac{\rho}{\epsilon_0}$

Thermodynamics: $dU = \delta Q - \delta W$

Line 51: Formula $a^2 + b^2 = c^2$ with text
Line 52: Formula $\sin^2(x) + \cos^2(x) = 1$ with text
Line 53: Formula $e^{i\pi} + 1 = 0$ with text
Line 54: Formula $\nabla \times \mathbf{B} = \mu_0 \mathbf{J}$ with text
Line 55: Formula $\frac{\partial u}{\partial t} = \alpha \nabla^2 u$ with text
Line 56: Formula $\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}$ with text
Line 57: Formula $\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}$ with text
Line 58: Formula $\prod_{n=1}^{\infty} \left(1 - \frac{1}{n^2}\right) = \frac{1}{2}$ with text
Line 59: Formula $\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e$ with text
Line 60: Formula $\frac{d}{dx} \ln(x) = \frac{1}{x}$ with text

Line 61-70: More formulas
$\nabla f = \left(\frac{\partial f}{\partial x}, \frac{\partial f}{\partial y}, \frac{\partial f}{\partial z}\right)$
$\mathbf{F} = m\mathbf{a}$
$\tau = \mathbf{r} \times \mathbf{F}$
$L = T - V$
$S = k_B \ln \Omega$
$G = H - TS$
$\Delta G = \Delta H - T\Delta S$
$K = \frac{1}{2}mv^2$
$U = mgh$
$P = \frac{dW}{dt}$

Line 71-80: Greek letters in formulas
$\alpha + \beta = \gamma$
$\delta \epsilon = \zeta$
$\eta \theta = \iota$
$\kappa \lambda = \mu$
$\nu \xi = \pi$
$\rho \sigma = \tau$
$\upsilon \phi = \chi$
$\psi + \omega = \Omega$
$\Gamma \Delta = \Theta$
$\Lambda \Xi = \Pi$

Line 81-90: Complex expressions
$\int_0^{2\pi} \sin(x) dx = 0$
$\sum_{k=0}^{n} \binom{n}{k} = 2^n$
$\prod_{p \text{ prime}} \frac{1}{1-p^{-s}} = \zeta(s)$
$\lim_{x \to 0} \frac{e^x - 1}{x} = 1$
$\frac{d}{dx} \int_a^x f(t) dt = f(x)$
$\nabla \cdot (\nabla \times \mathbf{A}) = 0$
$\nabla \times (\nabla f) = \mathbf{0}$
$\oint_C \mathbf{F} \cdot d\mathbf{r} = \iint_S (\nabla \times \mathbf{F}) \cdot d\mathbf{S}$
$\iint_S \mathbf{F} \cdot d\mathbf{S} = \iiint_V (\nabla \cdot \mathbf{F}) dV$
$\frac{\partial^2 u}{\partial t^2} = c^2 \nabla^2 u$

Line 91-100: Matrices and vectors
$\begin{pmatrix} a & b \\ c & d \end{pmatrix}$
$\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}$
$\begin{pmatrix} x \\ y \end{pmatrix}$
$\begin{pmatrix} 1 \\ 2 \\ 3 \end{pmatrix}$
$\det \begin{vmatrix} a & b \\ c & d \end{vmatrix} = ad - bc$
$\mathbf{A}\mathbf{x} = \mathbf{b}$
$\mathbf{A}^{-1}\mathbf{A} = \mathbf{I}$
$\mathbf{A}^T\mathbf{A}$ is symmetric
$\text{tr}(\mathbf{A}) = \sum_{i} a_{ii}$
$\|\mathbf{v}\| = \sqrt{\mathbf{v} \cdot \mathbf{v}}$

Line 101-150: Mixed content with formulas
The Pythagorean theorem states that $a^2 + b^2 = c^2$ for right triangles.
Euler's identity $e^{i\pi} + 1 = 0$ is considered beautiful.
The quadratic formula $x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$ solves $ax^2+bx+c=0$.
Newton's second law $F = ma$ relates force, mass, and acceleration.
Einstein's $E = mc^2$ shows mass-energy equivalence.
The derivative $\frac{df}{dx}$ measures rate of change.
The integral $\int f(x) dx$ measures area under curve.
The limit $\lim_{x \to a} f(x)$ describes behavior near $a$.
The sum $\sum_{i=1}^n a_i$ adds sequence elements.
The product $\prod_{i=1}^n a_i$ multiplies sequence elements.

Continuing with more formulas and text...
$\sin(x)$, $\cos(x)$, $\tan(x)$, $\cot(x)$, $\sec(x)$, $\csc(x)$
$\sinh(x)$, $\cosh(x)$, $\tanh(x)$
$\arcsin(x)$, $\arccos(x)$, $\arctan(x)$
$\log(x)$, $\ln(x)$, $\exp(x)$
$\sqrt{x}$, $\sqrt[3]{x}$, $\sqrt[n]{x}$
$x^2$, $x^3$, $x^n$
$x_1$, $x_2$, $x_i$
$\frac{1}{2}$, $\frac{a}{b}$, $\frac{x+y}{z}$

More complex expressions:
$\int_0^1 x^2 dx = \frac{1}{3}$
$\sum_{n=0}^\infty \frac{x^n}{n!} = e^x$
$\prod_{n=1}^\infty \left(1 + \frac{x}{n}\right) e^{-x/n}$
$\lim_{n \to \infty} \sum_{k=1}^n \frac{1}{n} f\left(\frac{k}{n}\right) = \int_0^1 f(x) dx$

Statistical formulas:
$\mu = E[X] = \int_{-\infty}^\infty x f(x) dx$
$\sigma^2 = \text{Var}(X) = E[(X-\mu)^2]$
$\text{Cov}(X,Y) = E[(X-\mu_X)(Y-\mu_Y)]$
$\rho = \frac{\text{Cov}(X,Y)}{\sigma_X \sigma_Y}$

Probability distributions:
$f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}$ (Normal)
$P(X=k) = \binom{n}{k} p^k (1-p)^{n-k}$ (Binomial)
$P(X=k) = \frac{\lambda^k e^{-\lambda}}{k!}$ (Poisson)
$f(x) = \lambda e^{-\lambda x}$ (Exponential)

## Section 3: Lists and Formatting (100 lines)

### Unordered Lists
- Item 1
- Item 2
- Item 3
- Item 4
- Item 5

* Alternative 1
* Alternative 2
* Alternative 3
* Alternative 4
* Alternative 5

+ Plus 1
+ Plus 2
+ Plus 3
+ Plus 4
+ Plus 5

### Ordered Lists
1. First
2. Second
3. Third
4. Fourth
5. Fifth

### Task Lists
- [ ] Task A
- [x] Task B
- [ ] Task C
- [x] Task D
- [ ] Task E

### Nested Lists
- Parent 1
  - Child 1.1
  - Child 1.2
    - Grandchild 1.2.1
    - Grandchild 1.2.2
  - Child 1.3
- Parent 2
  - Child 2.1
  - Child 2.2

1. Numbered Parent 1
   1. Numbered Child 1.1
   2. Numbered Child 1.2
2. Numbered Parent 2
   1. Numbered Child 2.1
   2. Numbered Child 2.2

### Mixed Formatting
- **Bold item**
- *Italic item*
- `Code item`
- ~~Strikethrough item~~
- ==Highlighted item==
- Item with $\alpha$ formula
- Item with [link](https://example.com)

### Blockquotes
> Quote 1
> Quote 2
> Quote 3

> Quote with **bold**
> Quote with *italic*
> Quote with `code`

> Multi-line quote
> that spans several
> lines for testing
> performance

### Horizontal Rules
---
***
___

## Section 4: Links and Images (50 lines)

[Link 1](https://example.com)
[Link 2](https://github.com)
[Link 3](https://google.com)
[Link 4](https://stackoverflow.com)
[Link 5](https://wikipedia.org)

[[Wiki Link 1]]
[[Wiki Link 2]]
[[Wiki Link 3]]
[[Wiki Link 4]]
[[Wiki Link 5]]

![Image 1](https://via.placeholder.com/150)
![Image 2](https://via.placeholder.com/200)
![Image 3](https://via.placeholder.com/250)

## Section 5: Code and Inline Elements (100 lines)

Inline code: `const x = 42;`
More code: `function foo() { return bar; }`
Even more: `let result = array.map(x => x * 2);`

Keyboard shortcuts: <kbd>Ctrl</kbd>+<kbd>C</kbd>
More shortcuts: <kbd>Cmd</kbd>+<kbd>V</kbd>
Another: <kbd>Alt</kbd>+<kbd>Tab</kbd>

Superscript: x^2^ + y^2^ = z^2^
Subscript: H~2~O and CO~2~

Combined formatting:
**Bold with *italic* inside**
*Italic with **bold** inside*
`Code with **bold** attempt`
~~Strikethrough with **bold**~~

Line 301-350: Repetitive content for performance testing
Text with **bold** and *italic* and `code`
Text with **bold** and *italic* and `code`
Text with **bold** and *italic* and `code`
Text with **bold** and *italic* and `code`
Text with **bold** and *italic* and `code`
Text with **bold** and *italic* and `code`
Text with **bold** and *italic* and `code`
Text with **bold** and *italic* and `code`
Text with **bold** and *italic* and `code`
Text with **bold** and *italic* and `code`

Formula line: $\alpha + \beta = \gamma$ with text
Formula line: $\alpha + \beta = \gamma$ with text
Formula line: $\alpha + \beta = \gamma$ with text
Formula line: $\alpha + \beta = \gamma$ with text
Formula line: $\alpha + \beta = \gamma$ with text
Formula line: $\alpha + \beta = \gamma$ with text
Formula line: $\alpha + \beta = \gamma$ with text
Formula line: $\alpha + \beta = \gamma$ with text
Formula line: $\alpha + \beta = \gamma$ with text
Formula line: $\alpha + \beta = \gamma$ with text

List item with **bold** and $x^2$
List item with **bold** and $x^2$
List item with **bold** and $x^2$
List item with **bold** and $x^2$
List item with **bold** and $x^2$
List item with **bold** and $x^2$
List item with **bold** and $x^2$
List item with **bold** and $x^2$
List item with **bold** and $x^2$
List item with **bold** and $x^2$

> Blockquote with **bold** and $\alpha$
> Blockquote with **bold** and $\alpha$
> Blockquote with **bold** and $\alpha$
> Blockquote with **bold** and $\alpha$
> Blockquote with **bold** and $\alpha$

## Section 6: Final Performance Test (100 lines)

Line 401: Mixed content **bold** *italic* `code` $x^2$ [link](url)
Line 402: Mixed content **bold** *italic* `code` $x^2$ [link](url)
Line 403: Mixed content **bold** *italic* `code` $x^2$ [link](url)
Line 404: Mixed content **bold** *italic* `code` $x^2$ [link](url)
Line 405: Mixed content **bold** *italic* `code` $x^2$ [link](url)
Line 406: Mixed content **bold** *italic* `code` $x^2$ [link](url)
Line 407: Mixed content **bold** *italic* `code` $x^2$ [link](url)
Line 408: Mixed content **bold** *italic* `code` $x^2$ [link](url)
Line 409: Mixed content **bold** *italic* `code` $x^2$ [link](url)
Line 410: Mixed content **bold** *italic* `code` $x^2$ [link](url)

# Heading with $E = mc^2$ formula
## Heading with **bold** text
### Heading with *italic* text
#### Heading with `code` text
##### Heading with [link](url)
###### Heading with ~~strikethrough~~

- List with $\sum_{i=1}^n x_i$ formula
- List with $\int_0^\infty e^{-x} dx$ formula
- List with $\frac{d}{dx} f(x)$ formula
- List with $\lim_{x \to 0} \frac{\sin x}{x}$ formula
- List with $\nabla \times \mathbf{E}$ formula

> Quote with $\alpha + \beta = \gamma$
> Quote with $\sin^2(x) + \cos^2(x) = 1$
> Quote with $e^{i\pi} + 1 = 0$

1. Numbered with **bold** and $x^2$
2. Numbered with *italic* and $y^2$
3. Numbered with `code` and $z^2$
4. Numbered with ~~strike~~ and $a^2$
5. Numbered with ==highlight== and $b^2$

- [ ] Task with **bold** and $\alpha$
- [x] Task with *italic* and $\beta$
- [ ] Task with `code` and $\gamma$
- [x] Task with [link](url) and $\delta$
- [ ] Task with formula $\epsilon$

Final lines 450-500:
Text line with various **bold** *italic* `code` $x^2$ elements
Text line with various **bold** *italic* `code` $x^2$ elements
Text line with various **bold** *italic* `code` $x^2$ elements
Text line with various **bold** *italic* `code` $x^2$ elements
Text line with various **bold** *italic* `code` $x^2$ elements
Text line with various **bold** *italic* `code` $x^2$ elements
Text line with various **bold** *italic* `code` $x^2$ elements
Text line with various **bold** *italic* `code` $x^2$ elements
Text line with various **bold** *italic* `code` $x^2$ elements
Text line with various **bold** *italic* `code` $x^2$ elements

More formulas: $\nabla f$, $\nabla \cdot \mathbf{F}$, $\nabla \times \mathbf{A}$
More formulas: $\nabla f$, $\nabla \cdot \mathbf{F}$, $\nabla \times \mathbf{A}$
More formulas: $\nabla f$, $\nabla \cdot \mathbf{F}$, $\nabla \times \mathbf{A}$
More formulas: $\nabla f$, $\nabla \cdot \mathbf{F}$, $\nabla \times \mathbf{A}$
More formulas: $\nabla f$, $\nabla \cdot \mathbf{F}$, $\nabla \times \mathbf{A}$

Final section with all element types:
**Bold** *italic* `code` ~~strike~~ ==highlight==
$\alpha$ $\beta$ $\gamma$ $\delta$ $\epsilon$
[Link 1](url1) [Link 2](url2) [[Wiki]]
![Image](url) ![[Embed]]
<kbd>Ctrl</kbd> x^2^ H~2~O

- List item
- [ ] Task item
> Blockquote

---

# End of 500-line performance test document

**Performance Metrics to Measure:**
- Initial load time
- Scroll FPS
- Input latency
- Memory usage
- Decoration rebuild time
- Cache hit rate

**Expected Results:**
- Load time: < 200ms
- Scroll FPS: 60fps
- Input latency: < 16ms
- Memory: < 50MB
- Rebuild: < 50ms
- Cache hits: > 80%
