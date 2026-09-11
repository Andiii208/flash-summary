# 方案：全库健康巡查与体验优化（2026-09-12）

> 状态：**执行中**。Andiii 睡前指令「先做一份具体的优化计划，随后再按照计划去进行修复和优化」＝本方案连同执行一并预授权；本文件即全程可回溯的锚点：每批一个 Conventional Commit，批批过四门禁（lint / typecheck / test / build 或注明），测试数只增不减。
>
> 巡查方式：两条独立探索线（渲染层 UX 15 项 / main+shared+tests 14 项）＋关键发现逐条亲自读码核实。基线：lint/typecheck 干净，**848/848（90 文件）全绿**，`npm audit` 0 漏洞，git 工作区干净（仅两个未跟踪临时目录）。

## 0. 范围与红线

- 只修**真实存在、可核验**的问题：bug、错误处理缺口、可访问性、busy 反馈、文档事实漂移。不加新功能面（D1/D2 除外，见决策记录）、不动产品边界。
- **不动**：DISCLAIMER/声明层（无新增用户可见承诺）、`appId`/包名/userData、文档标题旧产品名（待 Andiii 裁决，PROGRESS 遗留清单在案）、`release/0.7.2` 旧安装包（沿用「未擅自删」）。
- 用户可见新文案遵守：口语化、能核对、无法律术语；busy 遵守「省略号 + disabled + in-flight 守卫」约定。

## 决策记录（D1-D7，均取更简单/更保守一侧）

- **D1 笔记版本切换 UI：不做**。bridge/DB 已留全量版本历史但 UI 只显 latest 是真实体验缺口，但「笔记版本切换 UI」在 PROGRESS「明确不做（未来候选）」清单里，是否转正属产品决策——列入候选报告，待 Andiii 点头。
- **D2 巨型函数拆分（registerIpc ≈1420 行 / useAppState ≈1500 行 / createContext ≈445 行）：本会话不做**。纯结构重构、无行为收益、改动面横跨安全关键路径，深夜无人复核不冒险；列候选。
- **D3 CHANGELOG 八个历史 `[未发布]` 标题重命名：不做**。0.3.0 从未打 tag，各批内容实际随哪个版本到用户手里需要考古且证据链不清——改错比不改糟；只补顶部 `[未发布]` 节（本会话改动需要落点）。已备案。
- **D4 文档标题旧产品名（scripts/release.md:1 等 4 处）：不动**（PROGRESS 遗留清单明确待 Andiii 裁决范围）。
- **D5 深色令牌两块「去重」降级为同步注释**。核实后两块选择器语义不同（`@media` 内 `:root:not([data-theme='light'])` vs 显式 `:root[data-theme='dark']`），不能合并成一条规则；CSS 嵌套方案可写但不值当。加「两块必须同步改」注释。
- **D6 侧栏可折叠：做**。官方遗留清单 ⑫ 在案（304px 常驻挤压窄窗口），纯展示层改动。
- **D7 `release/0.7.2` 旧安装包：不删**（沿用既有「未擅自删」裁决，报告中提示可删）。

## 修正探索线报告的两处误报

1. 「深色令牌块逐字重复可合并」——选择器语义不同（见 D5）。
2. 「`harvestLessons` 的 `.catch` 吞同步校验错误」——方向对但机制不准：preload 契约下 handler 错误以 `{ok:false}` 信封**resolve**，裸 rejection 只来自桥层；修复须同时覆盖信封与 rejection 两路（批4）。

## 批1 fix(main)：错误处理与 IPC 契约收口

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| 1 | `school:logout` 是唯一无 try/catch 的异步 handler，内部抛错时渲染层收到裸 rejection，破坏「只收 ApiResult」契约 | src/main/ipc.ts:239-242 | 包 try/catch 返回 `err(e)` |
| 2 | `settings:openPath` 用 `void shell.openPath(...)` 吞失败——目录被删时用户零反馈 | src/main/ipc.ts:793 | `await`；非空错误串 `logger.warn` + 返回 `err` |
| 3 | `app.on('activate')` 会二次注册全部 58 个 IPC handler（Electron 对同通道二次 handle 抛异常；macOS 残留死分支，Windows 不触发但属潜伏崩溃） | src/main/index.ts:258-265 | registerIpc 加只执行一次的守卫 |
| 4 | 关窗确认对话框 `.then` 无 `.catch`——弹窗期间窗口销毁即未处理 rejection | src/main/index.ts:231-251 | 链尾 `.catch(() => undefined)` |
| 5 | 播放页导航竞速输家的 promise 无人观察（超时后 `loading` 迟到的 ERR_ABORTED、加载成功后 `budget` 迟到的超时 throw，都是 main 进程未处理 rejection） | src/main/school/play-harvest.ts:243-248 | race 前给两个 racers 各挂 no-op `.catch`（不改变 race 语义） |
| 6 | `tasks:delete` 把未做格式校验的 taskId 拼进 `rmSync` 路径——当前靠「必须先命中任务行」的隐式不变量兜底，纵深不足 | src/main/ipc.ts:892-901 | 白名单 `/^[A-Za-z0-9._-]+$/` 不过即 err |
| 7 | `SCHOOL_TIMEOUT_MS` 导出无人引用 | src/main/school/client.ts:67 | 去掉 `export` |
| 8 | tests/orchestrator.test.ts:383 残留调试 `console.log('t7 debug:…')` | 同左 | 删除该行（全局规则：调试用完必删） |
| 9 | app-context.ts:350 箭头函数体首句挤在 `{` 同行（粘贴事故残迹，纯格式） | 同左 | 重排换行 |

