# Lattice 桌面应用打包指南

## ✅ 构建状态

**最新构建**: 2026-01-04  
**状态**: ✅ 成功  
**版本**: 0.1.0  
**平台**: Windows x64

### 构建产物

构建成功生成了以下安装包：

1. **MSI 安装包**: `src-tauri/target/release/bundle/msi/Lattice_0.1.0_x64_en-US.msi`
   - 适用于企业部署和系统管理员
   - 支持静默安装
   - 文件大小: **6.73 MB**

2. **NSIS 安装包**: `src-tauri/target/release/bundle/nsis/Lattice_0.1.0_x64-setup.exe`
   - 适用于普通用户
   - 现代化安装向导
   - 文件大小: **5.71 MB**

3. **可执行文件**: `src-tauri/target/release/lattice.exe`
   - 绿色版，无需安装
   - 可直接运行
   - 文件大小: **13.52 MB**

## 前置要求

### Windows 系统

1. **安装 Rust**（Tauri 需要）：
   - 访问 https://rustup.rs/
   - 下载 `rustup-init.exe` 并运行
   - 安装完成后，**必须重启终端**或手动添加到 PATH：
     ```powershell
     $env:Path += ";$env:USERPROFILE\.cargo\bin"
     ```
   - 验证安装：
     ```bash
     rustc --version
     cargo --version
     ```

2. **安装 Tauri CLI**：
```bash
npm install --save-dev @tauri-apps/cli
```

3. **安装项目依赖**：
```bash
npm install
```

## 开发模式

运行桌面应用开发版本：

```bash
npm run tauri:dev
```

这会同时启动 Next.js 开发服务器和 Tauri 窗口。

## 快速测试

如果已经构建完成，可以直接运行：

**Windows**:
```bash
# 方式1: 直接运行可执行文件
src-tauri\target\release\lattice.exe

# 方式2: 使用快捷脚本
run-desktop-app.bat
```

**macOS**:
```bash
open src-tauri/target/release/bundle/macos/Lattice.app
```

**Linux**:
```bash
./src-tauri/target/release/lattice
```

## 构建桌面应用

### 首次构建

1. **生成应用图标**（如果还没有）：
```bash
# 创建一个 1024x1024 的 PNG 图标
npx @tauri-apps/cli icon app-icon.png
```

2. **构建生产版本**：
```bash
npm run tauri build
```

构建过程包括：
- 编译 Next.js 静态站点（`npm run build`）
- 编译 Rust 后端
- 生成安装包（MSI 和 NSIS）

### 构建产物位置

构建完成后，文件位于：

**Windows**:
- 可执行文件: `src-tauri/target/release/lattice.exe`
- MSI 安装包: `src-tauri/target/release/bundle/msi/Lattice_0.1.0_x64_en-US.msi`
- NSIS 安装包: `src-tauri/target/release/bundle/nsis/Lattice_0.1.0_x64-setup.exe`

**macOS**:
- 应用包: `src-tauri/target/release/bundle/macos/Lattice.app`
- DMG 镜像: `src-tauri/target/release/bundle/dmg/Lattice_0.1.0_x64.dmg`

**Linux**:
- 可执行文件: `src-tauri/target/release/lattice`
- AppImage: `src-tauri/target/release/bundle/appimage/lattice_0.1.0_amd64.AppImage`
- DEB 包: `src-tauri/target/release/bundle/deb/lattice_0.1.0_amd64.deb`

### 构建时间

- 首次构建: ~3-5 分钟（需要下载和编译 Rust 依赖）
- 后续构建: ~1-2 分钟（增量编译）

## 功能特性

✅ 零成本打包成桌面应用  
✅ 双击即可启动，无需浏览器  
✅ 原生窗口体验  
✅ 体积小（相比 Electron 小 10 倍以上）  
✅ 支持 MSI 和 NSIS 两种安装方式  
✅ 绿色版可执行文件，无需安装  
✅ 启动速度快，内存占用低  
✅ **默认文件夹设置**：记住常用工作目录  
✅ **自动记忆**：记住上次打开的文件夹  
✅ **系统设置**：可视化设置界面（Ctrl+,）  

详细功能说明请参考 [桌面功能指南](../docs/DESKTOP_FEATURES.md)  

## 已知问题

1. ✅ ~~配置警告：Bundle identifier `com.lattice.app` 以 `.app` 结尾~~
   - **已解决**: 已改为 `com.lattice.editor`

2. ⚠️ Rust 代码警告：未使用的导入和变量
   - 不影响功能，可运行 `cargo fix` 自动修复

## 故障排除

### Rust 未找到

如果遇到 `rustc: The term 'rustc' is not recognized` 错误：

```powershell
# 临时添加到 PATH（当前会话）
$env:Path += ";$env:USERPROFILE\.cargo\bin"

# 或者重启终端
```

### 图标缺失

如果遇到 `icons/icon.ico not found` 错误：

```bash
# 使用任意 1024x1024 PNG 图标生成所有平台图标
npx @tauri-apps/cli icon your-icon.png
```

### 构建失败

1. 确保 Rust 版本 >= 1.70
2. 确保 Node.js 版本 >= 18
3. 清理缓存重新构建：
```bash
cd src-tauri
cargo clean
cd ..
npm run tauri build
```

## 下一步优化

### 1. ✅ 修复配置警告

已完成：identifier 已改为 `com.lattice.editor`

### 2. ✅ 记住上次打开的文件夹

已实现：使用 `tauri-plugin-store` 保存用户偏好

**功能包括**：
- 设置默认文件夹
- 自动记住上次打开的文件夹
- 可视化设置界面（Ctrl+,）
- 清除默认文件夹设置

详见 [桌面功能指南](../docs/DESKTOP_FEATURES.md)

### 3. 添加系统托盘图标

让应用可以最小化到系统托盘。

### 4. 自定义应用图标

替换当前的占位符图标：

```bash
# 使用你的自定义图标（1024x1024 PNG）
npx @tauri-apps/cli icon path/to/your-icon.png
```

### 5. 代码签名（可选）

为了避免 Windows SmartScreen 警告，可以购买代码签名证书。

### 6. 自动更新

集成 Tauri 的自动更新功能，让用户无需手动下载新版本。

## 替代方案

如果不想安装 Rust，也可以使用：

1. **Electron** - 更成熟但体积大
2. **PWA** - 浏览器原生支持，但功能受限
3. **Neutralinojs** - 轻量但生态较小

推荐使用 Tauri，一次配置，长期受益！
