# AI Development Guide - Lattice 格致

**Last Updated**: 2026-03-21  
**Purpose**: 为 AI 助手和维护者提供当前项目基线、文档入口、工程门禁和仓库整理约定。

---

## 1. 项目定位

Lattice 当前不是“功能堆积型工具箱”，而是一个本地优先的科研工作台。当前主线由四部分组成：

1. 代码与 Notebook 运行体验继续向本地 IDE 靠拢
2. AI 引用、Evidence、Workbench 与草稿写回形成知识组织主路径
3. diagnostics / browser regression / runner health 形成稳定 QA 基线
4. 本地发布准备、桌面构建、GitHub Pages / draft release 工作流形成工程闭环

---

## 2. 当前产品基线

### 代码与运行

- Notebook Markdown Cell 已复用 Live Preview 内核
- 代码文件、Notebook code cell、editable Markdown code block 已统一接入 `Run / Problems`
- 桌面端默认优先本地 Python / 外部命令运行器，禁止无声 Pyodide 主路径回退
- Workspace Runner Manager 与 `/diagnostics/runner` 已进入主链路

### AI 与知识组织

- AI Chat 使用统一的 `AiResultViewModel`
- Evidence Panel 与 `@引用` 共用 `ReferenceBrowser`
- Workbench 草稿支持 `templateId / originMessageId / originProposalId`
- Selection AI、Evidence、Workbench 已打通为连续工作流

### QA 与发布

- `npm run qa:gate` 是当前完整门禁
- `scripts/browser-regression.mjs` 覆盖 diagnostics 主链路
- `scripts/prepare-release.mjs` 是唯一发布准备实现
- `releases/vX.Y.Z/` 是本地发布事实来源

---

## 3. 关键文档入口

### 产品文档

- `README.md`
- `docs/USER_GUIDE.md`
- `docs/DESKTOP_FEATURES.md`
- `docs/RELEASE_NOTES.md`

### 工程与发布

- `docs/ARCHITECTURE.md`
- `docs/guides/installation.md`
- `docs/guides/desktop-app.md`
- `docs/guides/github-deploy.md`
- `docs/MANUAL_RELEASE_GUIDE.md`

### 仍应保留的辅助文档

- `docs/examples/plugins/`：插件示例
- `docs/tests/`：人工测试/样例文档
- `public/test-*.md`：产品内诊断与性能样例

---

## 4. 代码与目录说明

```text
src/
  app/                         页面、diagnostics、guide
  components/                  编辑器、AI、Notebook、诊断、渲染器
  hooks/                       运行器、编辑器、对象 URL 等 hooks
  lib/                         AI、runner、link router、导出、解析等核心逻辑
  stores/                      Zustand 全局状态
src-tauri/                     桌面壳、本地运行、Tauri 配置
public/                        静态资源与测试样例
docs/                          当前有效文档
scripts/                       回归、发布、生成脚本
releases/                      本地发布产物与元数据
```

---

## 5. 工程门禁与常用命令

### 开发

```bash
npm install
npm run dev
npm run tauri:dev
```

### 校验

```bash
npm run lint
npm run typecheck
npm run test:docs
npm run test:browser-regression
npm run test:run
npm run qa:gate
```

### 发布准备

```bash
npm run clean
npm run release:prepare
npm run release:prepare -- --dry-run
npm run release:prepare -- --skip-qa
```

---

## 6. 仓库整洁约定

### 必须清理的产物

- `.next/`
- `out/`
- `output/`
- `web-dist/`
- `.playwright-cli/`
- `*.tsbuildinfo`

### 不要重新引入的旧资料

- 历史修复总结文档
- 过时的阶段性 refactor 纪要
- 已被统一脚本取代的临时脚本

### 可以保留的发布与测试资源

- `releases/`：发布事实来源，不是垃圾目录
- `public/test-*.md`、`public/test-*.ipynb`：诊断与性能样例
- `docs/tests/`：人工测试资料库

---

## 7. 文档维护规则

当以下内容变化时，必须同步更新文档：

- 产品主链路变化：更新 `README.md`、`docs/USER_GUIDE.md`
- 桌面能力变化：更新 `docs/DESKTOP_FEATURES.md`、`docs/guides/desktop-app.md`
- 架构/数据流变化：更新 `docs/ARCHITECTURE.md`
- 发布/部署流程变化：更新 `docs/MANUAL_RELEASE_GUIDE.md`、`docs/guides/github-deploy.md`
- 阶段性成果变化：更新 `docs/RELEASE_NOTES.md`、`docs/roadmap.md`

---

## 8. 当前优先方向

1. 继续深化本地优先科研工作流，而不是重新堆积孤立功能
2. 继续收口 AI 知识组织和证据浏览，而不是创建分裂入口
3. 继续保持可发布、可验证、可回归，而不是依赖隐式手工流程

---

**状态**: 活跃维护中  
**当前版本基线**: `v2.0.0`