新增测试：logout 抛错→`{ok:false}` 信封；openPath 失败→err 信封；tasks:delete 传非法格式 id→err 且不触达 rmSync。

## 批2 fix(security)：redact 凭据名单加固

- 名单（src/main/logger.ts:72）补 `access_token|refresh_token|password`。当前无实际泄露路径（已核查），属纵深：平台把 refresh token 放 localStorage（app-context.ts:309-311 注释自证），未来任何日志带上响应体就会漏。
- 钉住测试：三条新键各造一行含值日志断言被脱敏（沿用现有 logger 测试的形态，测试数 +1 组）。

## 批3 fix(renderer)：两个真 bug

1. **BiliImportDialog 二维码轮询饿死**（src/renderer/components/BiliImportDialog.tsx:127-149）：轮询 effect **没有依赖数组**，每次渲染都 teardown 重建 2s interval；任务进行中 App 因 onProgress 高频重渲染（下载阶段事件间隔常 <2s）→ interval 永远活不到触发 → 扫码后状态永远停在「等待扫码…」。修：effect 加 `[open, loginPhase]` 依赖，`doImport`/`onSessionRefresh` 走 ref（沿用 App 里 openLessonNotesRef 的既有模式）。
2. **合并 toast 永不自动消失**（src/renderer/hooks/use-toasts.ts:45-55）：`mergeToast` 保留 `existing.id` 丢弃新 id，而定时器 dismiss 的是**新 id** → 过滤永远扑空；重复触发的 success/info 常驻到被 FIFO 挤出，与「3.5s 自动消失」的设计矛盾。修：按 `${kind}:${message}` 内容键维护一张 timer Map——每次触发先清旧 timer 再设新的（合并语义＝新近度重排生命周期），到点按内容键移除（mergeToast 保证同键至多一条，语义精确；不改 mergeToast 本身，现有测试不动）。
- 新增测试：合并后推进假时钟 → 合并条目消失；同键第三次触发重置生命周期（首次 timer 到点不误删）。
- Bili 轮询测试：渲染登录中态 → 以新 props 重渲染多次 → 推进假时钟 → 轮询仍按间隔发生。

## 批4 fix(renderer)：harvest 发起会话反馈 + MindMap 字面星号

1. **「抓取课时目录」发起会话零反馈且可重复点击**（src/renderer/App.tsx:1519-1531）：发起后 renderer 很快因主窗口导航卸载（批C 设计依赖导航后 fresh mount 轮询），但**导航失败/被校验拒绝时**用户只看到一条 3.5s toast，且 `harvestInflight` 不更新 → 徽标不亮、可重复点击；错误信封被 `.then` 静默丢弃。修：发起即乐观 `setHarvestInflight`（CourseTree 的「正在抓取课时目录…」分支本会话可达）；`.then` 里检查 `res.ok` 失败则 toast 错误并移除乐观置位；`.catch` 同样处理；inflight 中同课重复点击直接 return。
2. **导图弹层关联概念显示字面 `**`**（src/renderer/components/MindMap.tsx:581）：`{concept.definition}` 纯文本插值，违反 AGENTS「笔记字段用户可见文本一律经 MdLite/InlineText 渲染」——详细视图同一字段是走 InlineText 的。修：改 `<InlineText text={…} />`。
- 新增测试：MindMap 弹层概念定义含 `**加粗**` 时渲染为 strong 而非字面星号（mindmap.test.tsx 扩展）；harvest 失败信封 → error toast（app-shell 测试扩展）。

## 批5 fix(renderer)：busy 反馈统一（AGENTS UI 约定补漏）

