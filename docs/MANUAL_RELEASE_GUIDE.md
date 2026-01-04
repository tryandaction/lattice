# 手动发布指南 (无需 GitHub Actions)

由于 GitHub Actions 可能因账户问题不可用，本指南介绍如何在本地构建并手动发布 Lattice。

## 为什么 GitHub Actions 不可用？

即使仓库是 public 的，以下情况会导致 Actions 被禁用：
- 账户有未解决的计费问题
- 账户被锁定
- 超出免费额度（public 仓库通常无限制，但账户问题会影响）

## 本地构建步骤

### 前置要求

1. **Node.js** >= 18
2. **Rust** >= 1.70 (从 https://rustup.rs/ 安装)
3. **Git**

### 方法一：使用脚本（推荐）

```batch
# Windows
scripts\local-build-release.bat
```

脚本会引导你完成：
- 版本更新
- 依赖安装
- 构建过程
- 文件整理

### 方法二：手动构建

```batch
# 1. 安装依赖
npm install

# 2. 构建 Next.js
npm run build

# 3. 构建 Tauri 桌面应用
npm run tauri build
```

构建产物位置：
- MSI: `src-tauri/target/release/bundle/msi/`
- NSIS: `src-tauri/target/release/bundle/nsis/`
- EXE: `src-tauri/target/release/`

## 发布到 GitHub

### 步骤 1: 创建 Git 标签

```batch
# 提交所有更改
git add -A
git commit -m "chore: release v0.1.0"

# 创建标签
git tag -a "v0.1.0" -m "Release v0.1.0"

# 推送到 GitHub
git push origin main --tags
```

### 步骤 2: 创建 GitHub Release

1. 访问 https://github.com/tryandaction/lattice/releases/new
2. 选择刚创建的标签 (如 `v0.1.0`)
3. 填写发布标题: `Lattice v0.1.0`
4. 复制 `.github/RELEASE_TEMPLATE.md` 内容作为发布说明
5. 上传构建产物：
   - `Lattice_0.1.0_x64_en-US.msi`
   - `Lattice_0.1.0_x64-setup.exe`
   - `lattice.exe` (可选，绿色版)
6. 点击 "Publish release"

### 步骤 3: 更新下载链接

发布后，更新 README.md 中的下载链接：

```markdown
| Windows | [MSI 安装包](https://github.com/tryandaction/lattice/releases/download/v0.1.0/Lattice_0.1.0_x64_en-US.msi) | 6.73 MB |
| Windows | [NSIS 安装包](https://github.com/tryandaction/lattice/releases/download/v0.1.0/Lattice_0.1.0_x64-setup.exe) | 5.71 MB |
```

## 跨平台构建

### 只有 Windows 电脑？

目前只能构建 Windows 版本。如果需要 macOS/Linux 版本：

1. **找朋友帮忙**：让有 Mac/Linux 的朋友运行构建
2. **使用云服务**：
   - [Gitpod](https://gitpod.io) - 免费 Linux 环境
   - [GitHub Codespaces](https://github.com/codespaces) - 需要账户正常
3. **虚拟机**：在 VirtualBox 中安装 Ubuntu

### Linux 构建 (在 Ubuntu 上)

```bash
# 安装依赖
sudo apt-get update
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf

# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 构建
npm install
npm run tauri build
```

### macOS 构建

```bash
# 安装 Xcode Command Line Tools
xcode-select --install

# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 构建
npm install
npm run tauri build
```

## 替代发布平台

如果 GitHub Release 也有问题，可以考虑：

1. **网盘分享**：
   - 百度网盘
   - 阿里云盘
   - 蓝奏云（小文件免费）

2. **国内代码托管**：
   - [Gitee](https://gitee.com) - 支持 Release
   - [Coding](https://coding.net)

3. **自建服务器**：
   - 上传到自己的服务器
   - 使用 Cloudflare Pages

## 常见问题

### Q: 构建失败怎么办？

```batch
# 清理缓存重试
rmdir /s /q src-tauri\target
rmdir /s /q .next
rmdir /s /q out
npm run tauri build
```

### Q: Rust 命令找不到？

```batch
# 添加到 PATH
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

# 或重启终端
```

### Q: 构建很慢？

首次构建需要下载和编译 ~500 个 Rust 依赖，约 3-5 分钟。后续增量构建会快很多。

### Q: 如何减小安装包体积？

当前已经很小了（~6MB），Tauri 比 Electron 小 10 倍以上。

## 发布检查清单

- [ ] 版本号已更新 (package.json, tauri.conf.json)
- [ ] CHANGELOG.md 已更新
- [ ] 本地构建成功
- [ ] 安装包可以正常安装和运行
- [ ] Git 标签已创建并推送
- [ ] GitHub Release 已创建
- [ ] 下载链接已测试

## 联系方式

如果遇到问题，可以：
- 在 GitHub Issues 中提问
- 查看 [故障排除文档](../INSTALLATION.md#-故障排除)
