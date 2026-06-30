# Quantum Keyboard Official Design

## 1. Product Positioning

The Quantum Keyboard is Lattice's fastest formula input method and formula mapping manager. It is not a decorative virtual keyboard, not a help panel, and not a generic symbol palette.

It maps the 26 physical English letter keys to formula structures and symbols that users can learn by looking at the keycaps. Number keys keep their normal keyboard meaning. Shift and Ctrl are layer selectors.

Core promise:

- users do not memorize long shortcuts;
- users see 26 physical letter keys in QWERTY shape;
- each key clearly shows several meanings from left to right;
- pressing a key inserts the first meaning;
- pressing Shift+number+letter inserts a meaning from the first layer;
- pressing Ctrl shows the second layer;
- pressing Ctrl+number+letter inserts a meaning from the second layer;
- formula structures insert in a hand-writing-like way, with paired brackets, matrices, fractions, integrals, and placeholders ready for immediate editing;
- users can edit the mapping in Settings.

## 2. Visual Rules

The HUD must be quiet and input-first.

- Do not show a large "Quantum" label.
- Do not show long instructional paragraphs.
- The top bar has one short hint only: `Shift/Ctrl + number + letter`.
- The main body is only the 26 letter keys in QWERTY layout.
- Each physical letter appears only in the key's top-right corner.
- Each key is wider than a normal square key so formula meanings can be read horizontally.
- The meanings inside a key are arranged left to right.
- Do not prefix meanings with `1`, `2`, `3`; order implies the number.
- The current layer is visible through subtle border/accent changes.
- Colorful border/glow may remain, but the internal UI stays restrained.

## 3. Positioning Rules

The HUD must be stable.

- It does not continuously chase the caret, cursor, selection, or mouse.
- Default position is horizontally centered near the top or bottom of the screen.
- On open, choose top or bottom based on the last click/focus point:
  - if the click/focus point is in the upper half, open near the bottom;
  - if the click/focus point is in the lower half, open near the top.
- Clamp the HUD inside the viewport.
- Do not cover the click/focus point when avoidable.
- Once the user drags the HUD, persist that position and reopen there.
- After a user drag, do not auto-reposition unless the stored position would overflow the current viewport.
- Provide a small reset-position control only when a custom position exists.

## 4. Input Rules

### 4.1 Opening

- Double-tap `Tab` opens the Quantum Keyboard.
- Double-tap `Tab` must not insert a tab or blank indentation into Markdown.
- The Markdown toolbar overflow menu should expose a dedicated Quantum Keyboard command.
- Opening the keyboard focuses the hidden capture input, but formula insertion targets the last active Markdown/MathLive input target.

### 4.2 First Layer

- Press `I`: insert first meaning of key I.
- Press `Shift+I`: show first-layer preview for key I but should not force a menu.
- Press `Shift+1+I`: insert the first first-layer meaning for I.
- Press `Shift+2+I`: insert the second first-layer meaning for I.
- Press `Shift+3+I`: insert the third first-layer meaning for I.
- If the number is larger than the available meanings, clamp to the last available meaning.

### 4.3 Second Layer

- Holding `Ctrl` switches the visible key meanings to the second layer.
- Press `Ctrl+I`: insert first second-layer meaning for I.
- Press `Ctrl+2+I`: insert second second-layer meaning for I.
- The second layer contains less common, domain-specific, or advanced symbols.

### 4.4 Navigation And Editing

- `Tab`: move to next MathLive placeholder.
- `Shift+Tab`: move to previous placeholder.
- `Enter`: create the next formula line when editing MathLive.
- `Esc`: close the keyboard.
- Backspace/Delete/Arrow keys forward to the active formula field when possible.

## 5. Data Model

Use an explicit layer model instead of overloading `default`, `shift`, and `variants`.

```ts
export type QuantumLayerId = "base" | "ctrl";

export interface QuantumKeyMeaning {
  id: string;
  label: string;
  latex: string;
  mathlive?: string;
  markdown?: string;
  category: string;
  keywords: string[];
  displayMode?: boolean;
  templateKind?: "symbol" | "structure" | "matrix" | "bracket" | "operator";
}

export interface QuantumKeyDefinition {
  keyCode: string;
  letter: string;
  base: QuantumKeyMeaning[];
  ctrl: QuantumKeyMeaning[];
}

export type QuantumKeyboardMap = Record<string, QuantumKeyDefinition>;
```

Backward compatibility:

- Existing `quantumKeymap` may be migrated through a helper during the first implementation phase.
- Long term, UI and input logic should consume `QuantumKeyboardMap`.

## 6. Official Key Map

The first layer contains common formula operations and symbols. The second layer contains advanced or domain-specific items across math, physics, chemistry, biology, and engineering.

Labels are compact display names. The actual payload is LaTeX/MathLive.

