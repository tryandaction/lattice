# Lattice 云端小组文件夹库交接

> 2026-10-08；本窗口代码冻结后供主窗口整合审查。未部署云服务、未执行生产迁移、未打包安装、未改版本 3.1.0、未提交或创建分支。

## 实现与根因

原页面绑定 local_only；远程内容 Store 的普通 put 被拒绝；旧 sync/push 只记日志；版本提交缺 CAS；PDF 绕过主要高亮阅读器；动态静态路径与身份/调度未接线。

现在 `/library` 和可嵌入主工作区的 CloudLibraryWorkspace 使用真实公开连接配置、Supabase Auth REST、持久会话、账号/租户隔离 IndexedDB、操作日志、Worker/R2 上传及 Postgres/RLS。未配置时明确 local_only，可打开原本机库。读写统一经 Controller/Provider；云路径不交本地文件系统。

- 稳定 UUID 目录/文件/研究子文件、面包屑、多标签与分栏。移动改名不改变 child ID。中文/空格目录选择器实测；目录拖入递归只读浏览器提供的 entry capability，拒绝越界。
- Markdown/代码沿发布编辑器；PDF沿 PDFHighlighterAdapter/sharedDocument，保留批注/公式数据与实际源版本。DOCX/PPTX、Notebook、图片沿现有 viewer；不能预览/不可解码格式保留原 bytes 下载，不承诺所有格式均可编辑。
- 本地内容与上传计划在同一 IndexedDB 事务后报告保存。revision CAS 防同账号多窗口覆盖；网络失败保留操作。分片 checkpoint、暂停/恢复、会话创建幂等、完成后注册失败恢复、hash校验与内容去重。
- item版本与annotation revision采用数据库锁/CAS；旧内容编辑不会借新metadata推进base；冲突保留本地操作与远端版本，提供显式本地/远端/副本。批注转换保留归一化坐标、quote、作者、时间和formula。
- viewer/commenter/editor/admin/owner由API/RLS执行。成员降级/暂停/撤销、邀请生成/接受/过期/撤销与幂等接受真实接线。邀请只生成链接，不自动发邮件；DB仅存随机token的SHA256。
- 撤销后下一次在线访问/同步隔离缓存。离线租约最长24小时，无法即时知道远端撤销；已下载系统副本无法遥控删除。跨页切账号关闭旧Provider；延迟refresh不会覆盖后来的登录。
- 受保护库额度查询、原子上传预留（默认10GiB，可由库settings.maxStorageBytes配置）、单文件限额、上传前数量/bytes/剩余额度提示。无后台OCR或收费embedding。
- 增量 changes cursor 按200条分页，投影/cursor同事务保存。文本索引使用当前版本真实文本；搜索是snippet/locator，binary未抽取不能冒充全文。旧index job过期不会卡住已提交版本。

## 主工作区与 AI 接口

入口 `src/components/shared-library/cloud-library-workspace.tsx`：

```ts
interface CloudLibraryWorkspaceProps {
  active?: boolean; // 默认true，Activity隐藏时暂停viewer effects，保留tab/draft
  initialLibraryId?: string;
  initialItemId?: string;
  onProviderReady?: (provider: CloudLibrarySourceProvider | null) => void;
  onOpenResource?: (resource: CloudLibraryResource) => void; // 可选委托外部渲染
  onActiveResourceChange?: (resource: CloudLibraryResource | null) => void;
}
```

主窗口已接主工作区surface、cloud-workspace-host registry和导航。组件保持个人workspace store不变。provider变更先清resource再通知当前资源；退出/账号变化清provider/resource。active=false不允许隐藏阅读器接管个人快捷键。

`src/lib/shared-library/source-provider.ts`：

```ts
interface CloudLibraryResource {
  id: string; // connectionId + endpoint + userId + libraryId + itemId
  libraryId: string; itemId: string; versionId?: string;
  name: string; kind: ItemKind; path: string; role: LibraryRole;
  content: SharedLibraryItemContent | null;
}
interface CloudLibrarySourceProvider {
  readonly scope?: string; // 实际实例始终给JSON[connectionId,apiUrl,supabaseUrl,userId]
  list(libraryId: string, parentItemId?: string, signal?: AbortSignal): Promise<Item[]>;
  read(libraryId: string, itemId: string, signal?: AbortSignal): Promise<CloudLibraryResource>;
  search(libraryId: string, query: string, signal?: AbortSignal): Promise<SharedLibrarySearchResponse>;
  save(libraryId: string, itemId: string, content: SharedLibraryItemContent, signal?: AbortSignal, expectedVersionId?: string): Promise<void>;
  createChild?(libraryId: string, parentItemId: string, input: {
    name: string; kind: ItemKind; content: SharedLibraryItemContent; expectedParentVersion: string;
  }, signal?: AbortSignal): Promise<Item>;
}
```

