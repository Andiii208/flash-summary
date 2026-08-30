# SEU Summary MVP 验收记录

依据 spec《2026-08-30-seu-summary-desktop-mvp-design.md》第 11 条逐条记录。
**诚实原则**：只标记已在实际环境中验证的内容；需真机/真实账号人工验证的条目如实标注，不夸大。

验收环境：Windows（本机），node v24.15.0，Electron v44.0.0。
自动化验证：`npm run lint && npm run typecheck && npm test && npm run build`（112 个测试 / 19 文件，2026-08-30 全绿）；CI（GitHub Actions windows-latest）对每个 push 运行同样门禁。另做真实 Electron 启动烟测：应用 7 秒运行日志干净、资料库目录与 app.db 正常建立、renderer 装载成功。

## 逐条验收

| # | 验收项 | 状态 | 证据 / 说明 |
|---|---|---|---|
| 1 | 无开发环境的 Windows 机器双击安装即用 | ⚠️ 部分验证 | `npm run dist` 产出 NSIS 安装包（release/ 下 exe）；oneClick/perMachine=false 配置正确。**未在干净 Windows 机器上人工安装验证**（需真机） |
| 2 | 应用内 CAS 登录，会话有效期内重启免登录 | ⚠️ 部分验证 | 登录窗口模块（cas-login.ts，会话隔离 partition）、DPAPI 加密会话存储（session.bin，加密往返+反明文测试通过）。**真实 CAS 登录流程需真实账号人工验证** |
| 3 | 会话过期时重开 CAS 并从失败阶段恢复 | ⚠️ 部分验证 | 过期检测三通道单测过（302/location、落地 URL、HTML body）；失败→重试从失败阶段恢复、不重复已完成阶段单测过。**真实过期场景需人工验证** |
| 4 | 自动列出课程/课时；手动输入课程 ID 或回放 URL 作为后备 | ⚠️ 大部分验证 | API 客户端 fixture 回放测试过；UI 三栏主界面含课程列表+**手动添加课程/课时 ID 后备入口**（幂等落库测试过）；真实课程拉取需人工 |
| 5 | 一节 ≥45 分钟真实课完整跑通下载→抽音频→ASR→PPT/关键帧→笔记→追问 | ⚠️ 部分验证 | 管线各阶段独立测试过（真实 ffmpeg 6s 样例音频提取、3 帧关键帧、感知哈希去重、下载重试、schema 校验）。**真实 45 分钟课程端到端需真实账号+Provider Key 人工跑** |
| 6 | 失败/中断任务恢复且不重复已完成阶段 | ✅ 自动化验证 | 失败注入测试：首跑失败于 transcribing → retryTask 只重跑 transcribing 及之后，fetching_course/downloading_video/extracting_audio 不再执行；多次失败 failed_stage 正确更新 |
| 7 | 成功后原视频/音频删除，转写/PPT/关键帧/笔记/问答保留 | ✅ 自动化验证 | 生命周期断言：屏幕流视频在关键帧提取成功后删除（rmSync）；24h 缓存清理反向验证（旧目录删除、新目录保留）；transcripts/ppt_pages/keyframes/notes/qa 表保留产物 |
| 8 | 多 Provider 配置，ASR/多模态/文本独立绑定；Key DPAPI 加密 | ✅ 自动化验证 | providers + capability_bindings 表；加密往返测试+磁盘字节级无明文 key 断言+明文拒读；三能力独立解析测试 |
| 9 | 结构化笔记四视图 + 时间戳引用保留 | ✅ 自动化验证 | detailed/standard/key_points/methodology 四视图从同一 Note JSON 投影（9 个测试）；transcriptRefs 时间戳字段 schema 校验 |
| 10 | 会话过期/下载失败/ASR 失败/不支持视觉输入给出明确信息与下一步 | ✅ 自动化验证 | SchoolApiError(session_expired/network/bad_response)、ProviderError(auth/unsupported_visual/rate_limit/network/bad_response) 消息含下一步动作（如「检查 Provider 设置中的 Key」「绑定多模态模型」） |

## 验证命令汇总

```bash
npm run lint        # 0 错误
npm run typecheck   # 0 错误（node + web 双工程）
npm test            # 96 passed (17 files)
npm run build       # electron-vite 产物 out/
npm run dist        # NSIS 安装包 release/
```

## 人工验证待办（不夸大，逐项留空待真机执行）

1. 干净 Windows 机器安装 release exe 并双击启动。
2. 真实 SEU CAS 账号在应用内登录，重启验证会话保持。
3. 真实课程列表拉取与课时详情。
4. ≥45 分钟真实课程端到端（含真实 ASR/多模态 Provider Key）。
5. 会话过期→重登→任务恢复全流程。
