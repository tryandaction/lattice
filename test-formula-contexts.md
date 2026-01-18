# 公式"大一统"测试文件
# Formula Grand Unification Test

## 标题中的公式测试 (Formulas in Headings)

# 一级标题 $E=mc^2$ 公式
## 二级标题 $\alpha + \beta = \gamma$ 测试
### 三级标题 $\sum_{i=1}^{n} x_i$ 求和
#### 四级标题 $\int_0^1 f(x)dx$ 积分
##### 五级标题 $\nabla \times \vec{B}$ 旋度
###### 六级标题 $\frac{\partial u}{\partial t}$ 偏导

## 粗体中的公式测试 (Formulas in Bold)

这是 **粗体 $E=mc^2$ 公式** 测试。

更复杂的：**包含 $\sum_{i=1}^{n} \frac{1}{i^2} = \frac{\pi^2}{6}$ 的粗体文本**。

## 斜体中的公式测试 (Formulas in Italic)

这是 *斜体 $E=mc^2$ 公式* 测试。

更复杂的：*包含 $\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}$ 的斜体文本*。

## 粗斜体中的公式测试 (Formulas in Bold+Italic)

这是 ***粗斜体 $E=mc^2$ 公式*** 测试。

更复杂的：***包含 $\nabla^2 \psi + \frac{2m}{\hbar^2}(E-V)\psi = 0$ 的粗斜体文本***。

## 删除线中的公式测试 (Formulas in Strikethrough)

这是 ~~删除线 $E=mc^2$ 公式~~ 测试。

## 高亮中的公式测试 (Formulas in Highlight)

这是 ==高亮 $E=mc^2$ 公式== 测试。

更复杂的：==包含 $\lim_{x \to \infty} \frac{1}{x} = 0$ 的高亮文本==。

## 表格中的公式测试 (Formulas in Tables)

### 基础表格公式

| 物理量 | 公式 | 说明 |
|--------|------|------|
| 能量 | $E=mc^2$ | 爱因斯坦质能方程 |
| 动量 | $p=mv$ | 经典力学动量 |
| 力 | $F=ma$ | 牛顿第二定律 |

### 复杂表格公式

| **粗体公式** | *斜体公式* | `代码` |
|-------------|-----------|--------|
| **$\nabla \cdot \vec{E} = \frac{\rho}{\epsilon_0}$** | *$\nabla \times \vec{E} = -\frac{\partial \vec{B}}{\partial t}$* | `E=mc^2` |
| $\sum_{i=1}^{n} x_i$ | ~~$\int_0^1 f(x)dx$~~ | [链接](https://example.com) |
| ==高亮 $\alpha + \beta$== | ***粗斜 $\gamma$*** | 普通文本 |

## 引用块中的公式测试 (Formulas in Blockquotes)

> 这是一个引用块，包含公式 $E=mc^2$

> 多行引用块中的复杂公式：
>
> 薛定谔方程：$i\hbar\frac{\partial}{\partial t}\Psi = \hat{H}\Psi$
>
> 更多说明文字

> **粗体引用 $\alpha$** 和 *斜体引用 $\beta$*

## 列表中的公式测试 (Formulas in Lists)

### 无序列表

- 爱因斯坦质能方程 $E=mc^2$
- 普朗克常数 $h = 6.626 \times 10^{-34}$ J·s
  - 约化普朗克常数 $\hbar = \frac{h}{2\pi}$
  - 能量量子化 $E = h\nu$
- 玻尔兹曼常数 $k_B = 1.381 \times 10^{-23}$ J/K

### 有序列表

1. 麦克斯韦方程组第一式：$\nabla \cdot \vec{E} = \frac{\rho}{\epsilon_0}$
2. 麦克斯韦方程组第二式：$\nabla \cdot \vec{B} = 0$
   1. 推论：$\oint \vec{B} \cdot d\vec{A} = 0$
   2. 物理意义：磁单极子不存在
3. 麦克斯韦方程组第三式：$\nabla \times \vec{E} = -\frac{\partial \vec{B}}{\partial t}$

### 任务列表

- [x] 学习公式 $E=mc^2$
- [ ] 理解公式 $\nabla \times \vec{B} = \mu_0\vec{J} + \mu_0\epsilon_0\frac{\partial \vec{E}}{\partial t}$
- [x] 掌握公式 $\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}$

## 链接中的公式测试 (Formulas with Links)

