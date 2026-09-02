# SEU Summary MVP 验收记录

依据 spec《2026-08-30-seu-summary-desktop-mvp-design.md》第 11 条逐条记录。
**诚实原则**：只标记已在实际环境中验证的内容；需真机/真实账号人工验证的条目如实标注，不夸大。

验收环境：Windows（本机），node v24.15.0，Electron v44.0.0。
自动化验证：`npm run lint && npm run typecheck && npm test && npm run build`（221 个测试 / 38 文件，2026-09-02 全绿）；CI（GitHub Actions windows-latest）对每个 push 运行同样门禁。组合层验证（2026-09-02）：CDP 进程级烟测 19/19（`npm run smoke`：桥面完整性、IPC 全通道探活、启动组装、首渲染）+ 真实 HTTP 集成 6/6 + 六阶段管线端到端，见 docs/health/2026-09-02-combined-audit.md。

## 逐条验收

| # | 验收项 | 状态 | 证据 / 说明 |
|---|---|---|---|
| 1 | 无开发环境的 Windows 机器双击安装即用 | ⚠️ 部分验证 | `npm run dist` 产出 NSIS 安装包（release/ 下 exe）；oneClick/perMachine=false 配置正确。**未在干净 Windows 机器上人工安装验证**（需真机） |
| 2 | 应用内 CAS 登录，会话有效期内重启免登录 | ✅ 真实实测（2026-09-01，校园网内） | 登录窗口模块（cas-login.ts，会话隔离 partition）、DPAPI 加密会话存储（session.bin，加密往返+反明文测试通过）。用户实测：登录链路全自动静默完成（cvs→auth.seu.edu.cn OAuth2 prompt=NONE→跳回 cvs→收割会话）。**回归风险**：登录窗口存在间歇挂起问题（PROGRESS 失败与卡点节），解决前此条保持 ⚠️ 警惕 |
| 3 | 会话过期时重开 CAS 并从失败阶段恢复 | ⚠️ 部分验证（语义已收窄） | 过期检测三通道单测过（302/location、落地 URL、HTML body）；失败→重试从失败阶段恢复、不重复已完成阶段单测过。**语义修订（2026-09-01）**：过期不再静默自动弹窗——徽章如实提示 + toast，重登由用户主动触发、任务手动重试（spec §2 修订记录）。真实过期场景仍需人工验证 |
| 4 | 自动列出课程/课时；手动输入课程 ID 或回放 URL 作为后备 | ⚠️ 大部分验证 | API 客户端已切真实端点（8dec927：真实 base + jwt-token 头 + t-1）并新增真实 fetch 集成测试与六阶段端到端；UI 三栏主界面含课程列表+手动添加后备入口（幂等落库测试过）；课程接口字段精修待用户 F12 真实样本 |
| 5 | 一节 ≥45 分钟真实课完整跑通下载→抽音频→ASR→PPT/关键帧→笔记→追问 | ⚠️ 部分验证 | 管线各阶段独立测试过；**六阶段全链端到端已在合成媒体上组装跑通**（tests/pipeline-e2e.test.ts：真实 ffmpeg + 真实 fetch + 三合一 mock 服务器，2026-09-02）。真实 45 分钟课程端到端仍需真实账号+Provider Key 人工跑 |
| 6 | 失败/中断任务恢复且不重复已完成阶段 | ✅ 自动化验证 | 失败注入测试：首跑失败于 transcribing → retryTask 只重跑 transcribing 及之后，fetching_course/downloading_video/extracting_audio 不再执行；多次失败 failed_stage 正确更新 |
| 7 | 成功后原视频/音频删除，转写/PPT/关键帧/笔记/问答保留 | ✅ 自动化验证 | 生命周期断言：屏幕流视频在关键帧提取成功后删除（rmSync）；24h 缓存清理反向验证（旧目录删除、新目录保留）；transcripts/ppt_pages/keyframes/notes/qa 表保留产物 |
| 8 | 多 Provider 配置，ASR/多模态/文本独立绑定；Key DPAPI 加密 | ✅ 自动化验证 | providers + capability_bindings 表；加密往返测试+磁盘字节级无明文 key 断言+明文拒读；三能力独立解析测试 |
| 9 | 结构化笔记四视图 + 时间戳引用保留 | ✅ 自动化验证 | detailed/standard/key_points/methodology 四视图从同一 Note JSON 投影（9 个测试）；transcriptRefs 时间戳字段 schema 校验 |
| 10 | 会话过期/下载失败/ASR 失败/不支持视觉输入给出明确信息与下一步 | ✅ 自动化验证 | SchoolApiError(session_expired/network/bad_response)、ProviderError(auth/unsupported_visual/rate_limit/network/bad_response) 消息含下一步动作（如「检查 Provider 设置中的 Key」「绑定多模态模型」） |

## 验证命令汇总

```bash
npm run lint        # 0 错误
npm run typecheck   # 0 错误（node + web 双工程）
npm test            # 221 passed (38 files)
npm run build       # electron-vite 产物 out/
npm run smoke       # CDP 进程级烟测 19/19（组合层）
npm run dist        # NSIS 安装包 release/
```

## 人工验证待办（不夸大，逐项留空待真机执行）

1. 干净 Windows 机器安装 release exe 并双击启动。
2. ~~真实 SEU CAS 账号在应用内登录，重启验证会话保持~~ → 登录已实测通过（2026-09-01）；**重启免登录**待复验；当前受登录窗间歇挂起阻塞（见 docs/diagnostics/ 诊断手册）。
3. 真实课程列表拉取与课时详情——列表已实测（2026-09-01）；**课时详情/视频流接口字段**待用户 F12 样本精修。
4. ≥45 分钟真实课程端到端（含真实 ASR/多模态 Provider Key）。
5. 会话过期→重登→任务恢复全流程（按 2026-09-01 收窄语义：过期提示 → 用户点登录 → 手动重试任务）。
