# 登录窗口挂起诊断手册（2026-09-02 晚更新：已定性为环境级故障）

> **状态：已归档（2026-09-03）**。本手册针对的独立登录窗口已在 v0.2.1 退役——
> 登录改为主窗口内嵌完成，仅 `SEU_LOGIN_WINDOW=1` 时启用旧路径。手册保留为本机
> 环境故障（第二渲染器不加载）的诊断参考；若未来根因修复、独立窗口回归，仍适用。

> **09-02 晚定论（与用户实时联测）**：本机 Electron 的**第二个渲染器永远不加载**——
> 登录窗口无论 data:/http(s)/file:// 都只 NAV start 不 commit；`window.open` 能拿到
> window 对象但窗口 title 永空；CDP `Target.createTarget` 调用本身挂死；主窗口
> （第一个渲染器）的 file:// 加载完美。已排除代理/分区/沙箱/scheme/GPU/遮挡计算。
> 应用侧已做防御（001e6c4）：loading 页走 file:// + renderer 侧跳转，25s 必有报错。
> **剩余根因三嫌疑**：①安全组件注入（Defender 实时防护；试加排除目录）
> ②Windows build 26200（Insider 级）× Electron 44 兼容 ③虚拟显示驱动/输入法 hook。

> 历史症状：node fetch / curl 直连 cvs.seu.edu.cn 秒通（200/40ms），但 Electron 登录窗
> loadURL 间歇性无请求、无错误、无首帧。**另注意：安装版 v0.2.0（09-01 09:53 构建）
> 不含当天下午之后的全部登录修复——现场测试一律用项目根 `npx.cmd electron .` 跑新构建。**

## 0. 环境取证时间线

| 时间 | 取证 |
|---|---|
| 09-01 | 用户退出 Clash 后登录链路实测成功；当晚 22:49 起复现挂起 |
| 09-02 体检 | ProxyEnable=1 + clashmi 存活（代理翻案，主张 A/B） |
| 09-02 晚 | 用户退干净 Clash（进程无、ProxyEnable=0）→ **仍挂** → 代理排除 |
| 09-02 晚 | partition/sandbox/scheme/GPU/遮挡全排除；**window.open + createTarget 复现 → 第二渲染器环境级故障定论** |
| 09-02 晚 | better-sqlite3 曾从 node_modules 无声消失（重装恢复）——同环境安全组件嫌疑佐证 |

## 1. 用户修复步骤（按序，每步后用 `npx.cmd electron .` 重测）

1. **重启电脑** → 点登录（清全部 hook 态的零成本分界实验；better-sqlite3 消失与第二渲染器挂死都可能是一次性系统态损坏）。
2. 无效 → **Windows 安全中心 → 病毒和威胁防护设置 → 排除项**添加 `E:\SEU summary`（及 `%LOCALAPPDATA%\Programs\SEU Summary`）→ 重启应用再试。
3. 无效 → **临时退出百度输入法**（切英文键盘）再试；仍无效则退出远程控制工具（向日葵/ToDesk 类）再试。
4. 全部无效 → 用 `--enable-logging=stderr --v=2` 抓 chromium stderr（重点看渲染进程/utility 进程启动行），连同本文件判读表反馈到新会话。

## 2. net-trace.log 钉子判读表（现行版）

| 日志形态 | 结论 |
|---|---|
| `NAV start` 后无 `NAV commit` | 导航永不提交 = 第二渲染器故障的本体特征（任何 scheme 皆然） |
| `LOADING page ready -> renderer navigates to platform` | file:// loading 页已加载（好迹象，001e6c4 新钉子） |
| `PLATFORM page committed` | 平台页首帧到达（预算解除、探针启动） |
| `NAV renderer gone <reason>` / `unresponsive` | 渲染进程崩溃/卡死（进程级） |
| `FAIL …（25 秒，阶段：首帧）` | 预算兜底触发——新版必有此报错，不再无声白屏 |

## 3. t-1 课程字段抓样

**优先路径（无需 Chromium/无需 F12）**：会话有效时应用内 SchoolClient 走 node fetch 可直连。
若需手动：登录平台网页版 → F12 → Network → 刷新课程列表 → 找 `group_subject_vod_list/t-1`
→ 复制 Response JSON 整段（课程名非敏感）+ Request Headers 里 `jwt-token` 头名（值打码）。

## 4. MVP 人工验收清单

见 `docs/acceptance/MVP.md` 人工验证待办：干净机器安装、重启免登录复验、45 分钟端到端、
过期→重登→手动重试恢复（2026-09-01 收窄语义）。
