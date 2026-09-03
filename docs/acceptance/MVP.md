# SEU Summary MVP 验收记录

依据 spec《2026-08-30-seu-summary-desktop-mvp-design.md》第 11 条逐条记录。
**诚实原则**：只标记已在实际环境中验证的内容；需真机/真实账号人工验证的条目如实标注，不夸大。

验收环境：Windows（本机），node v24.15.0，Electron v44.0.0。
自动化验证：`npm run lint && npm run typecheck && npm test && npm run build`（272 个测试 / 41 文件，2026-09-03 全绿）；CI（GitHub Actions windows-latest）对每个 push 运行同样门禁。组合层验证（2026-09-02）：CDP 进程级烟测 19/19（`npm run smoke`：桥面完整性、IPC 全通道探活、启动组装、首渲染）+ 真实 HTTP 集成 6/6 + 六阶段管线端到端，见 docs/health/2026-09-02-combined-audit.md。

## 逐条验收

| # | 验收项 | 状态 | 证据 / 说明 |
|---|---|---|---|
| 1 | 无开发环境的 Windows 机器双击安装即用 | ⚠️ 部分验证 | `npm run dist` 产出 NSIS 安装包（release/ 下 exe）；oneClick/perMachine=false 配置正确；v0.1.1/v0.2.0 曾在用户本机安装验证。**干净 Windows 机器人工安装待 V4.2**（需真机） |
| 2 | 应用内 CAS 登录，会话有效期内重启免登录 | ✅ 真实实测（2026-09-03） | **主窗口内嵌登录**（v0.2.1）：点「登录 CAS」→ 主窗口进入 resourcemanage-ui SPA 完成平台授权 → 以「课程列表接口真实可用」为完成信号 → Cookie+JWT DPAPI 加密落盘 → 自动返回应用并刷新课程。活体验证含：退出登录→重新登录→自动恢复（636 门课落库，fetched_at 铁证）。**重启免登录**（session.bin 复用）由会话存储单测与历史实测支撑 |
| 3 | 会话过期时重开 CAS 并从失败阶段恢复 | ✅ 真实实测（2026-09-03） | 过期检测通道含 CAS 重定向三通道 + **裸 401**（jwt-token 时代平台行为，集成测试覆盖）；`withSessionRetry` 在用户主动动作后重登并重试。活体全链：清会话 → 点刷新 → 主窗口登录 → 自动返回并刷新成功。任务从失败阶段恢复为自动化验证（见 #6） |
| 4 | 自动列出课程/课时；手动输入课程 ID 或回放 URL 作为后备 | ✅ 真实实测（2026-09-03） | 课程列表实测 636 门真实课程拉取落库；**课时目录从播放页收割**（V1.3：1690625/1691584 两门课各 4/8 条「第N节课」实测落库，幂等 + 陈旧行清理）；手动课程/课时 ID 后备入口保留 |
| 5 | 一节 ≥45 分钟真实课完整跑通下载→抽音频→ASR→PPT/关键帧→笔记→追问 | ⚠️ 部分验证 | **真实单课全管线已跑通**（V1.4，2026-09-03 凌晨）：1690625-L0 双流 810MB 下载 → 音频 → 24 片真实 MiMo ASR（11 段 4108 字转写）→ 17 关键帧去重 → mimo-v2.5 笔记落库 succeeded。**剩余**：≥45 分钟课时长的显式确认与 auth_key 时效实测——因 dncvsvod 直链域名 2026-09-03 上午起网络层不可达（见 PROGRESS 失败与卡点）暂缓，定性后补测 |
| 6 | 失败/中断任务恢复且不重复已完成阶段 | ✅ 自动化验证 | 失败注入测试：首跑失败于 transcribing → retryTask 只重跑 transcribing 及之后，fetching_course/downloading_video/extracting_audio 不再执行；多次失败 failed_stage 正确更新 |
| 7 | 成功后原视频/音频删除，转写/PPT/关键帧/笔记/问答保留 | ✅ 自动化验证 | 生命周期断言：屏幕流视频在关键帧提取成功后删除（rmSync）；24h 缓存清理反向验证（旧目录删除、新目录保留）；transcripts/ppt_pages/keyframes/notes/qa 表保留产物 |
| 8 | 多 Provider 配置，ASR/多模态/文本独立绑定；Key DPAPI 加密 | ✅ 自动化验证 | providers + capability_bindings 表；加密往返测试+磁盘字节级无明文 key 断言+明文拒读；三能力独立解析测试。真实 Provider（小米 MiMo）已实测：ASR 分片转写 + multimodal/text 笔记生成 |
| 9 | 结构化笔记四视图 + 时间戳引用保留 | ✅ 自动化验证 | detailed/standard/key_points/methodology 四视图从同一 Note JSON 投影（9 个测试）；transcriptRefs 时间戳字段 schema 校验（含模型输出偏差归一） |
| 10 | 会话过期/下载失败/ASR 失败/不支持视觉输入给出明确信息与下一步 | ✅ 自动化验证 | SchoolApiError(session_expired/network/bad_response)、ProviderError(auth/unsupported_visual/rate_limit/network/bad_response) 消息含下一步动作（如「检查 Provider 设置中的 Key」「绑定多模态模型」）；静音 ASR 分片跳过、全静音课明确报错 |

## 验证命令汇总

```bash
npm run lint        # 0 错误
npm run typecheck   # 0 错误（node + web 双工程）
npm test            # 272 passed (41 files)
npm run build       # electron-vite 产物 out/
npm run smoke       # CDP 进程级烟测 19/19（组合层）
npm run dist        # NSIS 安装包 release/
```

## 人工验证待办（不夸大，逐项留空待真机执行）

1. 干净 Windows 机器安装 release exe 并双击启动（V4.2，待真机）。
2. ~~真实 SEU CAS 账号在应用内登录~~ → ✅ 已实测（2026-09-01 独立窗口时代；2026-09-03 主窗口内嵌登录再验证，含过期恢复全链）。
3. ~~真实课程列表拉取与课时详情~~ → ✅ 已实测（课程 636 门；课时目录播放页收割 4+8 条；课程字段已按真实样本精修）。
4. ≥45 分钟真实课程端到端（含真实 ASR/多模态 Provider Key）→ 管线已真实跑通（V1.4）；**课时长确认与 auth_key TTL 实测待 dncvsvod 域名恢复可达后补测**。
5. ~~会话过期→重登→任务恢复全流程~~ → ✅ 已实测（2026-09-03：清会话 → 刷新 → 主窗口登录 → 自动返回刷新成功；任务从失败阶段重试为自动化验证）。
