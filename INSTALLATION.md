# Lattice 安装与更新指南

## 🚀 快速开始

### 网页版（无需安装）

直接访问：**https://lattice-apq.pages.dev/**

### 桌面应用

#### Windows

1. 下载安装包：
   - [NSIS 安装包](https://github.com/YOUR_USERNAME/lattice/releases/latest/download/Lattice_0.1.0_x64-setup.exe)（推荐）
   - [MSI 安装包](https://github.com/YOUR_USERNAME/lattice/releases/latest/download/Lattice_0.1.0_x64_en-US.msi)

2. 双击运行安装程序

3. 按照向导完成安装

#### macOS

1. 下载 [DMG 镜像](https://github.com/YOUR_USERNAME/lattice/releases/latest/download/Lattice_0.1.0_x64.dmg)

2. 打开 DMG 文件

3. 将 Lattice 拖拽到 Applications 文件夹

4. 首次运行时，右键点击应用选择"打开"（绕过 Gatekeeper）

#### Linux

**AppImage（推荐）**：

```bash
# 下载
wget https://github.com/YOUR_USERNAME/lattice/releases/latest/download/lattice_0.1.0_amd64.AppImage

# 添加执行权限
chmod +x lattice_0.1.0_amd64.AppImage

# 运行
./lattice_0.1.0_amd64.AppImage
```

**DEB 包（Debian/Ubuntu）**：

```bash
# 下载
wget https://github.com/YOUR_USERNAME/lattice/releases/latest/download/lattice_0.1.0_amd64.deb

# 安装
sudo dpkg -i lattice_0.1.0_amd64.deb

# 运行
lattice
```

## 🔧 开发环境安装

### 前置要求

- Node.js 18+
- npm 或 yarn
- Rust 1.70+（仅桌面应用开发需要）

### 1. 克隆项目

```bash
git clone https://github.com/YOUR_USERNAME/lattice.git
cd lattice
```

### 2. 安装依赖

```bash
npm install
```

### 3. 运行开发服务器

**网页版**：

```bash
npm run dev
```

访问 http://localhost:3000

**桌面应用**：

```bash
npm run tauri:dev
```

### 4. 构建生产版本

**网页版**：

```bash
npm run build
npm run start
```

**桌面应用**：

```bash
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`

## 📦 更新依赖

### 更新到最新版本

如果你已经克隆了项目，需要更新依赖以支持新功能：

```bash
# 更新 npm 依赖
npm install

# 更新 Rust 依赖（如果开发桌面应用）
cd src-tauri
cargo update
cd ..
```

### 新增的依赖

**前端**：
- `@tauri-apps/plugin-store`: 桌面应用设置存储

**后端（Rust）**：
- `tauri-plugin-store`: 持久化用户设置

这些依赖已经在 `package.json` 和 `Cargo.toml` 中配置好了。

## 🔄 从旧版本升级

### 桌面应用用户

1. 下载最新版本的安装包
2. 运行安装程序（会自动覆盖旧版本）
3. 你的设置会自动保留

### 开发者

1. 拉取最新代码：
   ```bash
   git pull origin main
   ```

2. 更新依赖：
   ```bash
   npm install
   cd src-tauri
   cargo update
   cd ..
   ```

3. 重新构建：
   ```bash
   npm run tauri:build
   ```

## 🐛 故障排除

### 问题：Rust 未找到

**症状**：运行 `npm run tauri:dev` 时提示 `rustc: The term 'rustc' is not recognized`

**解决方案**：

1. 安装 Rust：访问 https://rustup.rs/
2. 重启终端
3. 验证安装：
   ```bash
   rustc --version
   cargo --version
   ```

### 问题：图标缺失

**症状**：构建时提示 `icons/icon.ico not found`

**解决方案**：

```bash
# 使用项目中的图标生成所有平台图标
npx @tauri-apps/cli icon app-icon.png
```

### 问题：端口被占用

**症状**：`npm run dev` 提示端口 3000 已被占用

**解决方案**：

```bash
# 方式1：使用其他端口
PORT=3001 npm run dev

# 方式2：杀死占用端口的进程
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# macOS/Linux
lsof -ti:3000 | xargs kill -9
```

### 问题：构建失败

**症状**：`npm run tauri:build` 失败

**解决方案**：

1. 清理缓存：
   ```bash
   cd src-tauri
   cargo clean
   cd ..
   rm -rf .next out
   ```

2. 重新构建：
   ```bash
   npm run tauri:build
   ```

### 问题：设置不生效

**症状**：桌面应用的默认文件夹设置不生效

**解决方案**：

1. 检查设置文件是否存在：
   - Windows: `%APPDATA%\com.lattice.editor\settings.json`
   - macOS: `~/Library/Application Support/com.lattice.editor/settings.json`
   - Linux: `~/.config/com.lattice.editor/settings.json`

2. 如果文件损坏，删除后重新设置

## 📚 相关文档

- [README.md](./README.md) - 项目概述
- [DESKTOP_APP.md](./DESKTOP_APP.md) - 桌面应用构建指南
- [docs/DESKTOP_FEATURES.md](./docs/DESKTOP_FEATURES.md) - 桌面功能详细说明
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - 技术架构

## 🤝 获取帮助

如果遇到问题：

1. 查看 [故障排除](#-故障排除) 部分
2. 搜索 [GitHub Issues](https://github.com/YOUR_USERNAME/lattice/issues)
3. 提交新的 Issue
4. 加入社区讨论

---

**祝你使用愉快！** 🎉
