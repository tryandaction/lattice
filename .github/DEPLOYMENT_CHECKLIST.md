# Lattice 部署检查清单

## 📋 发布前检查

### 1. 代码质量

- [ ] 所有 TypeScript 错误已修复
- [ ] 所有 Rust 警告已处理
- [ ] 代码格式化完成
- [ ] 无 console.log 调试代码
- [ ] 无 TODO 注释（或已记录到 TODO.md）

**检查命令**：
```bash
# TypeScript 检查
npm run lint

# Rust 检查
cd src-tauri
cargo clippy
cargo fmt --check
cd ..
```

### 2. 功能测试

- [ ] 网页版下载提醒正常显示
- [ ] 桌面应用设置界面正常工作
- [ ] 默认文件夹设置功能正常
- [ ] 自动记忆功能正常
- [ ] 所有快捷键正常工作
- [ ] 文件操作正常（打开、保存、编辑）

**参考**：`scripts/test-features.md`

### 3. 构建测试

- [ ] 网页版构建成功
- [ ] 桌面应用构建成功（所有平台）
- [ ] 构建产物大小合理
- [ ] 构建产物可以正常运行

**构建命令**：
```bash
# 网页版
npm run build

# 桌面应用
npm run tauri:build
```

### 4. 文档检查

- [ ] README.md 更新完整
- [ ] CHANGELOG.md 记录所有变更
- [ ] 所有文档链接有效
- [ ] 下载链接指向正确的 Release
- [ ] 版本号一致（package.json, tauri.conf.json, 文档）

**检查文档**：
- [ ] README.md
- [ ] CHANGELOG.md
- [ ] INSTALLATION.md
- [ ] QUICK_START.md
- [ ] docs/DESKTOP_FEATURES.md
- [ ] DESKTOP_APP.md

### 5. 版本号检查

- [ ] `package.json` 版本号正确
- [ ] `src-tauri/tauri.conf.json` 版本号正确
- [ ] `CHANGELOG.md` 版本号正确
- [ ] `.github/RELEASE_TEMPLATE.md` 版本号正确
- [ ] 所有文档中的版本号一致

**当前版本**：v0.1.0

### 6. 依赖检查

- [ ] 所有依赖已安装
- [ ] 无安全漏洞
- [ ] 依赖版本合理

**检查命令**：
```bash
npm audit
npm outdated
```

### 7. 性能检查

- [ ] 网页版首次加载时间 < 3 秒
- [ ] 桌面应用启动时间 < 2 秒
- [ ] 内存占用合理（< 200 MB）
- [ ] 无内存泄漏

### 8. 兼容性检查

**浏览器（网页版）**：
- [ ] Chrome/Edge 最新版
- [ ] Firefox 最新版
- [ ] Safari 最新版（macOS）

**操作系统（桌面应用）**：
- [ ] Windows 10/11
- [ ] macOS 12+
- [ ] Ubuntu 22.04+

### 9. 安全检查

- [ ] 无硬编码的敏感信息
- [ ] 无 API 密钥泄露
- [ ] 文件权限设置合理
- [ ] 依赖无已知漏洞

### 10. 发布准备

- [ ] Git 仓库状态干净（无未提交的更改）
- [ ] 所有更改已推送到远程仓库
- [ ] 创建了版本标签
- [ ] 发布说明准备完成

---

## 🚀 发布流程

### 方式 1：手动发布

#### 步骤 1：准备发布

```bash
# Linux/macOS
./scripts/prepare-release.sh

# Windows
scripts\prepare-release.bat
```

**检查**：
- [ ] 版本号更新成功
- [ ] 依赖安装成功
- [ ] 测试通过
- [ ] 构建成功
- [ ] Git 标签创建成功

#### 步骤 2：推送代码

```bash
git push origin main --tags
```

**检查**：
- [ ] 代码推送成功
- [ ] 标签推送成功

#### 步骤 3：创建 GitHub Release

1. 访问：https://github.com/tryandaction/lattice/releases/new
2. 选择标签：v0.1.0
3. 填写发布标题：Lattice v0.1.0
4. 复制 `.github/RELEASE_TEMPLATE.md` 内容
5. 上传构建产物：
   - [ ] Windows NSIS 安装包
   - [ ] Windows MSI 安装包
   - [ ] macOS DMG 镜像
   - [ ] Linux AppImage
   - [ ] Linux DEB 包
6. 发布 Release

**检查**：
- [ ] Release 创建成功
- [ ] 所有构建产物上传成功
- [ ] 下载链接有效
- [ ] 发布说明完整

#### 步骤 4：更新 README 链接

如果是首次发布，需要更新 README 中的下载链接：

```markdown
将 tryandaction 替换为实际的 GitHub 用户名
```

