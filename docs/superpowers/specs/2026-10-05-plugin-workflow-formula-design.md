# 插件工作流与公式识别设计

插件中心以运行时真实健康状态为准，已安装与内置插件统一展示；启用操作先持久化目标，再由 `syncPlugins` 激活，激活异常回滚 enabled 状态并显示错误。停用和卸载都经过 runtime 清理，命令、面板、UI 扩展、资源 URL、设置监听器和 worker 不残留。

公式扫描结果必须带 source file、scope 和扫描时间。执行前捕获 active document identity，异步完成后若当前文档已变化则丢弃结果并提示重试。取消采用 AbortSignal；OCR 后端缺失、超时和取消显示可恢复错误，置信度来自后端证据，不能使用固定高分。
