// category; LaTeX; Chinese name; English name; search aliases
export const SYMBOL_DATA = String.raw`
structure;\frac{}{};分式;Fraction;分数 除法 fraction divide
structure;\dfrac{}{};展示分式;Display fraction;分数
structure;\sqrt{};平方根;Square root;根号 root
structure;\sqrt[]{};n 次方根;Nth root;根号 root
structure;^{};上标 / 幂;Superscript / power;指数 平方 power
structure;_{};下标;Subscript;指标 index
structure;_{}^{};上下标;Subscript and superscript;指标 幂
structure;\left({}\right);圆括号;Parentheses;括号 brackets
structure;\left[{}\right];方括号;Square brackets;中括号 brackets
structure;\left\{{}\right\};大括号;Braces;花括号 brackets
structure;\left|{}\right|;绝对值;Absolute value;模 absolute
structure;\left\|{}\right\|;范数;Norm;长度 norm
structure;\left\langle{}\right\rangle;尖括号;Angle brackets;平均 average
structure;\lfloor{}\rfloor;向下取整;Floor;取整 floor
structure;\lceil{}\rceil;向上取整;Ceiling;取整 ceil
structure;\begin{cases}{}&{}\\{}&{}\end{cases};分段函数;Piecewise function;cases 分情况
structure;\underbrace{}_{};下括注;Underbrace;括注 annotation
structure;\overbrace{}^{};上括注;Overbrace;括注 annotation
greek;\alpha;阿尔法 α;Alpha;alpha
greek;\beta;贝塔 β;Beta;beta
greek;\gamma;伽马 γ;Gamma;gamma
greek;\delta;德尔塔 δ;Delta;delta
greek;\epsilon;艾普西龙 ε;Epsilon;epsilon
greek;\varepsilon;变体艾普西龙;Variant epsilon;epsilon
greek;\zeta;泽塔 ζ;Zeta;zeta
greek;\eta;伊塔 η;Eta;eta
greek;\theta;西塔 θ;Theta;theta
greek;\vartheta;变体西塔;Variant theta;theta
greek;\iota;约塔 ι;Iota;iota
greek;\kappa;卡帕 κ;Kappa;kappa
greek;\lambda;兰姆达 λ;Lambda;lambda
greek;\mu;缪 μ;Mu;mu
greek;\nu;纽 ν;Nu;nu
greek;\xi;克西 ξ;Xi;xi
greek;\pi;派 π;Pi;pi 圆周率
greek;\varpi;变体派;Variant pi;pi
greek;\rho;柔 ρ;Rho;rho
greek;\varrho;变体柔;Variant rho;rho
greek;\sigma;西格马 σ;Sigma;sigma
greek;\varsigma;末尾西格马;Final sigma;sigma
greek;\tau;陶 τ;Tau;tau
greek;\upsilon;宇普西龙 υ;Upsilon;upsilon
greek;\phi;斐 φ;Phi;phi
greek;\varphi;变体斐;Variant phi;phi
greek;\chi;希 χ;Chi;chi
greek;\psi;普赛 ψ;Psi;psi
greek;\omega;欧米伽 ω;Omega;omega
greek;\Gamma;大写伽马 Γ;Capital gamma;gamma
greek;\Delta;大写德尔塔 Δ;Capital delta;delta
greek;\Theta;大写西塔 Θ;Capital theta;theta
greek;\Lambda;大写兰姆达 Λ;Capital lambda;lambda
greek;\Xi;大写克西 Ξ;Capital xi;xi
greek;\Pi;大写派 Π;Capital pi;pi
greek;\Sigma;大写西格马 Σ;Capital sigma;sigma
greek;\Upsilon;大写宇普西龙 Υ;Capital upsilon;upsilon
greek;\Phi;大写斐 Φ;Capital phi;phi
greek;\Psi;大写普赛 Ψ;Capital psi;psi
greek;\Omega;大写欧米伽 Ω;Capital omega;omega
calculus;\int;积分;Integral;积分 integral
calculus;\iint;二重积分;Double integral;积分 double integral
calculus;\iiint;三重积分;Triple integral;积分 triple integral
calculus;\oint;环路积分;Contour integral;闭合积分 integral
calculus;\oiint;闭曲面积分;Closed surface integral;曲面 二重环路积分 closed surface double contour integral
calculus;\oiiint;闭体积分;Closed volume integral;闭合体积 三重环路积分 closed volume triple contour integral
calculus;\int_{}^{};定积分;Definite integral;上下限 bounded integral
calculus;\int_{}^{} {}\,\mathrm{d}{};定积分模板;Definite integral template;积分 微分 integral
calculus;\sum;求和;Sum;求和 summation
calculus;\sum_{}^{} {};求和模板;Summation template;上下限 sum
calculus;\prod;连乘;Product;积 product
calculus;\prod_{}^{} {};连乘模板;Product template;积 product
calculus;\lim;极限;Limit;limit
calculus;\lim_{{}\to{}} {};极限模板;Limit template;趋于 limit
calculus;\frac{d}{d};导数;Derivative;微分 derivative
calculus;\frac{d{}}{d{}};导数模板;Derivative template;微分 derivative
calculus;\frac{\partial}{\partial};偏导数;Partial derivative;微分 partial
calculus;\frac{\partial{}}{\partial{}};偏导模板;Partial derivative template;微分 partial
calculus;\partial;偏微分符号;Partial;偏导 partial
calculus;\mathrm{d};微分 d;Differential d;微分 differential
calculus;\nabla;梯度 / 纳布拉;Nabla / gradient;散度 旋度 gradient del
calculus;\infty;无穷大;Infinity;无限 infinity
calculus;\sin;正弦;Sine;三角函数 sin sine
calculus;\cos;余弦;Cosine;三角函数 cos cosine
calculus;\tan;正切;Tangent;三角函数 tan tangent
calculus;\arcsin;反正弦;Arcsine;反三角 arcsin
calculus;\arccos;反余弦;Arccosine;反三角 arccos
calculus;\arctan;反正切;Arctangent;反三角 arctan
calculus;\sinh;双曲正弦;Hyperbolic sine;sinh
calculus;\cosh;双曲余弦;Hyperbolic cosine;cosh
calculus;\tanh;双曲正切;Hyperbolic tangent;tanh
calculus;\log;对数;Logarithm;log
calculus;\ln;自然对数;Natural logarithm;ln
calculus;\exp;指数函数;Exponential;exp
calculus;e^{};自然指数;Natural exponential;指数 exp
algebra;\begin{pmatrix}{}&{}\\{}&{}\end{pmatrix};圆括号矩阵 2×2;Parenthesized matrix 2×2;矩阵 matrix
algebra;\begin{bmatrix}{}&{}\\{}&{}\end{bmatrix};方括号矩阵 2×2;Bracketed matrix 2×2;矩阵 matrix
algebra;\begin{matrix}{}&{}\\{}&{}\end{matrix};无括号矩阵 2×2;Plain matrix 2×2;矩阵 matrix
algebra;\begin{vmatrix}{}&{}\\{}&{}\end{vmatrix};行列式 2×2;Determinant 2×2;矩阵 determinant
algebra;\begin{pmatrix}{}\\{}\end{pmatrix};列向量;Column vector;向量 vector
algebra;\begin{pmatrix}{}&{}&{}\\{}&{}&{}\\{}&{}&{}\end{pmatrix};矩阵 3×3;Matrix 3×3;矩阵 matrix
algebra;\vec{};向量箭头;Vector accent;矢量 vector
algebra;\mathbf{};粗体向量;Bold vector;加粗 bold
algebra;\hat{};帽子 / 单位向量;Hat accent;hat
algebra;\widehat{};宽帽子;Wide hat;hat
algebra;\bar{};横线;Bar accent;平均 bar
algebra;\overline{};上划线;Overline;共轭 overline
algebra;\widetilde{};波浪线;Wide tilde;tilde
algebra;\tilde{};波浪号;Tilde;tilde
algebra;\dot{};一阶时间导数;Dot accent;点 dot
algebra;\ddot{};二阶时间导数;Double dot;两点 ddot
algebra;\top;转置;Transpose;transpose
algebra;\dagger;厄米共轭;Dagger;伴随 dagger
algebra;\det;行列式算子;Determinant;det
algebra;\operatorname{tr};迹;Trace;tr trace
algebra;\operatorname{rank};秩;Rank;rank
algebra;\mathbb{I};单位算子;Identity operator;identity
relations;=;等于;Equals;equal
relations;\neq;不等于;Not equal;ne neq
relations;\approx;约等于;Approximately equal;approx
relations;\equiv;恒等 / 等价;Equivalent;equiv
relations;\leq;小于等于;Less than or equal;leq
relations;\geq;大于等于;Greater than or equal;geq
relations;<;小于;Less than;less
relations;>;大于;Greater than;greater
relations;\ll;远小于;Much less than;ll
relations;\gg;远大于;Much greater than;gg
relations;\propto;正比于;Proportional to;propto
relations;\sim;相似 / 渐近;Similar;sim
relations;\rightarrow;右箭头 / 趋于;Right arrow;to arrow
relations;\leftarrow;左箭头;Left arrow;arrow
relations;\leftrightarrow;双向箭头;Left-right arrow;arrow
relations;\Rightarrow;推出;Implies;implies
relations;\Leftarrow;反向推出;Implied by;implies
relations;\Leftrightarrow;当且仅当;If and only if;iff
relations;\mapsto;映射到;Maps to;mapping
relations;\uparrow;向上箭头;Up arrow;arrow
relations;\downarrow;向下箭头;Down arrow;arrow
relations;\forall;任意 / 全称量词;For all;所有 forall
relations;\exists;存在;Exists;exists
relations;\neg;非 / 否定;Negation;not neg
relations;\wedge;逻辑与;Logical and;and wedge
relations;\vee;逻辑或;Logical or;or vee
relations;\therefore;所以;Therefore;therefore
relations;\because;因为;Because;because
relations;\parallel;平行;Parallel;parallel
relations;\perp;垂直;Perpendicular;perp
relations;\angle;角;Angle;angle
sets;\in;属于;Element of;in element
sets;\notin;不属于;Not an element;notin
sets;\subset;真子集;Subset;subset
sets;\subseteq;子集或相等;Subset or equal;subset
sets;\supseteq;超集或相等;Superset or equal;superset
sets;\cup;并集;Union;union cup
sets;\bigcup;大并集;Big union;union
sets;\cap;交集;Intersection;intersection cap
sets;\bigcap;大交集;Big intersection;intersection
sets;\uplus;不交并;Disjoint union;union
sets;\setminus;集合差;Set difference;difference
sets;\varnothing;空集;Empty set;empty
sets;\mathbb{N};自然数集;Natural numbers;natural
sets;\mathbb{Z};整数集;Integers;integers
sets;\mathbb{Q};有理数集;Rationals;rational
sets;\mathbb{R};实数集;Real numbers;real
sets;\mathbb{C};复数集;Complex numbers;complex
sets;\aleph;阿列夫;Aleph;aleph
physics;\hbar;约化普朗克常数;H-bar;hbar
physics;\ket{};右矢 / Ket;Ket;量子态 右矢 ket
physics;\bra{};左矢 / Bra;Bra;量子态 左矢 bra
physics;\braket{}{};内积 / Bra-ket;Bra-ket inner product;内积 braket
physics;\ket{}\bra{};外积 / 投影算子;Outer product;外积 projector
physics;\left[{},{}\right];对易子;Commutator;对易 commutator
physics;\left\{{},{}\right\};反对易子;Anticommutator;反对易
physics;\langle{}\rangle;期望值;Expectation value;平均 expectation
physics;\mathcal{H};希尔伯特空间 / 哈密顿量;Hilbert space / Hamiltonian;hilbert hamiltonian
physics;\hat{H};哈密顿算子;Hamiltonian operator;hamiltonian
symbols;+;加号;Plus;加 plus
symbols;-;减号;Minus;减 minus
symbols;\pm;正负号;Plus-minus;正负 pm
symbols;\mp;负正号;Minus-plus;负正 mp
symbols;\times;乘号 / 叉乘;Times / cross product;乘法 times
symbols;\div;除号;Division;除法 divide
symbols;\cdot;点乘;Dot product;乘法 dot
symbols;\otimes;张量积;Tensor product;直积 tensor
symbols;\oplus;直和;Direct sum;oplus
symbols;\odot;圈点积;Circled dot;odot
symbols;\circ;复合运算;Composition;circ
symbols;\ldots;横向省略号;Horizontal dots;省略号 dots
symbols;\cdots;居中省略号;Centered dots;省略号 dots
symbols;\vdots;纵向省略号;Vertical dots;省略号 dots
symbols;\ddots;对角省略号;Diagonal dots;省略号 dots
symbols;\jmath;无点 j;Dotless j;jmath
symbols;\rangle;右尖括号;Right angle bracket;bracket
calculus;\iint_{}^{};二重定积分;Definite double integral;二重积分 double integral
calculus;\iiint_{}^{};三重定积分;Definite triple integral;三重积分 triple integral
calculus;\oint_{}^{};环路定积分;Definite contour integral;环路积分 contour integral
calculus;\oiint_{}^{};闭曲面积分上下限模板;Bounded closed surface integral;闭曲面 环路 double contour
calculus;\oiiint_{}^{};闭体积分上下限模板;Bounded closed volume integral;闭体积 环路 triple contour
`;
