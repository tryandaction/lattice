/**
 * Quantum Keymap Configuration
 *
 * The Quantum Keyboard is a physical QWERTY-letter mapper for formula input.
 * Select a letter, then its visible candidate number; Shift+letter selects
 * the extended layer. Ctrl+I/M plus sequential digits builds special templates.
 */

import { QUANTUM_FORMULA_PRESETS, type QuantumShortLabel } from "./quantum-formula-presets";

export type QuantumKeyCategory =
  | "structure"
  | "greek"
  | "calculus"
  | "linear-algebra"
  | "sets"
  | "logic"
  | "relations"
  | "physics"
  | "chemistry"
  | "biology"
  | "engineering";

export type QuantumLayerId = "base" | "ctrl";

export interface QuantumKeyMeaning {
  id: string;
  label: string;
  shortLabel?: QuantumShortLabel;
  latex: string;
  mathlive?: string;
  markdown?: string;
  category: QuantumKeyCategory;
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

export interface KeyMapping {
  /** Default LaTeX command when the physical letter key is pressed. */
  default: string;
  /** Candidate #2, also opened from Shift+click/right-click. */
  shift?: string;
  /** Candidates #3 and onward. */
  variants?: string[];
  /** Short text shown on the keycap for the default candidate. */
  label?: string;
  /** Labels aligned with [default, shift, ...variants]. */
  variantLabels?: string[];
  /** Human-readable name used in titles and accessible labels. */
  title?: string;
  /** Compact formula-like display text for the keycap. */
  preview?: string;
  /** Insert as display math by default. */
  displayMode?: boolean;
  category?: QuantumKeyCategory;
  keywords?: string[];
}

export type QuantumKeymap = Record<string, KeyMapping>;

export interface KeyboardRow {
  keys: string[];
  offset: number;
}

export const QWERTY_LAYOUT: KeyboardRow[] = [
  { keys: ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP"], offset: 0 },
  { keys: ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL"], offset: 0.5 },
  { keys: ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM"], offset: 1.5 },
];

export const KEY_LABELS: Record<string, string> = {
  KeyQ: "Q", KeyW: "W", KeyE: "E", KeyR: "R", KeyT: "T",
  KeyY: "Y", KeyU: "U", KeyI: "I", KeyO: "O", KeyP: "P",
  KeyA: "A", KeyS: "S", KeyD: "D", KeyF: "F", KeyG: "G",
  KeyH: "H", KeyJ: "J", KeyK: "K", KeyL: "L",
  KeyZ: "Z", KeyX: "X", KeyC: "C", KeyV: "V", KeyB: "B",
  KeyN: "N", KeyM: "M",
};

export const quantumKeymap: QuantumKeymap = {
  KeyQ: {
    default: "\\theta",
    shift: "\\Theta",
    variants: ["\\vartheta", "\\angle", "\\forall"],
    label: "theta",
    variantLabels: ["theta", "Theta", "vartheta", "angle", "forall"],
    title: "Theta / angle",
    preview: "theta",
    category: "greek",
    keywords: ["theta", "angle"],
  },
  KeyW: {
    default: "\\omega",
    shift: "\\Omega",
    variants: ["\\wedge", "\\widehat{}", "\\widetilde{}"],
    label: "omega",
    variantLabels: ["omega", "Omega", "wedge", "hat", "tilde"],
    title: "Omega / wide accent",
    preview: "omega",
    category: "greek",
    keywords: ["omega", "wedge", "hat", "tilde"],
  },
  KeyE: {
    default: "\\epsilon",
    shift: "\\varepsilon",
    variants: ["\\exists", "\\in", "\\equiv"],
    label: "epsilon",
    variantLabels: ["epsilon", "varepsilon", "exists", "in", "equiv"],
    title: "Epsilon / exists",
    preview: "epsilon",
    category: "greek",
    keywords: ["epsilon", "exists", "element"],
  },
  KeyR: {
    default: "\\rho",
    shift: "\\mathbb{R}",
    variants: ["\\rightarrow", "\\Rightarrow", "\\rangle", "\\sqrt[]{}"],
    label: "rho",
    variantLabels: ["rho", "R", "to", "Right", "rangle", "nth root"],
    title: "Rho / reals / arrow",
    preview: "rho",
    category: "relations",
    keywords: ["rho", "real", "arrow"],
  },
  KeyT: {
    default: "\\tau",
    shift: "\\times",
    variants: ["\\otimes", "\\top", "\\therefore"],
    label: "tau",
    variantLabels: ["tau", "times", "tensor", "top", "therefore"],
    title: "Tau / times",
    preview: "tau",
    category: "relations",
    keywords: ["tau", "times", "tensor"],
  },
  KeyY: {
    default: "\\psi",
    shift: "\\Psi",
    variants: ["\\ket{}", "\\bra{}", "\\braket{}{}"],
    label: "psi",
    variantLabels: ["psi", "Psi", "ket", "bra", "braket"],
    title: "Psi / quantum states",
    preview: "psi",
    category: "physics",
    keywords: ["psi", "wavefunction", "ket", "bra"],
  },
  KeyU: {
    default: "\\cup",
    shift: "\\bigcup",
    variants: ["\\uplus", "\\vee", "\\uparrow"],
    label: "union",
    variantLabels: ["cup", "bigcup", "uplus", "vee", "up"],
    title: "Union",
    preview: "cup",
    category: "sets",
    keywords: ["union", "cup"],
  },
  KeyI: {
    default: "\\int",
    shift: "\\iint",
    variants: ["\\iiint", "\\oint", "\\int_{}^{}", "\\oiint", "\\oiiint", "\\iint_{}^{}", "\\iiint_{}^{}"],
    label: "int",
    variantLabels: ["int", "iint", "iiint", "oint", "bounds", "oiint", "oiiint", "double bounds", "triple bounds"],
    title: "Integral",
    preview: "int",
    category: "calculus",
    keywords: ["integral", "double integral", "triple integral", "closed surface", "closed volume"],
  },
  KeyO: {
    default: "\\circ",
    shift: "\\oplus",
    variants: ["\\odot", "\\otimes", "\\oint"],
    label: "circle",
    variantLabels: ["circ", "oplus", "odot", "otimes", "oint"],
    title: "Circle operators",
    preview: "circ",
    category: "logic",
    keywords: ["circle", "operator"],
  },
  KeyP: {
    default: "\\pi",
    shift: "\\prod",
    variants: ["\\Pi", "\\partial", "\\parallel", "^{}"],
    label: "pi",
    variantLabels: ["pi", "prod", "Pi", "partial", "parallel", "power"],
    title: "Pi / product",
    preview: "pi",
    category: "greek",
    keywords: ["pi", "product", "partial"],
  },
  KeyA: {
    default: "\\alpha",
    shift: "\\forall",
    variants: ["\\aleph", "\\approx", "\\angle"],
    label: "alpha",
    variantLabels: ["alpha", "forall", "aleph", "approx", "angle"],
    title: "Alpha / all",
    preview: "alpha",
    category: "greek",
    keywords: ["alpha", "all", "angle"],
  },
  KeyS: {
    default: "\\sum",
    shift: "\\Sigma",
    variants: ["\\sigma", "\\sqrt{}", "\\subseteq", "\\sin", "\\sum_{}^{} {}"],
    label: "sum",
    variantLabels: ["sum", "Sigma", "sigma", "sqrt", "subset", "sin", "sum bounds"],
    title: "Sum / sigma",
    preview: "sum",
    displayMode: true,
    category: "calculus",
    keywords: ["sum", "sigma", "sqrt"],
  },
  KeyD: {
    default: "\\delta",
    shift: "\\Delta",
    variants: ["\\partial", "\\nabla", "_{}"],
    label: "delta",
    variantLabels: ["delta", "Delta", "partial", "nabla", "sub"],
    title: "Delta / derivative",
    preview: "delta",
    category: "greek",
    keywords: ["delta", "partial", "nabla", "subscript"],
  },
  KeyF: {
    default: "\\frac{}{}",
    shift: "\\dfrac{}{}",
    variants: ["\\frac{d}{d}", "\\frac{\\partial}{\\partial}", "\\phi", "\\frac{d{}}{d{}}", "\\frac{\\partial{}}{\\partial{}}"],
    label: "frac",
    variantLabels: ["frac", "dfrac", "d/d", "partial", "phi", "derivative", "partial derivative"],
    title: "Fraction",
    preview: "a/b",
    category: "structure",
    keywords: ["fraction", "divide", "phi"],
  },
  KeyG: {
    default: "\\gamma",
    shift: "\\Gamma",
    variants: ["\\nabla", "\\geq", "\\gg"],
    label: "gamma",
    variantLabels: ["gamma", "Gamma", "grad", "geq", "gg"],
    title: "Gamma / greater",
    preview: "gamma",
    category: "greek",
    keywords: ["gamma", "gradient", "greater"],
  },
  KeyH: {
    default: "\\hbar",
    shift: "\\hat{}",
    variants: ["\\mathcal{H}", "\\hat{H}", "\\dagger"],
    label: "hbar",
    variantLabels: ["hbar", "hat", "H", "Hhat", "dagger"],
    title: "H-bar / Hamiltonian",
    preview: "hbar",
    category: "physics",
    keywords: ["hbar", "hat", "hamiltonian"],
  },
  KeyJ: {
    default: "\\jmath",
    shift: "\\mathbf{J}",
    variants: ["\\operatorname{Jac}", "\\mathbb{J}", "\\operatorname{Im}"],
    label: "j",
    variantLabels: ["j", "J", "Jac", "blackboard J", "Im / 虚部"],
    title: "J / Jacobian",
    preview: "j",
    category: "linear-algebra",
    keywords: ["j", "jacobian"],
  },
  KeyK: {
    default: "\\ket{}",
    shift: "\\bra{}",
    variants: ["\\braket{}{}", "\\kappa", "\\mathbb{K}"],
    label: "ket",
    variantLabels: ["ket", "bra", "braket", "kappa", "K"],
    title: "Ket / bra",
    preview: "|>",
    category: "physics",
    keywords: ["ket", "bra", "kappa"],
  },
  KeyL: {
    default: "\\lambda",
    shift: "\\lim",
    variants: ["\\Lambda", "\\log", "\\ln", "\\leftarrow", "\\lim_{{}\\to{}} {}"],
    label: "lambda",
    variantLabels: ["lambda", "lim", "Lambda", "log", "ln", "left", "limit template"],
    title: "Lambda / limit",
    preview: "lambda",
    category: "greek",
    keywords: ["lambda", "limit", "log"],
  },
  KeyZ: {
    default: "\\zeta",
    shift: "\\mathbb{Z}",
    variants: ["\\mathcal{Z}", "\\varnothing", String.raw`\mathcal{Z}\{f[n]\}(z)`],
    label: "zeta",
    variantLabels: ["zeta", "Z", "calZ", "empty", "Z transform / Z 变换"],
    title: "Zeta / integers",
    preview: "zeta",
    category: "greek",
    keywords: ["zeta", "integers"],
  },
  KeyX: {
    default: "\\xi",
    shift: "\\Xi",
    variants: ["\\times", "\\otimes", "\\begin{pmatrix}{}&{}\\\\{}&{}\\end{pmatrix}"],
    label: "xi",
    variantLabels: ["xi", "Xi", "times", "otimes", "matrix"],
    title: "Xi / matrix",
    preview: "xi",
    category: "linear-algebra",
    keywords: ["xi", "times", "matrix"],
  },
  KeyC: {
    default: "\\cap",
    shift: "\\bigcap",
    variants: ["\\mathbb{C}", "\\cos", "\\chi"],
    label: "cap",
    variantLabels: ["cap", "bigcap", "C", "cos", "chi"],
    title: "Intersection / complex",
    preview: "cap",
    category: "sets",
    keywords: ["intersection", "complex", "cos"],
  },
  KeyV: {
    default: "\\vec{}",
    shift: "\\mathbf{}",
    variants: ["\\bar{}", "\\overline{}", "\\begin{pmatrix}{}\\\\{}\\end{pmatrix}", "\\dot{}", "\\ddot{}"],
    label: "vec",
    variantLabels: ["vec", "bold", "bar", "overline", "column", "dot", "ddot"],
    title: "Vector",
    preview: "vec",
    category: "linear-algebra",
    keywords: ["vector", "bold", "bar"],
  },
  KeyB: {
    default: "\\left({}\\right)",
    shift: "\\left[{}\\right]",
    variants: ["\\left\\{{}\\right\\}", "\\begin{cases}{}&{}\\\\{}&{}\\end{cases}", "\\beta"],
    label: "paren",
    variantLabels: ["paren", "bracket", "brace", "cases", "beta"],
    title: "Brackets / cases",
    preview: "( )",
    category: "structure",
    keywords: ["bracket", "parentheses", "cases", "beta"],
  },
  KeyN: {
    default: "\\nu",
    shift: "\\mathbb{N}",
    variants: ["\\nabla", "\\neg", "\\neq", "\\infty"],
    label: "nu",
    variantLabels: ["nu", "N", "nabla", "not", "neq", "infinity"],
    title: "Nu / naturals / negation",
    preview: "nu",
    category: "greek",
    keywords: ["nu", "natural", "not"],
  },
  KeyM: {
    default: "\\begin{pmatrix}{}&{}\\\\{}&{}\\end{pmatrix}",
    shift: "\\begin{bmatrix}{}&{}\\\\{}&{}\\end{bmatrix}",
    variants: ["\\begin{matrix}{}&{}\\\\{}&{}\\end{matrix}", "\\begin{pmatrix}{}&{}&{}\\\\{}&{}&{}\\\\{}&{}&{}\\end{pmatrix}", "\\begin{pmatrix}{}&{}&{}&{}\\\\{}&{}&{}&{}\\\\{}&{}&{}&{}\\\\{}&{}&{}&{}\\end{pmatrix}", "\\mu", "\\pm"],
    label: "matrix 2×2",
    variantLabels: ["pmatrix 2×2", "bmatrix 2×2", "matrix", "pmatrix 3×3", "pmatrix 4×4", "mu", "pm"],
    title: "Matrix / mu",
    preview: "2x2",
    displayMode: true,
    category: "linear-algebra",
    keywords: ["matrix", "2x2", "3x3", "4x4", "mu", "plus minus"],
  },
};

const BASE_LABEL_OVERRIDES: Record<string, string[]> = {
  KeyI: ["integral", "double integral", "triple integral", "contour integral", "bounded integral", "closed surface integral", "closed volume integral", "bounded double integral", "bounded triple integral"],
};

const CTRL_LAYER_MEANINGS: Record<string, Array<Omit<QuantumKeyMeaning, "id">>> = {
  KeyQ: [
    { label: "charge q", latex: "q", category: "physics", keywords: ["charge", "q"] },
    { label: "heat Q", latex: "Q", category: "physics", keywords: ["heat", "thermodynamics"] },
    { label: "qdot", latex: "\\dot{q}", category: "engineering", keywords: ["qdot", "rate"] },
    { label: "qhat", latex: "\\hat{q}", category: "physics", keywords: ["qhat", "operator"] },
  ],
  KeyW: [
    { label: "work W", latex: "W", category: "physics", keywords: ["work", "energy"] },
    { label: "wave W", latex: "\\mathcal{W}", category: "physics", keywords: ["wave"] },
    { label: "Wronskian", latex: "\\operatorname{Wr}", category: "calculus", keywords: ["wronskian"] },
    { label: "differential work", latex: String.raw`\mathrm{d}W=\mathbf{F}\cdot\mathrm{d}\mathbf{r}`, shortLabel: { zh: "功微分", en: "Work" }, category: "physics", keywords: ["work", "force", "displacement", "功", "微分"] },
  ],
  KeyE: [
    { label: "energy E", latex: "E", category: "physics", keywords: ["energy"] },
    { label: "electric field", latex: "\\mathbf{E}", category: "physics", keywords: ["electric", "field"] },
    { label: "expectation", latex: "\\mathbb{E}", category: "calculus", keywords: ["expectation", "probability"] },
    { label: "simple enzyme reaction", latex: String.raw`\mathrm{E}+\mathrm{S}\rightleftharpoons\mathrm{ES}\rightarrow\mathrm{E}+\mathrm{P}`, shortLabel: { zh: "酶催化", en: "Enzyme" }, category: "chemistry", keywords: ["enzyme", "substrate", "michaelis menten", "酶", "底物"] },
  ],
  KeyR: [
    { label: "resistance R", latex: "R", category: "engineering", keywords: ["resistance"] },
    { label: "radius r", latex: "r", category: "physics", keywords: ["radius"] },
    { label: "power-law reaction rate", latex: String.raw`r=k[\mathrm{A}]^m[\mathrm{B}]^n`, shortLabel: { zh: "反应速率", en: "Rate law" }, category: "chemistry", keywords: ["reaction", "rate", "power law", "幂律", "速率"] },
    { label: "Reynolds", latex: "\\mathrm{Re}", category: "engineering", keywords: ["reynolds"] },
  ],
  KeyT: [
    { label: "temperature T", latex: "T", category: "physics", keywords: ["temperature"] },
    { label: "period / frequency", latex: String.raw`T=\frac{1}{f}`, category: "physics", keywords: ["period", "frequency", "周期", "频率"] },
    { label: "torque", latex: "\\tau", category: "physics", keywords: ["torque"] },
    { label: "RC time constant", latex: String.raw`\tau=RC`, category: "engineering", keywords: ["time", "constant", "rc", "时间常数"] },
  ],
  KeyY: [
    { label: "yield Y", latex: "Y", category: "chemistry", keywords: ["yield"] },
    { label: "spherical harmonic Y", latex: "Y_{\\ell}^{m}", category: "physics", keywords: ["spherical", "harmonic"] },
    { label: "admittance / impedance", latex: String.raw`Y=\frac{1}{Z}`, category: "engineering", keywords: ["admittance", "impedance", "导纳", "阻抗"] },
  ],
  KeyU: [
    { label: "potential U", latex: "U", category: "physics", keywords: ["potential"] },
    { label: "unitary U", latex: "\\hat{U}", category: "physics", keywords: ["unitary"] },
    { label: "internal energy change", latex: "\\Delta U", category: "physics", keywords: ["internal", "energy", "change", "内能变化"] },
    { label: "velocity u", latex: "u", category: "engineering", keywords: ["velocity"] },
  ],
  KeyI: [
    { label: "current I", latex: "I", category: "physics", keywords: ["current"] },
    { label: "identity", latex: "\\mathbb{I}", category: "linear-algebra", keywords: ["identity"] },
    { label: "indicator", latex: "\\mathbf{1}", category: "logic", keywords: ["indicator"] },
    { label: "inertia I", latex: String.raw`I=\int r_{\perp}^{2}\,\mathrm{d}m`, shortLabel: { zh: "转动惯量", en: "Inertia" }, category: "physics", keywords: ["inertia", "axis", "moment", "转动惯量"] },
  ],
  KeyO: [
    { label: "big-O", latex: "\\mathcal{O}", category: "calculus", keywords: ["big o", "order"] },
    { label: "order parameter expectation", latex: String.raw`\langle\hat{O}\rangle`, category: "physics", keywords: ["order", "parameter", "expectation", "序参量"] },
    { label: "oxygen O", latex: "\\mathrm{O}", category: "chemistry", keywords: ["oxygen"] },
    { label: "atomic orbital", latex: String.raw`\psi_{n\ell m}`, category: "physics", keywords: ["orbital", "wavefunction", "原子轨道", "波函数"] },
  ],
  KeyP: [
    { label: "pressure P", latex: "P", category: "physics", keywords: ["pressure"] },
    { label: "probability P", latex: "\\mathbb{P}", category: "calculus", keywords: ["probability"] },
    { label: "momentum p", latex: "p", category: "physics", keywords: ["momentum"] },
    { label: "instantaneous power", latex: String.raw`P=\frac{\mathrm{d}W}{\mathrm{d}t}`, shortLabel: { zh: "瞬时功率", en: "Power" }, category: "physics", keywords: ["power", "work", "功率"] },
  ],
  KeyA: [
    { label: "area A", latex: "A", category: "engineering", keywords: ["area"] },
    { label: "vector potential A", latex: "\\mathbf{A}", category: "physics", keywords: ["vector", "potential"] },
    { label: "activity a", latex: "a", category: "chemistry", keywords: ["activity"] },
    { label: "absorbance / transmittance", latex: String.raw`A=-\log_{10}T`, shortLabel: { zh: "吸光度", en: "Absorb." }, category: "chemistry", keywords: ["absorbance", "transmittance", "吸光度", "透射比"] },
  ],
  KeyS: [
    { label: "entropy S", latex: "S", category: "physics", keywords: ["entropy"] },
    { label: "action integral", latex: String.raw`S=\int_{t_1}^{t_2}L\,\mathrm{d}t`, shortLabel: { zh: "作用量", en: "Action" }, category: "physics", keywords: ["action", "lagrangian", "作用量", "拉格朗日"] },
    { label: "spin S", latex: "\\mathbf{S}", category: "physics", keywords: ["spin"] },
    { label: "stoichiometric coefficient", latex: String.raw`\nu_i`, category: "chemistry", keywords: ["stoichiometry", "coefficient", "化学计量", "系数"] },
  ],
  KeyD: [
    { label: "derivative d/dx", latex: "\\frac{d}{dx}", category: "calculus", keywords: ["derivative"] },
    { label: "differential d", latex: "\\mathrm{d}", category: "calculus", keywords: ["differential"] },
    { label: "diffusion D", latex: "D", category: "physics", keywords: ["diffusion"] },
    { label: "determinant", latex: "\\det", category: "linear-algebra", keywords: ["determinant"] },
  ],
  KeyF: [
    { label: "force F", latex: "F", category: "physics", keywords: ["force"] },
    { label: "Faraday constant (C mol^-1)", latex: "F=N_Ae", category: "chemistry", keywords: ["faraday", "avogadro", "charge", "法拉第常数"] },
    { label: "flux Phi", latex: "\\Phi", category: "physics", keywords: ["flux"] },
    { label: "Fourier F", latex: "\\mathcal{F}", category: "engineering", keywords: ["fourier"] },
  ],
  KeyG: [
    { label: "Gibbs G", latex: "G", category: "chemistry", keywords: ["gibbs"] },
    { label: "electrical conductance", latex: String.raw`G=\frac{1}{R}`, category: "engineering", keywords: ["conductance", "resistance", "电导", "电阻"] },
    { label: "Newton gravity (point masses)", latex: String.raw`F=G\frac{m_1m_2}{r^2}`, shortLabel: { zh: "万有引力", en: "Gravity" }, category: "physics", keywords: ["gravity", "newton", "point mass", "万有引力", "质点"] },
    { label: "Green function", latex: String.raw`G(\mathbf{r},\mathbf{r}')`, shortLabel: { zh: "格林函数", en: "Green" }, category: "calculus", keywords: ["green", "function", "格林函数"] },
  ],
  KeyH: [
    { label: "enthalpy H", latex: "H", category: "chemistry", keywords: ["enthalpy"] },
    { label: "magnetic H", latex: "\\mathbf{H}", category: "physics", keywords: ["magnetic"] },
    { label: "Hermitian", latex: "\\dagger", category: "linear-algebra", keywords: ["hermitian"] },
    { label: "Hilbert H", latex: "\\mathcal{H}", category: "physics", keywords: ["hilbert"] },
  ],
  KeyJ: [
    { label: "current density J", latex: "\\mathbf{J}", category: "physics", keywords: ["current", "density"] },
    { label: "Bessel J", latex: "J_n", category: "calculus", keywords: ["bessel"] },
    { label: "flux J", latex: "J", category: "physics", keywords: ["flux"] },
    { label: "impulse integral", latex: String.raw`\mathbf{J}=\int_{t_1}^{t_2}\mathbf{F}\,\mathrm{d}t`, shortLabel: { zh: "冲量", en: "Impulse" }, category: "physics", keywords: ["impulse", "force", "冲量"] },
  ],
  KeyK: [
    { label: "Boltzmann k", latex: "k_B", category: "physics", keywords: ["boltzmann"] },
    { label: "Kelvin K", latex: "\\mathrm{K}", category: "physics", keywords: ["kelvin"] },
    { label: "stiffness K", latex: "K", category: "engineering", keywords: ["stiffness"] },
    { label: "rate k", latex: "k", category: "chemistry", keywords: ["rate"] },
  ],
  KeyL: [
    { label: "Lagrangian L", latex: "\\mathcal{L}", category: "physics", keywords: ["lagrangian"] },
    { label: "length L", latex: "L", category: "engineering", keywords: ["length"] },
    { label: "angular momentum L", latex: "\\mathbf{L}", category: "physics", keywords: ["angular", "momentum"] },
    { label: "Laplace transform operator", latex: String.raw`\mathcal{L}\{{}\}(s)`, shortLabel: { zh: "拉普模板", en: "Laplace" }, category: "calculus", keywords: ["laplace", "transform", "拉普拉斯"] },
  ],
  KeyZ: [
    { label: "impedance Z", latex: "Z", category: "engineering", keywords: ["impedance"] },
    { label: "atomic number / proton count", latex: String.raw`Z=N_{\mathrm{p}}`, category: "chemistry", keywords: ["atomic", "number", "proton", "原子序数", "质子数"] },
    { label: "z-transform", latex: "\\mathcal{Z}", category: "engineering", keywords: ["z transform"] },
    { label: "z-score", latex: "z", category: "calculus", keywords: ["z score"] },
  ],
  KeyX: [
    { label: "position x", latex: "x", category: "physics", keywords: ["position"] },
    { label: "state X", latex: "X", category: "calculus", keywords: ["state", "random"] },
    { label: "cross product", latex: "\\times", category: "linear-algebra", keywords: ["cross", "product"] },
    { label: "chromosome X", latex: "\\mathrm{X}", category: "biology", keywords: ["chromosome"] },
  ],
  KeyC: [
    { label: "capacitance C", latex: "C", category: "engineering", keywords: ["capacitance"] },
    { label: "species concentration", latex: String.raw`[\mathrm{A}]`, category: "chemistry", keywords: ["concentration", "species", "物种浓度"] },
    { label: "isobaric heat capacity", latex: String.raw`C_p=\left(\frac{\partial H}{\partial T}\right)_p`, shortLabel: { zh: "定压热容", en: "Cp" }, category: "physics", keywords: ["heat", "capacity", "constant pressure", "定压热容"] },
    { label: "carbon C", latex: "\\mathrm{C}", category: "chemistry", keywords: ["carbon"] },
  ],
  KeyV: [
    { label: "voltage V", latex: "V", category: "engineering", keywords: ["voltage"] },
    { label: "electric potential", latex: String.raw`V=\frac{U}{q}`, category: "physics", keywords: ["potential", "potential energy", "charge", "电势", "势能"] },
    { label: "volume integral", latex: String.raw`V=\iiint_{\Omega}1\,\mathrm{d}V`, shortLabel: { zh: "区域体积", en: "Volume" }, category: "physics", keywords: ["volume", "region", "体积", "区域"] },
    { label: "velocity v", latex: "\\mathbf{v}", category: "physics", keywords: ["velocity"] },
  ],
  KeyB: [
    { label: "magnetic B", latex: "\\mathbf{B}", category: "physics", keywords: ["magnetic"] },
    { label: "beta function", latex: "\\operatorname{B}", category: "calculus", keywords: ["beta", "function"] },
    { label: "basis B", latex: "\\mathcal{B}", category: "linear-algebra", keywords: ["basis"] },
    { label: "boundary B", latex: "\\partial", category: "calculus", keywords: ["boundary"] },
  ],
  KeyN: [
    { label: "number N", latex: "N", category: "calculus", keywords: ["number"] },
    { label: "normal N", latex: "\\mathcal{N}", category: "calculus", keywords: ["normal"] },
    { label: "Avogadro N_A", latex: "N_A", category: "chemistry", keywords: ["avogadro"] },
    { label: "sample size n", latex: "n", category: "biology", keywords: ["sample", "size"] },
  ],
  KeyM: [
    { label: "mass m", latex: "m", category: "physics", keywords: ["mass"] },
    { label: "molarity M", latex: "M", category: "chemistry", keywords: ["molarity"] },
    { label: "moment of force", latex: String.raw`\mathbf{M}=\mathbf{r}\times\mathbf{F}`, shortLabel: { zh: "力矩", en: "Torque" }, category: "physics", keywords: ["moment", "torque", "force", "力矩"] },
    { label: "metric M", latex: "g_{\\mu\\nu}", category: "physics", keywords: ["metric"] },
  ],
};

function toQuantumKeyMeaning(
  keyCode: string,
  layer: QuantumLayerId,
  index: number,
  value: string,
  mapping: KeyMapping,
): QuantumKeyMeaning {
  const overrideLabels = BASE_LABEL_OVERRIDES[keyCode];
  const label = overrideLabels?.[index] ?? mapping.variantLabels?.[index] ?? mapping.label ?? value;
  return {
    id: `${layer}-${keyCode}-${index + 1}`,
    label,
    latex: value,
    category: mapping.category ?? "structure",
    keywords: mapping.keywords ?? [],
    displayMode: mapping.displayMode,
    templateKind: mapping.category === "structure" ? "structure" : "symbol",
  };
}

function buildBaseLayer(keyCode: string, mapping: KeyMapping): QuantumKeyMeaning[] {
  return [mapping.default, mapping.shift, ...(mapping.variants ?? [])]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .map((value, index) => toQuantumKeyMeaning(keyCode, "base", index, value, mapping));
}

/** Full source list, including search-only meanings and their original override IDs. */
export const allQuantumKeyboardMap: QuantumKeyboardMap = Object.fromEntries(
  Object.entries(quantumKeymap).map(([keyCode, mapping]) => [
    keyCode,
    {
      keyCode,
      letter: KEY_LABELS[keyCode] ?? keyCode.replace(/^Key/, ""),
      base: buildBaseLayer(keyCode, mapping),
      ctrl: [
        ...(CTRL_LAYER_MEANINGS[keyCode] ?? []),
        ...QUANTUM_FORMULA_PRESETS.filter(preset => preset.keyCode === keyCode).map(preset => ({
          id: preset.id,
          label: preset.nameEn,
          shortLabel: preset.shortLabel,
          latex: preset.latex,
          category: preset.category,
          keywords: preset.keywords,
          templateKind: "structure" as const,
        })),
      ].map((meaning, index) => ({
        ...meaning,
        id: "id" in meaning && meaning.id ? meaning.id : `ctrl-${keyCode}-${index + 1}`,
      })),
    },
  ]),
) as QuantumKeyboardMap;

/** Visible order changes independently of stable source IDs. */
const VISIBLE_MEANING_IDS: Record<string, Partial<Record<QuantumLayerId, readonly string[]>>> = {
  KeyI: {
    base: ["base-KeyI-1", "base-KeyI-2", "base-KeyI-3", "base-KeyI-4", "base-KeyI-5", "base-KeyI-6"],
    ctrl: ["ctrl-KeyI-integral-1", "ctrl-KeyI-integral-2", "ctrl-KeyI-integral-3", "ctrl-KeyI-integral-4", "ctrl-KeyI-integral-5", "ctrl-KeyI-integral-6"],
  },
  KeyS: { base: ["base-KeyS-1", "base-KeyS-2", "base-KeyS-3", "base-KeyS-4", "base-KeyS-5", "base-KeyS-6"] },
  KeyF: { base: ["base-KeyF-1", "base-KeyF-2", "base-KeyF-5", "base-KeyF-6", "base-KeyF-7"] },
  KeyL: { base: ["base-KeyL-1", "base-KeyL-2", "base-KeyL-3", "base-KeyL-4", "base-KeyL-5", "base-KeyL-7"] },
  KeyV: { base: ["base-KeyV-1", "base-KeyV-2", "base-KeyV-3", "base-KeyV-5", "base-KeyV-6", "base-KeyV-7"] },
  KeyM: { base: ["base-KeyM-1", "base-KeyM-2", "base-KeyM-3", "base-KeyM-5", "base-KeyM-6", "base-KeyM-7"] },
  KeyE: { ctrl: ["ctrl-KeyE-1", "ctrl-KeyE-2", "ctrl-KeyE-3", "ctrl-KeyE-5", "ctrl-KeyE-6", "ctrl-KeyE-7"] },
  KeyR: { ctrl: ["ctrl-KeyR-1", "ctrl-KeyR-2", "ctrl-KeyR-3", "ctrl-KeyR-4", "ctrl-KeyR-5", "ctrl-KeyR-7"] },
  KeyC: { ctrl: ["ctrl-KeyC-1", "ctrl-KeyC-2", "ctrl-KeyC-3", "ctrl-KeyC-4", "ctrl-KeyC-5", "ctrl-KeyC-6"] },
};

export const quantumKeyboardMap: QuantumKeyboardMap = Object.fromEntries(
  Object.entries(allQuantumKeyboardMap).map(([keyCode, key]) => {
    const select = (layer: QuantumLayerId) => {
      const ids = VISIBLE_MEANING_IDS[keyCode]?.[layer];
      return ids ? ids.flatMap(id => key[layer].filter(meaning => meaning.id === id)) : key[layer];
    };
    return [keyCode, { ...key, base: select("base"), ctrl: select("ctrl") }];
  }),
);

export function getAllQuantumLayerMeanings(keyCode: string, layer: QuantumLayerId): QuantumKeyMeaning[] {
  return allQuantumKeyboardMap[keyCode]?.[layer] ?? [];
}

export function getQuantumLayerMeanings(keyCode: string, layer: QuantumLayerId): QuantumKeyMeaning[] {
  return quantumKeyboardMap[keyCode]?.[layer] ?? [];
}

export function getQuantumMeaning(
  keyCode: string,
  layer: QuantumLayerId,
  oneBasedIndex: number,
): QuantumKeyMeaning | null {
  const meanings = getQuantumLayerMeanings(keyCode, layer);
  if (meanings.length === 0) return null;
  const safeIndex = Math.max(1, Math.min(Math.trunc(oneBasedIndex), meanings.length));
  return meanings[safeIndex - 1] ?? null;
}

export interface ValidationError {
  keyCode: string;
  field: string;
  message: string;
}

export function isValidLatexCommand(command: string): boolean {
  if (!command || typeof command !== "string") return false;
  const trimmed = command.trim();
  return trimmed.startsWith("\\") || trimmed.startsWith("^") || trimmed.startsWith("_");
}

export function validateKeymap(keymap: QuantumKeymap): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [keyCode, mapping] of Object.entries(keymap)) {
    const candidates = [mapping.default, mapping.shift, ...(mapping.variants ?? [])].filter(Boolean);
    candidates.forEach((candidate, index) => {
      if (!isValidLatexCommand(candidate as string)) {
        errors.push({
          keyCode,
          field: index === 0 ? "default" : index === 1 ? "shift" : `variants[${index - 2}]`,
          message: `Invalid LaTeX command: ${candidate}`,
        });
      }
    });
  }

  return errors;
}

export function getDisplaySymbol(keyCode: string, isShiftHeld: boolean): string | null {
  const mapping = quantumKeymap[keyCode];
  if (!mapping) return null;
  return isShiftHeld && mapping.shift ? mapping.shift : mapping.default;
}

export function getCandidateSymbols(keyCode: string): string[] {
  return getQuantumLayerMeanings(keyCode, "base").map(meaning => meaning.latex);
}

export function getCandidateSymbol(keyCode: string, oneBasedIndex: number): string | null {
  const candidates = getCandidateSymbols(keyCode);
  if (candidates.length === 0) return null;
  const safeIndex = Math.max(1, Math.min(Math.trunc(oneBasedIndex), candidates.length));
  return candidates[safeIndex - 1] ?? null;
}

export function getCandidateLabel(keyCode: string, oneBasedIndex: number): string {
  return getQuantumLayerMeanings(keyCode, "base")[oneBasedIndex - 1]?.label ?? getCandidateSymbol(keyCode, oneBasedIndex) ?? "";
}

export function hasVariants(keyCode: string): boolean {
  return getCandidateSymbols(keyCode).length > 1;
}

export function getVariants(keyCode: string): string[] {
  const candidates = getCandidateSymbols(keyCode);
  return candidates.slice(2);
}
