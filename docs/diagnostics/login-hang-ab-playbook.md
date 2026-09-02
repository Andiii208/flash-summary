# 登录窗口挂起 A/B 诊断手册（2026-09-02）

> 症状：node fetch / curl 直连 cvs.seu.edu.cn 秒通（200/40ms），但 Electron 登录窗口
> loadURL 间歇性无请求、无错误、无首帧。导致重新登录拿不到 JWT → 课程 401 → 课程树空。

## 0. 基线取证（2026-09-02 13:35，体检时实测）

| 项 | 实测值 | 含义 |
|---|---|---|
| clashmi.exe / clashmiService.exe | **均在运行**（PID 14984 / 25620） | 代理进程存活 |
| ProxyEnable（HKCU Internet Settings） | **0x1（开启）** | ⚠️ **推翻 09-01 的"已排除系统代理（=0）"记录**：Clash 界面关开关后已重新接管 |
| ProxyServer | 127.0.0.1:7890 | Chromium 默认走此代理；node fetch **不走**——与"fetch 秒通、Chromium 挂"完全吻合 |
| 7890 端口 | LISTENING + 多条 ESTABLISHED | 流量正在进本地代理 |
| tailscaled / tailscale-ipn | 运行中 | exit node 此前实测 false，维持观察 |

**结论：代理吞流量重回第一嫌疑。** Chromium 的流量进 127.0.0.1:7890 后若被规则分流到
不可用节点（校园域名被误分流最常见），表现正是"无请求发出、无错误、挂死"。

## 1. A/B 步骤（按序执行，每步记录 net-trace.log 变化）

**每步之后**：启动应用 → 点「登录 CAS」→ 等待结果（成功 / 报错 / 挂起 30s+）→
把 `%APPDATA%\seu-summary\logs\net-trace.log` 尾部复制留存，然后删除该文件以便下一步干净判读。

### 步骤 1（首选）：完全退出 Clash Mi 后复测
托盘右键 Clash Mi → 退出（不是关窗口）。确认进程已消失：
```powershell
tasklist | findstr /i "clashmi"
```
（无输出才算退干净；若 clashmiService.exe 仍在，任务管理器结束它。）
然后正常启动应用复测登录。
- **好了** → 根因=代理分流。在 Clash Mi 规则里给 `*.seu.edu.cn` 加 DIRECT 直连后即可常驻。
- **仍挂** → 步骤 2。

### 步骤 2：`SEU_DIRECT_NET=1` 绕过 Chromium 代理/QUIC/DoH 三层
PowerShell（在项目根）：
```powershell
cd "E:\SEU summary"
$env:SEU_DIRECT_NET='1'; npx electron .
```
此模式 Chromium 完全不走系统代理。好了 → 坐实代理；仍挂 → 步骤 3。

### 步骤 3：`SEU_DIAG_URL` 跳过本地 loading 首跳
```powershell
$env:SEU_DIAG_URL='https://cvs.seu.edu.cn/'; npx electron .
```
首个导航直接打平台页，隔离 data: 页是否为挂点。

### 步骤 4：`SEU_DIAG_DEFAULT_SESSION=1` 隔离 persist:seu-cas 分区
```powershell
$env:SEU_DIAG_DEFAULT_SESSION='1'; npx electron .
```
（仅诊断用：登录成功会把 cookie 落进默认会话，诊断后需正常启动一次重新登录。）

### 步骤 5：`SEU_DIAG_SHOW=1` 肉眼观察
```powershell
$env:SEU_DIAG_SHOW='1'; npx electron .
```
窗口直接可见：看到的是白屏、加载中、还是报错页，记录下来。

（多个变量可叠加；每步只改一个变量最利于归因。）

## 2. net-trace.log 钉子判读表

| 日志形态 | 结论 |
|---|---|
| 有 `NAV start` 无 `NAV commit` | 首跳从未 commit → renderer/网络服务进程侧（代理黑洞最典型） |
| 有 `NAV commit` 无 `NAV finish` | 页面开始加载但资源挂起 → 网络/代理 |
| `NAV renderer gone <reason>` / `NAV renderer unresponsive` | 进程级问题（崩溃/卡死） |
| 只有 `LOGIN window open`，连 `NAV start` 都没有 | loadURL 前就挂 → 查窗口创建与首帧预算 |
| `PLATFORM page loaded` + `FAIL <原因>` | 链路走到了明确失败，按原因分类处理 |

## 3. t-1 课程字段抓样（并行任务，与挂起无关）

登录平台网页版（浏览器直接访问 cvs.seu.edu.cn 云课堂）→ F12 → Network → 勾选 Fetch/XHR →
刷新课程列表页 → 找 `group_subject_vod_list/t-1` 请求：
1. 复制完整 Response JSON（课程名/学期字段非敏感，可整段贴出）；
2. 复制该请求的 Request URL 全串与 Request Headers 里的 `jwt-token` **头名**（值可打码）。
拿到样本即可精修 `parseCourseList` 字段候选与课时/视频流接口（getList / lastPlayInfoById / m3u8）。

## 4. MVP 人工验收清单

见 `docs/acceptance/MVP.md` 人工验证待办：干净机器安装、重启免登录复验、45 分钟端到端、
过期→重登→手动重试恢复（2026-09-01 收窄语义）。