这是一个包含公式的段落，公式是 $E=mc^2$，还有[链接](https://example.com)。

## 混合复杂测试 (Complex Mixed Contexts)

这是一个 **包含 $\alpha$ 的粗体**，旁边是 *包含 $\beta$ 的斜体*，然后是 ***包含 $\gamma$ 的粗斜体***，接着是 ==包含 $\delta$ 的高亮==，最后是 ~~包含 $\epsilon$ 的删除线~~，以及 `行内代码`。

### 表格+引用+列表组合

> 引用块中的表格：
>
> | 公式 | 类型 |
> |------|------|
> | $E=mc^2$ | 质能方程 |
> | $F=ma$ | 牛顿定律 |
>
> 列表：
> - 公式 $\alpha$
> - 公式 $\beta$

## 代码块前后的公式 (Formulas Around Code Blocks)

公式在代码块前：$E=mc^2$

```python
# 计算能量
def calculate_energy(mass, c=299792458):
    return mass * c ** 2
```

公式在代码块后：$p=mv$

## 水平线前后的公式 (Formulas Around Horizontal Rules)

公式在水平线前：$E=mc^2$

---

公式在水平线后：$F=ma$

***

另一个公式：$\alpha + \beta = \gamma$

## 特殊符号公式测试 (Special Symbol Formulas)

### 希腊字母
$\alpha, \beta, \gamma, \delta, \epsilon, \zeta, \eta, \theta, \iota, \kappa, \lambda, \mu, \nu, \xi, \pi, \rho, \sigma, \tau, \upsilon, \phi, \chi, \psi, \omega$

大写：$\Gamma, \Delta, \Theta, \Lambda, \Xi, \Pi, \Sigma, \Upsilon, \Phi, \Psi, \Omega$

### 数学运算符
$\sum, \prod, \int, \oint, \partial, \nabla, \infty, \pm, \mp, \times, \div, \cdot, \circ, \bullet$

### 关系符号
$=, \neq, \approx, \equiv, \leq, \geq, \ll, \gg, \sim, \propto, \in, \notin, \subset, \supset$

### 箭头
$\rightarrow, \leftarrow, \Rightarrow, \Leftarrow, \leftrightarrow, \Leftrightarrow, \uparrow, \downarrow$

### 复杂结构
分数：$\frac{a}{b}$，$\frac{\partial u}{\partial t}$

根号：$\sqrt{2}$，$\sqrt[3]{8}$

求和：$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$

积分：$\int_{0}^{\pi} \sin(x)dx = 2$

极限：$\lim_{x \to 0} \frac{\sin x}{x} = 1$

矩阵：$\begin{pmatrix} a & b \\ c & d \end{pmatrix}$

## 块级公式与行内公式混合 (Block and Inline Formula Mix)

这是行内公式 $E=mc^2$，接下来是块级公式：

$$
\nabla \times \vec{E} = -\frac{\partial \vec{B}}{\partial t}
$$

然后又是行内公式 $F=ma$，再来一个块级公式：

$$
\begin{aligned}
\nabla \cdot \vec{E} &= \frac{\rho}{\epsilon_0} \\
\nabla \cdot \vec{B} &= 0
\end{aligned}
$$

最后是行内公式 $p=mv$。

## 交互测试说明 (Interaction Test Instructions)

### 1. 点击测试 (Click Test)
- 单击公式（如 $E=mc^2$）应将光标定位到公式开始位置
- 应显示原始 LaTeX 语法：`$E=mc^2$`

### 2. 双击测试 (Double-click Test)
- 双击公式应选中整个公式（包括 $ 符号）
- 可以直接编辑或删除

### 3. 右键复制测试 (Right-click Copy Test)
- 右键点击公式应复制 LaTeX 源码到剪贴板
- 行内公式复制为：`$E=mc^2$`
- 块级公式复制为：`$$\int...$$`
- 应有视觉反馈（绿色高亮）

### 4. 光标显示测试 (Cursor Reveal Test)
- 光标移动到公式所在行，应显示原始语法
- 光标离开，应显示渲染后的公式
- 过渡应平滑无闪烁

### 5. 渲染测试 (Rendering Test)
- 所有公式都应正确渲染，无论在什么上下文中
- 标题中、表格中、粗体中、引用中的公式都应正常显示
- KaTeX 样式应正确应用

---

**测试完成标准**：
- ✅ 所有上下文中的公式都能正确渲染
- ✅ 单击、双击、右键功能正常
- ✅ 光标进入/离开平滑切换
- ✅ 无性能问题、无卡顿
- ✅ 无控制台错误