**检查**：
- [ ] 下载链接更新
- [ ] 链接测试通过

### 方式 2：自动发布（GitHub Actions）

#### 步骤 1：推送标签

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

#### 步骤 2：等待 GitHub Actions

访问：https://github.com/tryandaction/lattice/actions

**检查**：
- [ ] 工作流触发成功
- [ ] Windows 构建成功
- [ ] macOS 构建成功
- [ ] Linux 构建成功
- [ ] 构建产物上传成功

#### 步骤 3：审核并发布 Draft Release

1. 访问：https://github.com/tryandaction/lattice/releases
2. 找到 Draft Release
3. 审核发布说明
4. 审核构建产物
5. 点击"Publish release"

**检查**：
- [ ] Draft Release 存在
- [ ] 发布说明完整
- [ ] 构建产物完整
- [ ] 发布成功

---

## 📢 发布后任务

### 1. 验证发布

- [ ] 下载链接有效
- [ ] 安装包可以正常下载
- [ ] 安装包可以正常安装
- [ ] 应用可以正常运行

### 2. 更新文档

- [ ] 更新官方网站（如果有）
- [ ] 更新社交媒体
- [ ] 发布更新公告

### 3. 通知用户

- [ ] GitHub Discussions 发布公告
- [ ] 社交媒体发布
- [ ] 邮件通知（如果有邮件列表）

### 4. 监控反馈

- [ ] 监控 GitHub Issues
- [ ] 监控社交媒体反馈
- [ ] 收集用户反馈

### 5. 准备下一版本

- [ ] 创建下一版本的 Milestone
- [ ] 规划下一版本的功能
- [ ] 更新 TODO.md

---

## 🐛 回滚流程

如果发现严重问题需要回滚：

### 1. 删除 Release

1. 访问：https://github.com/tryandaction/lattice/releases
2. 找到问题版本
3. 点击"Delete"

### 2. 删除标签

```bash
# 删除本地标签
git tag -d v0.1.0

# 删除远程标签
git push origin :refs/tags/v0.1.0
```

### 3. 修复问题

1. 修复代码
2. 重新测试
3. 重新发布

### 4. 通知用户

- [ ] 发布回滚公告
- [ ] 说明问题原因
- [ ] 提供解决方案

---

## 📊 发布统计

### 发布信息

- **版本号**：v0.1.0
- **发布日期**：2026-01-04
- **发布方式**：手动 / 自动
- **发布人**：

### 构建产物

| 平台 | 文件名 | 大小 | 下载次数 |
|------|--------|------|---------|
| Windows NSIS | Lattice_0.1.0_x64-setup.exe | ~6 MB | - |
| Windows MSI | Lattice_0.1.0_x64_en-US.msi | ~7 MB | - |
| macOS DMG | Lattice_0.1.0_x64.dmg | ~8 MB | - |
| Linux AppImage | lattice_0.1.0_amd64.AppImage | ~7 MB | - |
| Linux DEB | lattice_0.1.0_amd64.deb | ~7 MB | - |

### 问题跟踪

- **已知问题**：0
- **已修复问题**：0
- **待修复问题**：0

---

## 📝 发布报告模板

```markdown
# Lattice v0.1.0 发布报告

## 发布信息
- 版本：v0.1.0
- 日期：2026-01-04
- 发布人：[Your Name]
- 发布方式：手动/自动

## 检查清单
- ✅ 代码质量检查通过
- ✅ 功能测试通过
- ✅ 构建测试通过
- ✅ 文档检查通过
- ✅ 版本号检查通过
- ✅ 依赖检查通过
- ✅ 性能检查通过
- ✅ 兼容性检查通过
- ✅ 安全检查通过
- ✅ 发布准备完成

## 构建结果
- ✅ Windows 构建成功
- ✅ macOS 构建成功
- ✅ Linux 构建成功

## 发布结果
- ✅ Release 创建成功
- ✅ 构建产物上传成功
- ✅ 下载链接有效

## 问题记录
无

## 用户反馈
待收集

## 下一步计划
- 监控用户反馈
- 修复发现的问题
- 规划 v0.2.0 功能

## 备注
发布顺利，无重大问题。
```

---

## 🎯 成功标准

发布被认为成功，当：

- ✅ 所有检查项通过
- ✅ 构建产物可以正常下载和安装
- ✅ 应用可以正常运行
- ✅ 无严重 Bug 报告
- ✅ 用户反馈积极

---

## 📞 紧急联系

如果发布过程中遇到问题：

1. 查看 [故障排除文档](../INSTALLATION.md#-故障排除)
2. 搜索 [GitHub Issues](https://github.com/tryandaction/lattice/issues)
3. 联系维护者：your-email@example.com

---

**祝发布顺利！** 🚀
