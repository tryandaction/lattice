# Lattice 插件工作流与公式识别执行计划

## 任务板

- [in_progress] 调查并修复插件运行时生命周期、启用失败回滚与清理
- [pending] 提供可嵌入 settings-dialog 的 PluginsPanel
- [pending] 绑定公式结果到当前文档，修复 scope/取消/重试/OCR 状态
- [pending] 补充回归测试与独立浏览器验证
- [pending] 写入主窗口接入补丁、边界和验证证据

## 接口约定

`PluginsPanel` 是 client component，props 为：

- `onOpenGuide?: () => void`：打开开发者指南，缺省不显示入口。
- `onPluginsChanged?: () => void | Promise<void>`：启用、禁用、卸载或安装后通知宿主刷新设置外壳。

组件不要求宿主复制 runtime 状态；直接订阅 registry/health/audit，并读取 `useSettingsStore`。
