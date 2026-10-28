/** Standard LaTeX formulas shared by the physical keyboard and searchable catalog. */
export interface QuantumShortLabel { zh: string; en: string }

export interface QuantumFormulaPreset {
  /** Explicit stable ID for a new non-positional meaning. */
  id?: string;
  keyCode: string;
  latex: string;
  nameZh: string;
  nameEn: string;
  shortLabel?: QuantumShortLabel;
  category: "calculus" | "linear-algebra" | "physics" | "chemistry";
  keywords: string[];
}

// Append to the extended layer so existing candidate IDs and user overrides remain stable.
export const QUANTUM_FORMULA_PRESETS: readonly QuantumFormulaPreset[] = [
  { keyCode: "KeyQ", latex: String.raw`F=k_e\frac{|q_1q_2|}{r^2}`, nameZh: "库仑力大小（点电荷）", nameEn: "Coulomb force magnitude (point charges)", shortLabel: { zh: "库仑力", en: "Coulomb" }, category: "physics", keywords: ["电荷", "静电力", "库仑", "coulomb", "charge", "electrostatic force"] },
  { keyCode: "KeyW", latex: String.raw`W=\int_C\mathbf{F}\cdot\mathrm{d}\mathbf{r}`, nameZh: "力场做功线积分", nameEn: "Work line integral", shortLabel: { zh: "做功积分", en: "Work int." }, category: "calculus", keywords: ["功", "线积分", "work", "line integral"] },
  { keyCode: "KeyY", latex: String.raw`Y=\frac{m_{\mathrm{actual}}}{m_{\mathrm{theoretical}}}\times100\%`, nameZh: "化学产率", nameEn: "Percent yield", shortLabel: { zh: "产率", en: "Yield" }, category: "chemistry", keywords: ["产率", "实际产量", "理论产量", "percent yield", "actual yield", "theoretical yield"] },
  { keyCode: "KeyY", latex: String.raw`Y=\frac{\sigma}{\varepsilon}`, nameZh: "杨氏模量（单轴线弹性）", nameEn: "Young modulus (uniaxial linear elasticity)", shortLabel: { zh: "杨氏模量", en: "Young" }, category: "physics", keywords: ["杨氏模量", "应力", "应变", "young modulus", "stress", "strain", "linear elasticity"] },
  { keyCode: "KeyI", latex: String.raw`\int_a^b u\,\mathrm{d}v=[uv]_a^b-\int_a^b v\,\mathrm{d}u`, nameZh: "分部积分公式", nameEn: "Integration by parts", shortLabel: { zh: "分部积分", en: "By parts" }, category: "calculus", keywords: ["积分", "分部", "integral", "parts"] },
  { keyCode: "KeyO", latex: String.raw`\oint_C f(z)\,\mathrm{d}z`, nameZh: "复变函数闭路积分", nameEn: "Complex contour integral", shortLabel: { zh: "复变环路", en: "Contour" }, category: "calculus", keywords: ["闭路", "复变", "contour", "complex analysis"] },
  { keyCode: "KeyZ", latex: String.raw`Z(\omega)=\frac{\underline{V}(\omega)}{\underline{I}(\omega)}`, nameZh: "交流阻抗（相量比）", nameEn: "AC impedance (phasor ratio)", shortLabel: { zh: "交流阻抗", en: "Imped." }, category: "physics", keywords: ["阻抗", "相量", "频率", "impedance", "phasor", "frequency"] },
  { keyCode: "KeyJ", latex: String.raw`\det J=\frac{\partial x}{\partial u}\frac{\partial y}{\partial v}-\frac{\partial x}{\partial v}\frac{\partial y}{\partial u}`, nameZh: "二维雅可比行列式", nameEn: "Two-dimensional Jacobian determinant", shortLabel: { zh: "雅可比", en: "Jacobian" }, category: "linear-algebra", keywords: ["雅可比", "行列式", "坐标变换", "jacobian", "determinant", "coordinate transform"] },
  { keyCode: "KeyX", latex: String.raw`\det(A-\lambda I)=0`, nameZh: "特征方程", nameEn: "Characteristic equation", category: "linear-algebra", keywords: ["特征值", "行列式", "eigenvalue", "determinant"] },
  { keyCode: "KeyV", latex: String.raw`\mathbf{v}=\frac{\mathrm{d}\mathbf{r}}{\mathrm{d}t}`, nameZh: "瞬时速度定义", nameEn: "Instantaneous velocity", shortLabel: { zh: "瞬时速度", en: "Velocity" }, category: "physics", keywords: ["速度", "位移", "velocity", "displacement", "time derivative"] },
  { keyCode: "KeyM", latex: String.raw`A^{-1}=\frac{\operatorname{adj}(A)}{\det(A)}`, nameZh: "可逆矩阵的逆矩阵公式", nameEn: "Inverse matrix (det A nonzero)", shortLabel: { zh: "逆矩阵", en: "Inverse" }, category: "linear-algebra", keywords: ["矩阵", "逆矩阵", "伴随矩阵", "matrix inverse", "adjugate"] },
  { keyCode: "KeyA", latex: String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`, nameZh: "一元二次方程求根公式", nameEn: "Quadratic formula", category: "calculus", keywords: ["求根", "quadratic", "roots"] },
  { keyCode: "KeyA", latex: String.raw`A\mathbf{v}=\lambda\mathbf{v}`, nameZh: "特征值方程", nameEn: "Eigenvalue equation", category: "linear-algebra", keywords: ["特征值", "特征向量", "eigenvalue", "eigenvector"] },
  { keyCode: "KeyB", latex: String.raw`P(A\mid B)=\frac{P(B\mid A)P(A)}{P(B)}`, nameZh: "贝叶斯公式", nameEn: "Bayes theorem", shortLabel: { zh: "贝叶斯", en: "Bayes" }, category: "calculus", keywords: ["概率", "条件概率", "bayes", "probability"] },
  { keyCode: "KeyC", latex: String.raw`{}_{Z}^{A}\mathrm{X}`, nameZh: "核素与同位素模板", nameEn: "Nuclide / isotope template", category: "chemistry", keywords: ["原子", "原子序数", "质量数", "nuclide", "isotope"] },
  { keyCode: "KeyC", latex: String.raw`\mathrm{SO}_{4}^{2-}`, nameZh: "离子电荷（硫酸根）", nameEn: "Ion charge (sulfate)", category: "chemistry", keywords: ["化学式", "离子", "电荷", "ion", "charge", "sulfate"] },
  { keyCode: "KeyC", latex: String.raw`2\mathrm{H}_{2}+\mathrm{O}_{2}\rightarrow 2\mathrm{H}_{2}\mathrm{O}`, nameZh: "配平化学反应（水生成）", nameEn: "Balanced reaction (water formation)", shortLabel: { zh: "配平反应", en: "Balanced" }, category: "chemistry", keywords: ["化学方程式", "配平", "反应", "reaction", "stoichiometry"] },
  { keyCode: "KeyC", latex: String.raw`c=\frac{n}{V}`, nameZh: "物质的量浓度", nameEn: "Molar concentration", category: "chemistry", keywords: ["浓度", "摩尔", "concentration", "molarity"] },
  { keyCode: "KeyD", latex: String.raw`\oiint_{\partial V}\mathbf{F}\cdot\mathrm{d}\mathbf{S}=\iiint_V\nabla\cdot\mathbf{F}\,\mathrm{d}V`, nameZh: "高斯散度定理", nameEn: "Divergence theorem", shortLabel: { zh: "散度定理", en: "Gauss" }, category: "calculus", keywords: ["散度", "曲面积分", "高斯", "gauss", "divergence", "flux"] },
  { keyCode: "KeyE", latex: String.raw`\mathrm{i}\hbar\frac{\partial\psi}{\partial t}=\hat{H}\psi`, nameZh: "含时薛定谔方程", nameEn: "Time-dependent Schrodinger equation", shortLabel: { zh: "薛定谔", en: "Schröd." }, category: "physics", keywords: ["量子", "波函数", "薛定谔", "schrodinger", "wavefunction"] },
  { keyCode: "KeyE", latex: String.raw`E=mc^2`, nameZh: "质能关系", nameEn: "Mass-energy equivalence", category: "physics", keywords: ["爱因斯坦", "相对论", "einstein", "energy", "relativity"] },
  { keyCode: "KeyE", latex: String.raw`\langle A\rangle=\langle\psi|\hat{A}|\psi\rangle`, nameZh: "量子期望值", nameEn: "Quantum expectation value", shortLabel: { zh: "期望值", en: "Expect." }, category: "physics", keywords: ["期望值", "量子", "expectation", "quantum"] },
  { keyCode: "KeyF", latex: String.raw`\hat{f}(\omega)=\int_{-\infty}^{\infty}f(t)e^{-\mathrm{i}\omega t}\,\mathrm{d}t`, nameZh: "傅里叶变换", nameEn: "Fourier transform", shortLabel: { zh: "傅里叶", en: "Fourier" }, category: "calculus", keywords: ["傅里叶", "频谱", "fourier", "transform", "spectrum"] },
  { keyCode: "KeyF", latex: String.raw`\mathbf{F}=m\mathbf{a}`, nameZh: "牛顿第二定律", nameEn: "Newton second law", category: "physics", keywords: ["力学", "牛顿", "newton", "force", "mechanics"] },
  { keyCode: "KeyG", latex: String.raw`\Delta G=\Delta H-T\Delta S`, nameZh: "吉布斯自由能（恒温）", nameEn: "Gibbs free energy (isothermal)", category: "chemistry", keywords: ["吉布斯", "热力学", "恒温", "isothermal", "gibbs", "thermodynamics", "free energy"] },
  { keyCode: "KeyH", latex: String.raw`\Delta x\,\Delta p\geq\frac{\hbar}{2}`, nameZh: "海森堡不确定性关系", nameEn: "Heisenberg uncertainty relation", category: "physics", keywords: ["不确定性", "海森堡", "uncertainty", "heisenberg"] },
  { keyCode: "KeyK", latex: String.raw`K=\frac{[\mathrm{C}]^c[\mathrm{D}]^d}{[\mathrm{A}]^a[\mathrm{B}]^b}`, nameZh: "浓度平衡常数", nameEn: "Concentration equilibrium constant", shortLabel: { zh: "平衡常数", en: "Equil." }, category: "chemistry", keywords: ["化学平衡", "平衡常数", "equilibrium", "mass action"] },
  { keyCode: "KeyL", latex: String.raw`\mathcal{L}\{f\}(s)=\int_0^\infty f(t)e^{-st}\,\mathrm{d}t`, nameZh: "拉普拉斯变换", nameEn: "Laplace transform", shortLabel: { zh: "拉普拉斯", en: "Laplace" }, category: "calculus", keywords: ["拉普拉斯", "laplace", "transform"] },
  { keyCode: "KeyN", latex: String.raw`E=E^\circ-\frac{RT}{nF}\ln Q`, nameZh: "能斯特方程", nameEn: "Nernst equation", shortLabel: { zh: "能斯特", en: "Nernst" }, category: "chemistry", keywords: ["能斯特", "电化学", "电极电势", "nernst", "electrochemistry"] },
  { keyCode: "KeyN", latex: String.raw`f(x)=\frac{1}{\sigma\sqrt{2\pi}}e^{-\frac{(x-\mu)^2}{2\sigma^2}}`, nameZh: "正态分布概率密度", nameEn: "Normal probability density", shortLabel: { zh: "正态分布", en: "Normal" }, category: "calculus", keywords: ["正态分布", "高斯分布", "概率", "normal", "gaussian", "probability"] },
  { keyCode: "KeyP", latex: String.raw`\mathrm{pH}=-\log_{10}[\mathrm{H}^{+}]`, nameZh: "酸碱度 pH（浓度近似）", nameEn: "pH (concentration approximation)", category: "chemistry", keywords: ["酸碱度", "酸度", "ph", "acidity", "concentration"] },
  { keyCode: "KeyR", latex: String.raw`{}\xrightarrow[{}]{}{}`, nameZh: "带条件反应箭头模板", nameEn: "Reaction arrow with conditions", category: "chemistry", keywords: ["化学反应", "反应箭头", "条件", "reaction", "arrow", "catalyst"] },
  { keyCode: "KeyR", latex: String.raw`{}\rightleftharpoons{}`, nameZh: "可逆反应模板", nameEn: "Reversible reaction template", category: "chemistry", keywords: ["化学平衡", "可逆", "reaction", "equilibrium", "reversible"] },
  { keyCode: "KeyR", latex: String.raw`k=A\exp\left(-\frac{E_a}{RT}\right)`, nameZh: "阿伦尼乌斯方程", nameEn: "Arrhenius equation", shortLabel: { zh: "阿伦尼乌斯", en: "Arrhenius" }, category: "chemistry", keywords: ["阿伦尼乌斯", "活化能", "反应速率", "arrhenius", "activation", "kinetics"] },
  { keyCode: "KeyS", latex: String.raw`\oint_{\partial S}\mathbf{F}\cdot\mathrm{d}\mathbf{r}=\iint_S(\nabla\times\mathbf{F})\cdot\mathrm{d}\mathbf{S}`, nameZh: "斯托克斯定理", nameEn: "Stokes theorem", shortLabel: { zh: "斯托克斯", en: "Stokes" }, category: "calculus", keywords: ["斯托克斯", "旋度", "环路积分", "stokes", "curl", "circulation"] },
  { keyCode: "KeyS", latex: String.raw`S=k_B\ln\Omega`, nameZh: "玻尔兹曼熵", nameEn: "Boltzmann entropy", category: "physics", keywords: ["熵", "玻尔兹曼", "统计物理", "boltzmann", "entropy"] },
  { keyCode: "KeyT", latex: String.raw`pV=nRT`, nameZh: "理想气体状态方程", nameEn: "Ideal gas law", shortLabel: { zh: "理想气体", en: "Ideal gas" }, category: "physics", keywords: ["理想气体", "状态方程", "热力学", "ideal gas", "thermodynamics"] },
  { keyCode: "KeyU", latex: String.raw`\Delta U=Q-W`, nameZh: "热力学第一定律（系统对外做功）", nameEn: "First law (work done by system)", category: "physics", keywords: ["内能", "热力学", "first law", "thermodynamics", "energy"] },
  { id: "ctrl-KeyI-integral-1", keyCode: "KeyI", latex: String.raw`\oiiint`, nameZh: "闭体积分", nameEn: "Closed volume integral", category: "calculus", keywords: ["闭体积", "三重环路积分", "closed volume", "triple contour integral"] },
  { id: "ctrl-KeyI-integral-2", keyCode: "KeyI", latex: String.raw`\iint_{}^{}`, nameZh: "二重定积分", nameEn: "Definite double integral", category: "calculus", keywords: ["二重积分", "上下限", "bounded double integral"] },
  { id: "ctrl-KeyI-integral-3", keyCode: "KeyI", latex: String.raw`\iiint_{}^{}`, nameZh: "三重定积分", nameEn: "Definite triple integral", category: "calculus", keywords: ["三重积分", "上下限", "bounded triple integral"] },
  { id: "ctrl-KeyI-integral-4", keyCode: "KeyI", latex: String.raw`\oint_{}^{}`, nameZh: "环路定积分", nameEn: "Definite contour integral", category: "calculus", keywords: ["环路积分", "上下限", "bounded contour integral"] },
  { id: "ctrl-KeyI-integral-5", keyCode: "KeyI", latex: String.raw`\oiint_{}^{}`, nameZh: "闭曲面积分上下限模板", nameEn: "Bounded closed surface integral", category: "calculus", keywords: ["闭曲面", "上下限", "double contour", "bounded surface integral"] },
  { id: "ctrl-KeyI-integral-6", keyCode: "KeyI", latex: String.raw`\oiiint_{}^{}`, nameZh: "闭体积分上下限模板", nameEn: "Bounded closed volume integral", category: "calculus", keywords: ["闭体积", "上下限", "triple contour", "bounded volume integral"] },
];