1. NoteViewer 四按钮无防连点（src/renderer/components/NoteViewer.tsx:231-250）：复制 Markdown（瞬时，不加）/ 导出 Anki / 导出 Markdown / 导出 Obsidian——双击会连开两个系统保存对话框。修：App 侧 `exportBusy`（存正在导出的种类或 null），三个按钮 disabled + 「导出中…」。
2. 课程导图打开无加载反馈可重复触发（src/renderer/App.tsx:1878-1899）：聚合可能数秒。修：`courseMapBusy` 状态，CourseTree 导图按钮 disabled + title「生成中…」。
3. BiliImportDialog busy 只灰不加省略号（BiliImportDialog.tsx:226-228、290-292）：修「解析中…」「导入中…」。
- 新增测试：导出 busy 期间按钮 disabled；Bili 按钮 busy 文案。

## 批6 fix(a11y)：模态焦点陷阱 + 菜单键盘

1. **Dialog 无焦点陷阱**（src/renderer/ui/Dialog.tsx:37-81，长期遗留）：Tab 会跑到弹层后面的页面里；关闭后焦点也不归还。修：新增 `src/renderer/ui/use-focus-trap.ts`——激活时记 `document.activeElement`，Tab 在容器内可聚焦元素间循环（含首尾环绕），停用时归还焦点；Dialog/BiliImportDialog/CourseMapDialog 三处接入（Esc 各自保留现有监听，陷阱只管 Tab 与焦点归还）。
2. LessonChip 下拉 role=menu 无键盘支持（LessonChip.tsx:31-38、66-83）：open 时监听 Esc 关闭；ArrowUp/Down 在菜单项间移动焦点。
3. MyStudyPanel 分组折叠头键盘不可达（MyStudyPanel.tsx:43-49）：`role="button"` 补 `tabIndex={0}` + Enter/Space 切换。
- 新增测试：Tab 环绕（happy-dom 的 activeElement/focus 可测）；Esc 关闭；Enter 切换折叠。

## 批7 perf+ux：挂载 effect 拆分 + 本地读取失败提示

1. App 挂载大 effect 依赖含 `refreshTree`（identity 随 refreshBusy 翻转，App.tsx:971-998 + deps 行 1290）→ 每次刷新课程开始/结束整段 effect 重跑：重建 onProgress 订阅、重放全部 loader。修：`refreshTreeRef` 化（沿用 openLessonNotesRef 既有模式），effect 不再依赖其身份，只跑一次。
2. 本地数据读取失败全线静默（App.tsx:950-957）：applyLocalTree `!ok` 时侧栏停在「暂无课程」无提示。修：courseTree 读取失败 toast（mergeToast 同文案自动合并，不会刷屏）；其余 loader 的静默失败备案不动（只在 DB 层故障时才可达）。
- 验证：现有 app-shell.test.tsx（14 测试）全绿即为回归护栏；必要时补「!ok → toast」断言。

## 批8 feat(ui)：侧栏可折叠（遗留清单 ⑫）

- App.tsx:281 `<aside class="sidebar">` 固定 304px（style.css:309-311），窄窗口下常驻挤压内容列。修：侧栏头部加收起/展开按钮（`aria-expanded`），折叠态收成窄条（只留展开钮），状态并入现有 `savePersistedUi` UI 快照（导航往返保持）。
- 新增测试：点击收起后课程列表不可见、再展开恢复；快照往返保持折叠态。

## 批9 chore(docs)：文档与仓库卫生

1. README.md:65「42 通道」→ 实际 58 handler（+3 推送通道）——v0.5.0 时代的数字漂移。
2. CHANGELOG 顶部补 `## [未发布]` 节，收录本会话用户可见改动（busy 文案、焦点陷阱、侧栏折叠、错误提示等）；历史 8 个 `[未发布]` 标题不动（D3）。
3. .gitignore 补 `.playwright-mcp/` 与 `.tmp-audit-shots/`（git status 两个未跟踪临时目录，照 `.tmp-e2e-shots/` 写法）。
4. style.css 深色两块加「两块必须同步改」注释（D5）。

## 收尾（全验证 + 回溯）

1. 四门禁：`npm run lint && npm run typecheck && npm test`，末批后加 `npm run build`。
2. `npm run smoke`（32 项 CDP 烟测，渲染层改动多，必须跑）。
3. PROGRESS.md 新增本阶段记录 + 阶段表一行；CHANGELOG [未发布] 收口；neat-freak 式一致性检查（README/AGENTS/docs 与代码事实一致）。
4. push master + 盯 CI；失败则修-forward。不 bump 版本、不打 tag（发布由 Andiii 决定）。

## 交付后给 Andiii 的候选清单（本会话未做）

- 笔记版本切换 UI（D1，产品决策）；registerIpc/useAppState 拆分（D2）；CHANGELOG 历史标题考古（D3）；文档标题旧产品名（D4，待裁决）；其余 loader 静默失败细化（批7 只收 courseTree）；`release/0.7.2` 旧安装包可删（D7）；导图 label 关系词白名单再收紧 + 多课时大树性能（原遗留，需真实数据）。
