# 组合层体检报告（2026-09-02）

> 动机：207 个单元测试全绿，但「测试通过 ≠ 组装起来的应用可用」。模块各自 mock 了边界，
> 组合状态从未被验证——登录窗挂起正是这样漏网的。本次体检补齐四个组合层的自动化验证。

## 验证矩阵

| 层 | 验证物 | 结果 | 位置 |
|---|---|---|---|
| L1 三进程桥 | 真实 Electron 进程 CDP 探针 | **19/19 绿** | `scripts/smoke-cdp.mjs`（`npm run smoke`） |
| L2 HTTP 真实栈 | SchoolClient × 真实 fetch × 本地 http 服务器 | **6/6 绿** | `tests/school-client-http.test.ts` |
| L3 六阶段管线 | 全链端到端（真实 ffmpeg + 三合一 mock 服务器） | **1/1 绿** | `tests/pipeline-e2e.test.ts` |
| L0 单元 | 既有套件 | **221/221 绿** | `npm test` |

## L1 烟测断言清单（`npm run smoke`，~15s，发布前必跑）

- 桥面完整性：`window.seuSummary` 7 组 26 方法与 `src/shared/bridge.ts` 逐一比对。
- IPC 全通道探活：11 个无副作用通道真实 invoke 往返 ApiResult 信封（含 `qa:ask` 未绑定、
  `providers:bind` 非法能力、`tasks:create` 外键违规三条错误路径）。
- 启动组装：隔离 userData + 隔离资料库下 app.db 建立且 5 个迁移全应用、空库 0 课程。
- 文件日志：`log:rendererError` 经主进程落进脱敏日志文件。
- 首渲染：4 个页签、徽章初始 `logged_out`。
- **隔离保证**：`SEU_SMOKE_USER_DATA`（session/日志/单实例锁）+ `SEU_SUMMARY_DOCS_OVERRIDE`
  （资料库根）双隔离，探针永不触碰真实用户数据。
- 有意不探：`school:listCourses`（会打真实学校 API）、`school:login`（开 CAS 窗口）。

## L2 发现与结论

- **证伪**：曾怀疑 fetch `redirect:'manual'` 在真实栈下返回 opaqueredirect（status 0、
  location 不可读）导致 302→CAS 的 session_expired 检测失效。实测 **Node/Electron 的
  undici 返回可读的 302**（与浏览器规范不同），检测链成立，stub 与真实栈语义一致。
- 头组装（Cookie + jwt-token）、t-1 解析、四类 SchoolApiError 分类全部在真实 HTTP 上复核。

## L3 端到端覆盖

fetching → downloading → extracting_audio → transcribing → extracting_visuals → summarizing
全程一次组装通过：真实 ffmpeg 下载 remux（`-c copy` over http）、音频提取、关键帧抽帧 +
真实 grid 去重、OpenAI 兼容 wire format（multipart ASR / chat completions）、zod 校验、
notes/transcripts/keyframes/task_stage_outputs 落库、转写后音频删除、**全景流全程零请求**。

## 过程中发现并处置

1. `gridDecoder` 是 app-context 内联闭包、零测试面 → 提取为 `src/main/media/grid.ts`（6ec4c82）。
2. 端到端首跑暴露：mock 视频短于关键帧采样间隔（fps=1/10）时产出 0 帧属**正确行为**——
   体检样例改为 21s（非产品缺陷，记录避免误判）。

## 仍未验证（需真实环境，见 PROGRESS.md「下一步」）

- CAS 登录窗口真实登录（当前头号堵点：间歇挂起，诊断手册见
  `docs/diagnostics/login-hang-ab-playbook.md`）。
- 真实 ASR/LLM Provider 的计费、限流、长音频分片行为。
- ≥45 分钟真实课程端到端、干净机器安装、真实过期恢复（MVP 人工三项）。

## 门禁约定（自本次起）

提交前：`npm run lint && npm run typecheck && npm test`；发布前追加 `npm run smoke`。