真实Provider每次读取验证角色，正文/version来自同一次源读取；缓存命中仍更新metadata。AI提交应传所读版本；createChild在客户端与数据库检查父stable ID/version、角色、同名与跨库边界。

主窗口 `registerCloudWorkspaceNavigator` / `openCloudWorkspaceResource` 接 `CloudWorkspaceOpenRequest { libraryId,itemId,anchor?:{page,line,cellId,snippet} }`。云组件将目标写入既有 useLinkNavigationStore pending队列，避免0ms事件丢失。解析回归通过；实际精准定位回执仍由主窗口验证，不能以打开tab当作page/line/cell/snippet定位已完成。

PDF `CloudPdfDocument { identity,sourceVersion?,authorId,canAnnotate,annotations,onPersist }`；identity含阅读版本、只绘制同版本批注。onPersist捕获tab.versionId并拒绝旧坐标写入新版本。主窗口已让renderer/hook跳过本地binding/sidecar、接受无fileHandle/rootHandle的buffer。Native DPAPI secure命令和关闭flush仍由主窗口独占审查，无新增main State/commands。

静态链接使用可导出的 `/library?library=<ID>&item=<ID>`；任意动态path并非已导出页面。旧链接fallback及实际Tauri刷新由主窗口最终验收。

## 证据与测试层次

| 层次 | 实际执行 | Provider/限制 |
| --- | --- | --- |
| 归属单测 | 33文件 / 208用例通过 | 包含原契约及新恢复/权限测试 |
| HTTP + SQL | Node HTTP运行真实Worker handler；PGlite执行四份migration、authenticated角色与RLS | Auth issuer、PostgREST HTTP适配器和R2 binding是隔离fixture；不是已部署Supabase/R2 |
| 浏览器 | 真实Chromium/Playwright，双独立context，真实Next UI及HTTP | Browser skill/runtime未提供，使用既有Playwright；不等价Tauri |
| 类型/文档/lint | 全局typecheck exit0；docs exit0；归属ESLint exit0，0 errors/非阻断warnings | 全量qa:gate/build/Tauri由主窗口独占执行 |

协议证据覆盖：登录/refresh/重开/退出；嵌套文件与unknown bytes/hash；邀请hash/过期/撤销/接受幂等；B编辑A拉取；离线Controller重开；双Controller队列CAS；内容冲突；viewer越权与撤销下载/搜索；annotation本人降级后direct PATCH无数据变化；共同评论/annotation CAS；父改名child ID；6MiB第二片失败恢复且不重复上传第一片；暂停；R2完成后注册失败重试；额度预留与绕过拒绝。

最新浏览器门禁覆盖：公开连接表单、A/B登录、建库/目录/MD真实编辑器；生成两页PDF真实正文、鼠标选择黄色高亮、B读取同一高亮；未知文件下载原bytes；中文/空格多层目录导入；邀请生成/撤销/加入；viewer降级隐藏保存入口、暂停后缓存隔离；离线编辑写IndexedDB、关闭页面、重开恢复推送且服务端索引含原文；query深链接重开；lattice/folio/breeze三主题、窄窗与退出。

证据目录 `.lattice-build/cloud-team-evidence-20261008`：

- browser-report.json（最新成功报告，errors为空，含pdf/offline/membership/directoryPicker字段）
- cloud-pdf-reading.png、cloud-pdf-highlight.png、cloud-pdf-profile-b.png
- cloud-offline-persisted.png、cloud-lattice.png、cloud-folio.png、cloud-breeze.png、cloud-narrow.png
- unknown-downloaded.custom（已断言原bytes）；eslint-results.json
- focused-test-results.json（33文件/208用例）、browser-test-results.json（1场景/0失败）、typecheck.log、docs-check.log

过往失败诊断留在忽略目录，不是当前验收依据；此交接不引用旧失败JSON。

## 执行门禁

默认Vitest不发现 `.scenario.ts`，因此不会因开发端口停止而阻断普通单测。专用浏览器场景是独立必跑门禁：缺URL/服务/测试运行时会失败，没有静默skip。