| Key | First layer meanings | Ctrl second layer meanings |
| --- | --- | --- |
| Q | theta, Theta, angle, forall | charge q, heat Q, qdot, qhat |
| W | omega, Omega, wedge, hat, tilde | work W, wave W, Wronskian, weak op |
| E | epsilon, varepsilon, exists, in, equiv | energy E, electric field, expectation, enzyme E |
| R | rho, real R, right arrow, implies, rangle | resistance R, radius r, reaction rate, Reynolds |
| T | tau, times, tensor, transpose, therefore | temperature T, period T, torque, time constant |
| Y | psi, Psi, ket, bra, braket | yield Y, spherical harmonic Y, admittance Y |
| U | union, big union, uplus, vee, up arrow | potential U, unitary U, internal energy, velocity u |
| I | integral, double integral, triple integral, contour integral, bounded integral | current I, identity, indicator, inertia I |
| O | composition, oplus, odot, otimes, contour integral | big-O, order parameter, oxygen O, orbital O |
| P | pi, product, capital Pi, partial, parallel | pressure P, probability P, momentum p, power P |
| A | alpha, forall, aleph, approx, angle | area A, vector potential A, activity a, absorbance A |
| S | sum, Sigma, sigma, sqrt, subset, sin | entropy S, action S, spin S, stoichiometry S |
| D | delta, Delta, partial, nabla, subscript | derivative d/dx, differential d, diffusion D, determinant |
| F | fraction, display fraction, derivative fraction, partial derivative, phi | force F, Faraday F, flux Phi, Fourier F |
| G | gamma, Gamma, gradient, geq, gg | Gibbs G, conductance G, gravitational G, Green G |
| H | hbar, hat, Hamiltonian, Hhat, dagger | enthalpy H, magnetic H, Hermitian, Hilbert H |
| J | j, vector J, Jacobian, blackboard J | current density J, Bessel J, flux J, impulse J |
| K | ket, bra, braket, kappa, field K | Boltzmann k, Kelvin K, stiffness K, rate k |
| L | lambda, limit, Lambda, log, ln, left arrow | Lagrangian L, length L, angular momentum L, Laplace L |
| Z | zeta, integers Z, partition Z, empty set | impedance Z, atomic number Z, z-transform, z-score |
| X | xi, Xi, times, otimes, 2x2 matrix | position x, state X, cross product, chromosome X |
| C | cap, big cap, complex C, cos, chi | capacitance C, concentration C, heat capacity, carbon C |
| V | vector, bold vector, bar, overline, column vector | voltage V, potential V, volume V, velocity v |
| B | parentheses, brackets, braces, cases, beta | magnetic B, beta function, basis B, boundary B |
| N | nu, natural N, nabla, negation, not equal | number N, normal N, Avogadro N_A, sample size n |
| M | pmatrix, bmatrix, matrix, mu, plus-minus | mass m, molarity M, moment M, metric M |

## 7. Settings Editor

Settings needs a Quantum Keyboard editor.

Recommended placement:

- Use the existing `settings.shortcuts` tab as the first integration point, because this feature is keyboard-first.
- Add a section titled `Quantum Keyboard`.
- Later it can become a dedicated tab if the editor grows.

Editor requirements:

- Show a 26-key overview.
- Selecting a key opens an editor panel for that key.
- The editor has two layer tabs: `Shift layer` and `Ctrl layer`.
- Each meaning is an editable row:
  - label;
  - LaTeX payload;
  - optional Markdown payload;
  - optional MathLive payload;
  - display math toggle;
  - category.
- Provide add, remove, reorder, reset key, and reset all.
- Provide a live preview rendered through KaTeX/MathLive-compatible renderer.
- Persist user mapping locally.
- Validate that every payload is non-empty and either LaTeX-like or plain text intentionally marked as a label only.

## 8. Implementation Phases

### Phase 1: Official Data And Tests

- Add explicit layer-based model.
- Convert current mapping into the official 26-key base/ctrl map.
- Keep backward-compatible helpers for existing tests.
- Add tests for 26 letters, no number row, no duplicate payloads per layer, and Ctrl layer lookup.

### Phase 2: Minimal HUD

- Remove prominent `Quantum` brand pill and long status wording.
- Show only the short hint and the 26-key board.
- Render physical letters in top-right corner.
- Render meanings left-to-right without numeric prefixes.
- Add layer preview state for Shift and Ctrl.

### Phase 3: Input Engine

- Implement `Shift+number+letter` and `Ctrl+number+letter`.
- Keep Tab placeholder navigation.
- Prevent double-Tab from inserting tabs into Markdown.
- Ensure matrix/bracket/fraction structures insert with paired placeholders.

### Phase 4: Stable Positioning

- Replace smart chasing with fixed top/bottom default placement.
- Persist user-dragged position.
- Clamp to viewport.
- Reset position control.

### Phase 5: Settings Editor

- Build the Quantum Keyboard settings section.
- Connect local persistence.
- Add validation, preview, reset, and import/export-friendly JSON shape.

### Phase 6: Verification

- Unit tests for keymap and input engine.
- Component tests for keycap layout.
- Settings store tests for persistence/reset.
- Browser or screenshot validation for light/dark and zh/en where possible.
- Desktop build sync after tests pass.

## 9. Acceptance Criteria

- HUD shows exactly 26 letter keys.
- No number row is shown.
- No large `Quantum` brand text is shown.
- Key letters are top-right only.
- Key meanings are readable left-to-right without numeric prefixes.
- Holding Ctrl visibly switches the meanings.
- `Shift+2+I` inserts double integral.
- `Shift+3+I` inserts triple integral.
- `Ctrl+I` inserts the first second-layer I meaning.
- Double-Tab opens the keyboard without inserting indentation.
- Default position is stable top/bottom centered.
- User drag position persists.
- Settings can edit key meanings and reset them.
