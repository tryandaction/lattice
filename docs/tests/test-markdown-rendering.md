# Markdown 渲染测试文件

## 标题测试

# 一级标题
## 二级标题
### 三级标题
#### 四级标题
##### 五级标题
###### 六级标题

## 内联格式测试

这是一段包含 **粗体文本**、*斜体文本*、***粗体斜体***、~~删除线~~、==高亮== 和 `行内代码` 的段落。

## LaTeX 公式测试

行内公式：$E = mc^2$，更复杂的：$\sum_{i=1}^{n} x_i$

块级公式：
$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

多行公式：
$$
\begin{aligned}
\nabla \cdot \vec{E} &= \frac{\rho}{\epsilon_0} \\
\nabla \cdot \vec{B} &= 0 \\
\nabla \times \vec{E} &= -\frac{\partial \vec{B}}{\partial t} \\
\nabla \times \vec{B} &= \mu_0\vec{J} + \mu_0\epsilon_0\frac{\partial \vec{E}}{\partial t}
\end{aligned}
$$

## 列表测试

无序列表：
- 项目 1
- 项目 2
  - 嵌套项目 2.1
  - 嵌套项目 2.2
- 项目 3

有序列表：
1. 第一项
2. 第二项
   1. 嵌套 2.1
   2. 嵌套 2.2
3. 第三项

任务列表：
- [ ] 未完成任务 1
- [x] 已完成任务 1
- [ ] 未完成任务 2
- [x] 已完成任务 2

## 引用块测试

> 这是一个简单的引用块

> 这是一个包含 **格式化文本** 和 $E=mc^2$ 公式的引用块
>
> 可以有多个段落

> 嵌套引用
>> 第二层引用
>>> 第三层引用

## 代码块测试

```javascript
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10));
```

```python
def quick_sort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quick_sort(left) + middle + quick_sort(right)

print(quick_sort([3, 6, 8, 10, 1, 2, 1]))
```

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

const users: User[] = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' },
];
```

## 表格测试

| 列 1 | 列 2 | 列 3 |
|------|------|------|
| 数据 A | 数据 B | 数据 C |
| 数据 D | 数据 E | 数据 F |

包含格式的表格：

| **粗体** | *斜体* | `代码` |
|----------|--------|--------|
| $E=mc^2$ | ~~删除~~ | [链接](https://example.com) |
| 普通文本 | **混合** *格式* | 更多内容 |

## 链接和图片测试

[普通链接](https://example.com)

[带标题的链接](https://example.com "这是链接标题")

![图片替代文本](https://via.placeholder.com/150)

## 水平分隔线测试

上面的内容

---

下面的内容

***

另一段内容

___

最后一段

## 混合测试

这是一个包含多种元素的复杂段落：**粗体**、*斜体*、`代码`、$\alpha + \beta = \gamma$、[链接](https://example.com)、~~删除线~~、==高亮==。

> 引用中的列表：
> - 项目 1
> - 项目 2
>
> 引用中的公式：$\int_0^1 x^2 dx = \frac{1}{3}$

## Wiki 链接测试

[[其他文档]]

[[其他文档|显示文本]]

[[文档#标题]]

## Callout 测试

> [!note]
> 这是一个笔记callout

> [!warning]
> 这是一个警告callout

> [!tip]
> 这是一个提示callout

> [!important]
> 这是一个重要callout

## 脚注测试

这是一段带有脚注的文本[^1]。

这里还有另一个脚注[^note]。

[^1]: 这是第一个脚注的内容
[^note]: 这是命名脚注的内容

---

**测试说明**：
1. 光标移动到任何行时，应该显示原始Markdown语法
2. 光标离开时，应该显示渲染后的格式化内容
3. 过渡应该平滑，无闪烁
4. 所有元素都应该正确渲染
