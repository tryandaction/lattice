# Lattice 发布闭环指引

本指南用于完成“网页端发布 + 桌面端打包”的闭环验证。  
所有步骤均在本仓库根目录执行。

## 1) 网页端（静态导出）
### 构建
```bash
npm run build
```
输出目录为 `out/`（由 Next.js `output: "export"` 生成）。

### 本地预览（任选其一）
```bash
npx serve out
```
或使用任意静态服务器指向 `out/`。

### 部署
将 `out/` 上传到任意静态托管（例如：Vercel/Netlify/GitHub Pages/CDN）。  
部署后即可访问网页端版本。

## 2) 桌面端（Tauri）
### 依赖准备
确保本机已安装 Rust + Tauri 相关依赖（Tauri 官方要求）。

### 打包
```bash
npm run tauri:build
```
完成后在 `src-tauri/target/release/bundle/` 下生成安装包。

## 3) 功能闭环验证（必须）
请按 `OPERATOR_GUIDE.md` 完整执行：
1. 插件系统：信任 + 启用 + 命令中心运行 `Say Hello`
2. AI 上下文：启用 AI → 打开文件 → 预览/复制/导出 JSON

## 4) 常见问题排查
### 网页端没有新功能
确认访问的是新部署版本，或本地 `out/` 目录已更新。

### 桌面端没有新功能
确认已重新执行 `npm run tauri:build` 并使用新生成的安装包。

---
如果你需要我继续做发布自动化（CI/CD、版本号、更新日志、自动打包），告诉我目标平台与发布流程，我会继续完善。
