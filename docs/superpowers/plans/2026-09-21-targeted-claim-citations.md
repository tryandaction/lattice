# 针对性引文与跨文件精确定位

设计纠正：上下文材料不是回答引用。默认不展示自动生成的页面来源列表；只有回答实际论断旁的引用可作为证据入口。PDF/MD 必须有可在已供应原文中核验的具体片段，点击切换真实文件并对原文显示局部红色虚线框。没有精确依据不猜测、不随意框首句。上下文材料仅在用户主动查看详情时展示。

| 任务 | 状态 |
| --- | --- |
| 复现上下文堆砌与页级链接无片段问题 | completed |
| 精确引用协议、简洁UI、Markdown跨行范围与真实跨文件导航 | completed |
| 上游page/file-only材料到句后引文与红框的完整验收 | completed |
| 质量门禁、隔离桌面验收、本地修复包更新 | completed |

契约：支持 `citation:id?quote=URL_ENCODED_EXACT_QUOTE`，必须是对应材料中唯一出现的短连续原文且保留大小写；PDF构建page+snippet，Markdown构建workspace_text。原始无quote页/文件不能充当精准链接。有现成精确锚点才可直接引用token。保留多页/多文件上下文预算与透明截断信息。

验收不再预填精准snippet冒充模型选择：真实PDF/MD材料构建仅页/文件上下文，模型格式输出少量实际引用，真实PaneWrapper切换PDF A→PDF B→MD→PDF A，逐一验证文件身份、DOM原文、局部框范围、实际红色虚线样式，页面上下文不堆砌。

保留既有改动，不提交、不远程部署。工具未提供update_plan，使用本文件维护单一进行中任务。

实现与实际复现：删除自动来源行；Chat/Agent共用针对性quote协议；PDF/MD严格完整、唯一、大小写敏感原文定位，取消PDF四词模糊成功回退。Markdown按原始字符到DOM Range逐行框选，支持阅读态。引用v2身份保留完整原文、大小写与路径大小写，旧ID仅唯一时兼容；裸文件/页码不得借用第一条上下文引文。

真实PaneWrapper验收暴露并修复：保存PDF阅读状态创建空字符串缓存，MD返跳PDF被当文本；旧MD卸载回调可能污染当前tab；旧缓存恢复覆盖显式引用；更关键的是延迟原文模型触发effect重执行后的整页预定位覆盖精确滚动。对应失败回归逐项留存，未用renderer兜底或放宽断言掩盖。

最终开发态验收：synthetic与用户Huie PDF均完整通过 PDF A p2→p8→PDF B p2→MD具体原文→返回PDF A，12上下文仅4针对性内联引用、零自动footer，实际文件身份、canvas像素、逐行DOM文字和局部红虚线、overflow祖先裁剪均正确，pageerror为空。证据 `output/v3-validation/evidence/targeted-{citations,huie}-final/report.json`。模型文本为确定性模拟输出，不宣称已测试真实供应商；Huie原件只读、仅本地复制，未外发。

最终聚焦9文件121测试通过；另PDF导航8、精确范围/PDF文本22、Chat/Agent入口47均有独立通过证据。源码冻结进入整套门禁；新桌面和最终安装包仍待验证。

2026-09-27 联合Agent修复完成：最终门禁387文件/2999测试全过，生产网页和新桌面真跨文件及关键词/800px句框验收均通过。MSI/NSIS解包运行通过，版本与SHA256校验完成后正式更新本地v3.0.0；未覆盖用户安装版。详细收尾与范围见 `2026-09-21-agent-effective-workflows.md` 和发布目录 `EFFECTIVE_WORKFLOWS_QA.md`。