```powershell
# 新机器安装隔离测试运行时；主依赖/lock不变，约25MB，非系统服务/镜像
npm install --prefix ".lattice-build/cloud-team-test-runtime" --no-save --package-lock=false --ignore-scripts "@electric-sql/pglite@0.5.8"

# focused单测，无需dev端口
npx vitest run --maxWorkers=1 "src/lib/shared-library" "src/components/shared-library" "workers/shared-library-api/src/index.test.ts"

# 终端A，应用必须全程存活
$env:NEXT_DIST_DIR=".lattice-build/cloud-team-dev-20261008"
node "node_modules/next/dist/bin/next" dev --port 3538 --hostname "127.0.0.1"

# 终端B，fixture HTTP/Auth/RLS/R2由场景自行启动和关闭
$env:CLOUD_LIBRARY_BROWSER_BASE_URL="http://127.0.0.1:3538"
$env:CLOUD_LIBRARY_BROWSER_ENTRY="/library"
npx vitest run --config "workers/shared-library-api/test-support/vitest.browser.config.ts"

npm run typecheck
npm run test:docs
```

主窗口可对production静态产物服务设置其他base URL；直接静态文件用 `/library.html`。Native入口使用主窗口Desktop门禁。NEXT_DIST_DIR运行导致Next自动追加tsconfig include/next-env类型来源，主窗口统一整理；不得删除其他窗口dist。

## 归属改动

新增 connection/supabase-auth/cloud-persistence/cloud-workspace/source-provider/cloud-pdf/cloud-navigation/cloud-drop-import；扩展 annotation-adapter/api-transport/blob-store/search-client。

新增 CloudLibraryWorkspace、CloudConnectionPanel、CloudLibraryDiagnostics；复用 content-viewer并增加本机事务保存反馈；成员管理补角色降级/暂停/邀请撤销；library routes接真实入口。

Worker新增members/invitations、protected usage/changes、atomic version/annotation RPC、upload会话持久化/幂等/恢复/限额；追加 202610080001_cloud_team_library.sql。隔离 test-support 含HTTP/PGlite/R2 fixture和专用浏览器配置；无新生产依赖。

主窗口/AI归属文件未主动改写；主窗口后来对云组件注册导航的修改已保留。

## 部署与成本

默认复用 Supabase Auth/Postgres/RLS + Worker/R2。2026-10-08查询：[R2](https://developers.cloudflare.com/r2/pricing/)、[Supabase](https://supabase.com/pricing)、[Workers](https://developers.cloudflare.com/workers/platform/pricing/)。

R2 Standard免费10GB-month、1M Class A/10M Class B、egress免费；超额仍计费。Supabase Free数据库500MB、文件1GB/egress5GB、一周不活跃暂停；Pro从$25/月。Workers Free 100k请求/日、10ms CPU/次，Paid至少$5/月。选择现有组合减少重写与大文件下载流量；Supabase单栈Storage会重写现有R2协议，WebDAV/自托管需自建邀请/权限/冲突/备份运维。

部署者需真实Worker URL、Supabase URL/公开publishable或anon key、允许来源、R2 LIBRARY_BLOBS binding和按序应用四份migration。客户端不得有service-role/R2凭据。migration前检查active sibling同名记录，唯一索引不自动删除旧数据。

明确未执行：生产云部署/迁移/计费、真实Supabase Auth提供方验收、真实R2生命周期/病毒扫描/大文件压测；生产Workers Free的CPU/memory额度仍需实测（当前完整hash回读受100MiB硬限额约束）。changes表需部署者保留期/压缩运维，不能无限增长。

## 仍由主窗口审查的边界

- Native DPAPI与desktop关闭flush、production静态/Tauri深链接、最终qa:gate/Tauri build/install。
- page/line/cell/snippet精准定位的renderer回执；云端pending目标已写入，仍需完整UI定位验收。
- DOCX/PPTX、Notebook、图片现有viewer在云源上的完整交互与执行隔离；本次浏览器完整实测重点为PDF/MD/unknown binary，不把各格式import契约冒充全部viewer实测。
- 有后续离线编辑依赖冲突版本时保留队列并提示先导出再处理，未实现多版本自动合并；不能静默LWW。
- 浏览器目录entry无法为Native symlink安全做证明；Native任意路径导入需主窗口用canonical-root检查。

主窗口已读取正式交接及208归属回归/双profile离线browser证据，明确接手上述剩余renderer/Native/静态/完整门禁与安装审查。本窗口归属源码冻结，仅完成文档核对与自有3538进程清理；该交接完成不代表主窗口发布、生产云部署或Tauri整体验收已完成。

最终清理已验证：仅停止确认由本窗口启动的 Next dev 父进程66944和子进程13392；两进程均不存在，3538无监听。没有结束全局node或用户应用。最终docs检查exit0（153文件）。
