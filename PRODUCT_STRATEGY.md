# Lattice 产品策略

> 更新时间：2026-03-24

## 产品定位

Lattice 的目标不是做一个“又一个通用笔记应用”，也不是直接复制 VS Code、Zotero 或 Notion，而是把三条原本分裂的科研工作流收口到同一个本地优先工作台里：

- 文献阅读与批注
- 笔记、草稿与知识沉淀
- 代码、Notebook 与实验执行

当前产品主线已经明确为：

- **本地优先**
- **研究对象可回链**
- **PDF / Markdown / Notebook / Code 在同一工作区协作**
- **AI 结果必须能回到证据和文件位置**

## 当前差异化

相较于 Obsidian / Zotero / Notion，Lattice 当前最核心的差异化已经不是某一个单点功能，而是以下组合：

### 1. PDF 条目工作区

单个 PDF 现在不再只是一个阅读文件，而是一个完整条目：

- 首次打开自动建立同级隐藏兄弟目录 `.basename.lattice/`
- 默认包含 `条目概览`、`批注索引`、阅读笔记、Notebook 工作区
- Explorer 隐藏真实目录，只展示 PDF 下的虚拟子条目
- PDF 批注、笔记、Notebook、反链、深链都围绕同一个条目组织

这条能力是 Lattice 当前最接近 Zotero、同时又比 Zotero 更开放的一条主线。

### 2. 本地优先研究执行

- 桌面端优先本地 Python / 外部命令运行器
- Notebook 使用真实本地持久 Python session
- Markdown 代码块、代码文件、Notebook code cell 共用统一 `Run / Problems` 模型
- Runner Manager 与 Runner Diagnostics 已进入主链路

这让 Lattice 不只是“看资料和记笔记”，而是能继续做实验、验证和整理结果。

### 3. 证据驱动 AI

- `@引用`、Evidence Panel、Selection AI、Workbench 已形成连续主链路
- AI 结果强调 `Conclusion / Evidence / Next Actions`
- Draft / Proposal / Writeback 都能回到工作区真实文件
- PDF 页、批注、Markdown 标题、代码行、Notebook cell 都可定位

这让 AI 不只是聊天，而是科研工作流中的结构化工具。

## 当前产品基线

当前可作为主宣传口径的能力：

- PDF 条目工作区 v2
- PDF 批注自动镜像 `_annotations.md`
- 批注反链与笔记回跳
- Markdown / Notebook / PDF 的统一内部深链
- 桌面本地运行器主链路
- Notebook 持久 Python 会话
- `Run / Problems` 统一反馈
- AI Evidence / Workbench 主链路
- Cloudflare Pages 主站 + 桌面本地发布目录双发布模型

## 接下来最该继续做的产品项

### 1. PDF 条目元数据面板

当前条目已经有容器和文件结构，但还缺少更强的“文献条目”信息层。

优先补：

- 阅读状态
- 标签
- 优先级
- 评分
- 作者 / 年份 / 来源
- DOI / URL / citation 信息

### 2. 批注工作流深化

当前批注已经能镜像、反链、深链，但还可以继续向 Zotero 级体验推进：

- 批注筛选、排序、批量整理
- 批注与阅读笔记的双栏联动
- 条目概览页自动汇总高频批注主题
- 批注导出为学习卡片 / 文献摘要

### 3. 条目概览页产品化

当前 `_overview.md` 是结构化模板，下一步应该强化为真正的文献工作台首页：

- 最近活动
- 最近关联文件
- 批注统计
- 未整理批注计数
- AI 摘要入口
- 一键生成阅读报告

### 4. AI 研究整理深化

当前 AI 已能围绕证据组织工作流，下一步重点不是再加入口，而是提高沉淀质量：

- 针对 PDF 条目的专用研究摘要模板
- 基于批注自动生成问题清单 / reading note
- 跨多 PDF 条目的比较总结
- 更强的 proposal 到 draft set 的自动化

## 发布策略

当前发布策略已经明确：

- **Web 主站**：Cloudflare Pages `https://lattice-apq.pages.dev`
- **Web 备用链路**：GitHub Pages
- **桌面事实来源**：`releases/vX.Y.Z/`

发布要求：

- 代码门禁要全绿
- 文档口径同步
- 桌面产物与 release metadata 刷新
- Web 主站部署完成并可访问

## 不做什么

当前阶段明确不追求：

- 完整 VS Code 级 IDE 替代
- 通用协作文档平台
- 复杂多人权限系统
- 先做云同步再补产品主线

优先级仍然是：

1. 把单人科研工作流做到扎实
2. 把 PDF 条目系统做到明显优于“PDF + 文件夹”拼装体验
3. 把 AI 与证据回链变成真正的研究工具
