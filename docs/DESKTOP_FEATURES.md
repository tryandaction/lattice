# Lattice 桌面应用功能指南

## 🎯 桌面应用独有功能

### 1. 默认文件夹设置

桌面应用支持设置默认工作文件夹，启动时自动打开该文件夹。

#### 如何设置

**方式一：使用设置按钮**
1. 点击右下角的蓝色设置按钮（⚙️）
2. 点击"选择文件夹"按钮
3. 选择你想要设置为默认的文件夹
4. 点击"保存"按钮

**方式二：使用快捷键**
- 按 `Ctrl+,`（Windows/Linux）或 `Cmd+,`（macOS）打开设置
- 按照上述步骤设置

#### 功能说明

- **默认文件夹**：应用启动时自动打开的文件夹
- **上次打开的文件夹**：自动记录你最后一次打开的文件夹
- **清除设置**：点击垃圾桶图标可以清除默认文件夹设置

### 2. 自动记住工作目录

应用会自动记住你上次打开的文件夹，下次启动时可以快速恢复工作状态。

### 3. 更好的文件系统访问

桌面应用拥有完整的文件系统访问权限，无需每次都授权。

## 🌐 网页版 vs 桌面版

| 特性 | 网页版 | 桌面版 |
|------|--------|--------|
| 启动速度 | 较慢（需要加载浏览器） | 快速（原生应用） |
| 体积大小 | 无需下载 | ~6-8 MB |
| 文件访问 | 需要每次授权 | 完整权限 |
| 默认文件夹 | ❌ | ✅ |
| 记住工作目录 | ❌ | ✅ |
| 离线使用 | 有限支持 | 完全支持 |
| 内存占用 | 较高（浏览器开销） | 较低（原生应用） |

## 💡 使用技巧

### 快捷键

- `Ctrl+B` / `Cmd+B`：切换侧边栏
- `Ctrl+,` / `Cmd+,`：打开设置（仅桌面版）

### 首次使用建议

1. **设置默认文件夹**：将你的常用工作目录设置为默认文件夹
2. **创建快捷方式**：将应用固定到任务栏或 Dock，方便快速启动
3. **关闭浏览器**：使用桌面应用后可以关闭浏览器，节省系统资源

## 🔧 技术实现

### 数据存储

桌面应用使用 `tauri-plugin-store` 插件来持久化用户设置：

- **存储位置**：
  - Windows: `%APPDATA%\com.lattice.editor\settings.json`
  - macOS: `~/Library/Application Support/com.lattice.editor/settings.json`
  - Linux: `~/.config/com.lattice.editor/settings.json`

- **存储内容**：
  ```json
  {
    "default_folder": "/path/to/your/folder",
    "last_opened_folder": "/path/to/last/folder"
  }
  ```

### API 接口

桌面应用提供以下 Tauri 命令：

- `get_default_folder()`: 获取默认文件夹
- `set_default_folder(folder: string)`: 设置默认文件夹
- `get_last_opened_folder()`: 获取上次打开的文件夹
- `set_last_opened_folder(folder: string)`: 保存上次打开的文件夹
- `clear_default_folder()`: 清除默认文件夹设置

## 🚀 下载与安装

### Windows

推荐使用 NSIS 安装包（更现代的安装体验）：

```bash
# 下载并运行
Lattice_0.1.0_x64-setup.exe
```

或使用 MSI 安装包（适合企业部署）：

```bash
# 下载并运行
Lattice_0.1.0_x64_en-US.msi
```

### macOS

```bash
# 下载 DMG 镜像
Lattice_0.1.0_x64.dmg

# 拖拽到 Applications 文件夹
```

### Linux

**AppImage（推荐）**：

```bash
# 下载并添加执行权限
chmod +x lattice_0.1.0_amd64.AppImage

# 运行
./lattice_0.1.0_amd64.AppImage
```

**DEB 包**：

```bash
# 安装
sudo dpkg -i lattice_0.1.0_amd64.deb

# 运行
lattice
```

## 📝 常见问题

### Q: 如何更改默认文件夹？

A: 打开设置（Ctrl+,），选择新的文件夹并保存即可。

### Q: 默认文件夹和上次打开的文件夹有什么区别？

A: 
- **默认文件夹**：你手动设置的固定文件夹，每次启动都会打开
- **上次打开的文件夹**：应用自动记录的最后一次打开的文件夹

如果设置了默认文件夹，启动时会优先打开默认文件夹。

### Q: 如何重置所有设置？

A: 删除设置文件即可：
- Windows: `%APPDATA%\com.lattice.editor\settings.json`
- macOS: `~/Library/Application Support/com.lattice.editor/settings.json`
- Linux: `~/.config/com.lattice.editor/settings.json`

### Q: 桌面应用和网页版可以同时使用吗？

A: 可以，它们是独立的。但建议使用桌面应用以获得更好的体验。

## 🔄 更新日志

### v0.1.0 (2026-01-04)

- ✅ 添加默认文件夹设置功能
- ✅ 自动记住上次打开的文件夹
- ✅ 添加设置界面（Ctrl+,）
- ✅ 网页版添加下载应用提醒
- ✅ 优化 README 下载链接展示

## 🎨 界面预览

### 设置界面

设置界面提供以下功能：
- 查看当前默认文件夹
- 设置新的默认文件夹
- 查看上次打开的文件夹
- 清除默认文件夹设置

### 下载提醒（网页版）

首次访问网页版时，会显示下载桌面应用的提醒，说明桌面应用的优势：
- 启动更快，体积更小
- 记住工作目录
- 原生窗口体验

用户可以选择"不再显示"来关闭提醒。

## 🤝 反馈与建议

如果你有任何问题或建议，欢迎：
- 提交 GitHub Issue
- 发送邮件反馈
- 参与社区讨论

---

**享受更高效的编辑体验！** 🚀
