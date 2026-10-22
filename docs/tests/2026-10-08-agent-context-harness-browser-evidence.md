# Agent Context / Harness 真实浏览器证据

日期2026-10-08；独立端口3539，dist `.lattice-build/agent-context-dev-20261008`。页面由主窗口接入，使用真实AI React组件、store、来源抽取/PDF manifest/Workbench写入路径；文件/provider/外部transport为明确的隔离fixture。真实推理、收费请求、凭据读取均0。

浏览器：Codex内置浏览器，URL `http://127.0.0.1:3539/diagnostics/agent-context-harness`。Chrome扩展认证不可用，因此使用可用内置浏览器；没有用jsdom结果代替浏览器交互。

| 操作 | 实际观察 |
| --- | --- |
| 创建两段历史→关闭面板→重开 | 当前conversation ID不变，正文是第二历史问题/第二回答，fence `x=2`保留。 |
| 粘贴50K中英/LaTeX/fence→关重开→reload | 草稿长度始终50000；fixture最终请求记录 `originalCharacters:50000, originalIncluded:true`，包装后的characters为50002或100271，未将preview当正文。planning请求可使用摘要，最终用户请求含完整原文。 |
| 嵌套目录14文件→发送 | DOM为“全部正文已分析·38/38页/节·14个文件·5批”；回答含4个真实来源、table、math、TS fence。 |
| 点击目录引用 | 实际activePath为 `notes/topic-3/same.md`，无临时citation导航。 |
| 复制Markdown→浏览器session clipboard读回 | 327字符；heading/table/`$$E=mc^2$$`/fence/stable source均true；temporary citation ID=false。 |
| 修改topic-0源→跟进 | 可见状态提示该源修改/删除/权限撤销失效；旧来源回答不发送模型，按当前授权版本重新读取。 |
| API PDF子文件 | 真实提取1/1页，出现“审阅并保存Markdown”；保存草稿目标`.lattice/items/paper.pdf/note.md`；Review批准后为已写回，回读内容含稳定PDF链接、table/math/fence。 |
| 树挂载 | `pdfChildren[0]={path:'.lattice/items/paper.pdf/note.md',parentPdfPath:'agent-fixture/paper.pdf'}`，activePath已打开该文件。 |
| 父PDF改名重开 | manifest保持`itemId:'paper.pdf',itemFolderPath:'.lattice/items/paper.pdf'`，pdfPath变`renamed.pdf`；同一note.md仍在virtualChildren中，parentPdfPath变`agent-fixture/renamed.pdf`。 |
| Harness PDF工具桥 | UI明确“隔离fixture，未运行真实Codex推理”；真实事件依次started、`lattice_sources_read`、`lattice_pdf_proposeChild`、file-change、completed，5项可见事件。 |
| Harness scratch→Review | 点击“读取完整草稿并进入审查”后raw draft含实际完整内容；正式写入前仍draft。用户点击批准后已写回；PDF和scratch分别进入自己的目标。 |
| 恢复事件 | `harness-execution-timeline.test.tsx`验证saved事件只读显示，不建立连接、不复活running；native/TS crash-resume验证对应进程恢复。 |
| 控制台 | 最终fixture交互`error/warn`日志为空。首次Next编译导航等待超时后页面正常加载，没有重复启动服务。 |

最终Harness写后回读：

```json
{
  "files": [
    {"path":".lattice/items/paper.pdf/harness-note.md","text":"# Harness 技能子文件\n\n原文已由 lattice.sources.read 实际读取。\n\n```py\nprint(2)\n```\n\n$$E=x^2$$"},
    {"path":"AI Drafts/fixture-output.md","text":"# 实际隔离 fixture 草稿\n\n$$E=x^2$$\n\n| 项 | 值 |\n|---|---|\n|x|1|"}
  ],
  "activePath":"agent-fixture/AI Drafts/fixture-output.md",
  "pdfChildren":[{"path":".lattice/items/paper.pdf/harness-note.md","parentPdfPath":"agent-fixture/paper.pdf"}],
  "drafts":[{"status":"applied","target":"agent-fixture/AI Drafts/fixture-output.md"},{"status":"applied","target":"agent-fixture/.lattice/items/paper.pdf/harness-note.md"}]
}
```

截图由真实浏览器capture在本对话输出，包含运行环境、动态工具名和Review入口。DOM与回读比单张截图更直接证明落盘/树归属。热更新会重建内存fixture，因此所有最终文件证据都在一次reload后连续操作采集；不把旧UI草稿指向新内存root当作回读成功。

这些观察证明确定性集成链路；不证明真实模型科研质量、真实Claude运行或实际安装桌面冷启动。安装/冷启动由主窗口产品验收处理。云窗口最初离线重开失败不属于此页fixture的通过结果；失败历史保留，主窗口随后同步云端最新 IndexedDB 原文/close-reopen/push 浏览器已通过。

最终可见性复验：Harness时间线整体有限高度滚动，scratch Review默认折叠；1280×720截图中Workbench审查区可见并滚动（body有效高度约124px），不会因展开事件把审查区挤成0。审批回复异常有可恢复提示。主窗口要求最后停止本窗口3539服务；dist与证据保留，不改其他服务。
