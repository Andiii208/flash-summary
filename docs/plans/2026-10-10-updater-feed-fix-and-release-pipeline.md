# 2026-10-10 自动更新下载 404 修复 + 发布流程加固 方案

> 状态：**方案待审**（未动任何代码）。日期：2026-10-10。
> 触发：Andiii「你再好好审视一下这个项目，看看之前我强调的问题是否都准确地解决了，同时还有一个自动从 GitHub release 检查更新的功能是否存在且可以正常使用。如果存在问题的话，认真找出来，同时制定一个详细的优化与提升计划」。
> 本方案只做缺陷修复与流程加固，不新增产品功能、不动产品边界（无需 spec §9 变更，DISCLAIMER 文本版本不动）。

## 0. 结论速览

**之前强调的两个问题：一个准确解决，一个只解决了一半。**

| # | 现象（Andiii 2026-10-01 原话） | 复核结论 |
| --- | --- | --- |
| 1 | 截图全堆笔记末尾、正文无穿插 | ✅ **准确解决**。`NoteBlocks.tsx:289-292` 的 `useMemo` 依赖已含 `attachmentVersion`（`[entries, getAttachment, manifest, version]`），NoteViewer 两处调用点（`:594`/`:603`）都传 `version={attachmentVersion}`，回归测试在 `tests/components/note-viewer.test.tsx`。代码、传参、测试三位一体，无残留。 |
| 2 | 点检查更新弹 `cannot find latest.yml … 404` | ⚠️ **只治好了一半**。2026-10-01 补传 latest.yml 让「检查」这步能用了，但「**下载**」这步从功能上线第一天（v0.7.13，2026-09-30）起就必然 404——只是当时没有人点到过下载。详见下文实锤。 |

**新发现的主问题（本次实锤，影响全部真实用户）**：

| # | 问题 | 一句话根因 |
| --- | --- | --- |
| 3 | 检查更新能看到新版本，点「下载并安装」必然失败 | `latest.yml` 里写的安装包文件名是**连字符版**（`Flash-Summary-Setup-0.7.15.exe`），GitHub Release 上的实际资产是**点号版**（`Flash.Summary.Setup.0.7.15.exe`），electron-updater 按 latest.yml 的名字拼下载 URL → **404**（已 `curl -I` 实测：连字符 URL 404，点号 URL 200） |
| 4 | 下载失败时设置页会印出一长串含内部 URL 与堆栈的英文 | 2026-10-01 只给「检查失败」做了脱敏（`update.ts:51-57`），「下载失败」走的是另一条 catch，`messageOf(e)` 原文直接 emit 到 UI（`update.ts:116` → `use-config-domain.ts:92` → `UpdatePanel` 的 failed 行） |
| 5 | 发布流程有一条**错误结论**在放行这个 bug | `scripts/release.md:67` 写着「latest.yml 里的 path/url 是 electron-builder 按规范化后的名字写的，天然自洽，不要手改」——这句话是错的，正是它让三个版本的发布都漏掉了下载 URL 自检 |

连带事实：`tests/update.test.ts` 全部用例注入**假 updater**，控制器逻辑（含两条失败路径的脱敏）有覆盖，但「产物名 → latest.yml → GitHub 资产名」这条**发布管线**没有任何机械检查——这是 bug 能连过三个版本的根本原因。

**顺带核对过、无问题的项**（如实记账，避免重复排查）：四门禁全绿（lint 0 / typecheck 0 / test 1632 passed / 145 files，2026-10-10 实跑）；smoke 41/41（v0.7.15 发布记录）；CHANGELOG 0.7.15 条目在；release target 与 tag 一致；`origin/master` 与 tag 均已推送（本地 `git status` 曾显示 ahead 9 是过期 tracking ref，`git fetch` 后已同步）；0.7.13/0.7.14 的 latest.yml 同样错但它们永不被用于下载（electron-updater 只从最新 release 取 feed），无需修。

## 1. 问题三根因：下载 URL 为什么必然 404

### 1.1 三个文件名，三套写法（实测证据）

| 环节 | 文件名 | 来源 |
| --- | --- | --- |
| 本地构建产物 | `Flash Summary Setup 0.7.15.exe`（空格） | electron-builder NSIS 默认模板 `${productName} Setup ${version}.${ext}`（`app-builder-lib/out/targets/nsis/NsisTarget.js:103`），package.json 未覆写 `artifactName` |
| `latest.yml` 的 `url`/`path` | `Flash-Summary-Setup-0.7.15.exe`（连字符） | `app-builder-lib/out/platformPackager.js:697` `computeSafeArtifactNameIfNeeded`：GitHub 资产名只允许 `[0-9A-Za-z._-]`，含空格的默认名被转成**连字符版**写进 feed |
| GitHub Release 实际资产 | `Flash.Summary.Setup.0.7.15.exe`（点号） | GitHub 上传时把空格规范化为**点**（`gh api` 实测 + release.md:67 自己也记录了这个行为） |

electron-builder 猜 GitHub 会把空格换成连字符，GitHub 实际换成点——**两边对「安全名」的规范化方式不一致**，feed 从此指着一个不存在的文件。

### 1.2 下载时 URL 怎么拼的（读码证据）

`electron-updater/out/providers/GitHubProvider.js` 的 `resolveFiles`：

```js
resolveFiles(updateInfo) {
  // still replace space to - due to backward compatibility
  return resolveFiles(updateInfo, this.baseUrl, p => this.getBaseDownloadPath(updateInfo.tag, p.replace(/ /g, "-")))
}
getBaseDownloadPath(tag, fileName) {
  return `${this.basePath}/download/${tag}/${fileName}`   // /Andiii208/flash-summary/releases/download/v0.7.15/<latest.yml 里的名字>
}
```

`Provider.resolveFiles` 用 latest.yml 里 `files[0].url` 原样（仅空格→连字符，对本例无操作）拼进下载路径。于是真实请求：

```
GET https://github.com/Andiii208/flash-summary/releases/download/v0.7.15/Flash-Summary-Setup-0.7.15.exe  → 404（实测）
GET https://github.com/Andiii208/flash-summary/releases/download/v0.7.15/Flash.Summary.Setup.0.7.15.exe  → 200（实测）
```

### 1.3 用户侧完整体验（现状推演）

设置页点「检查更新」→ `update:check` 抓最新 release 的 latest.yml（200，版本 0.7.15 > 0.7.14）→ 弹「发现新版本 v0.7.15，现在下载并安装吗？」→ 点「下载并安装」→ `downloadUpdate()` 请求上面的 404 URL → 抛错 → **设置页状态行直接显示原始错误消息**（问题四）——用户看到一长串英文堆栈，更新失败，且下次退出也不会兜底安装（没下载成）。

### 1.4 为什么三关都没拦住

1. **单测关**：`tests/update.test.ts` 注入 `AutoUpdaterLike` 假实现，`checkForUpdates` 直接返回 `{updateInfo:{version}}`——永远碰不到真实下载 URL。
2. **发布清单关**：release.md 只有「latest.yml 这个资产在不在」（v0.7.13 补传时验的就是这条，只证明渠道文件可达），**没有「latest.yml 指向的安装包 URL 可达」这一条**。
3. **人肉验收关**：2026-10-01 修复后的验收项只写到「点一次检查更新」——check 通即视为通过，没人点到下载那一步。

## 2. 修复方案（五批）

### 批 1 — 根因修复：artifactName 显式化为 GitHub 安全名

`package.json` 的 `build` 增加：

```json
"artifactName": "Flash.Summary.Setup.${version}.${ext}"
```

- 效果：本地产物直接就是 `release/Flash.Summary.Setup.0.7.16.exe`（无空格 → `computeSafeArtifactNameIfNeeded` 原样放行 → latest.yml 的 `url`/`path` 也是点号名 → GitHub 资产同名）**三者从此一致**。
- 影响面盘点（已 grep）：`scripts/release.md` 三处空格名路径（§3 产物清单、许可页目视项、`gh release create` 命令行）同步改点号名；`README.md:64` 已按「下载后的名字」写点号名，**无需改**；blockmap 随产物同名，无脚本引用旧名。
- 命名连续性：点号名与 GitHub 上现存全部资产一致，用户手动下载看到的文件名不变。

### 批 2 — 下载失败脱敏（与 check 路径同一把尺）

`src/main/update.ts` 的 `download` catch 不再 `emit({type:'error', message: messageOf(e)})` 原文，改为：

- 新增 `downloadFailureMessage(e)`：404/网络类归一句人话（「暂时无法下载更新：网络或发布服务器无响应，请稍后重试或前往本项目 GitHub 发布页手动下载。」）；
- 原始详情照 `onCheckFailure` 进 logger（装配处 `index.ts:236` 已传，download 路径复用同一注入）；
- 测试：`tests/update.test.ts` 补两例——下载抛 HttpError 404 → UI 收脱敏短句且 logger 收到原文；下载抛非 Error 值不裸抛。

### 批 3 — 发布流程加固（让这类 bug 以后出不了打包机）

`scripts/release.md` 三处改动：

1. **订正第 67 行的错误结论**：改写为「latest.yml 的 path/url 是 electron-builder 对含空格的默认名做 GitHub 安全名转换后的**连字符版**；GitHub 实际上传时空格规范化是**点号**——两者不一致就是下载 404 的根因（2026-10-10 实锤）。artifactName 已显式化为点号名（批 1），本地产物、latest.yml、GitHub 资产三者同名；若再改命名，必须跑下面的下载 URL 自检」。
2. **新增发布自检步骤**（接在「渠道文件必须真的在 release 上」之后）：

   ```bash
   # 从刚上传的 latest.yml 取出 path，拼出下载 URL，必须 200
   url="https://github.com/Andiii208/flash-summary/releases/download/vX.Y.Z/$(grep -m1 '^path:' release/latest.yml | awk '{print $2}')"
   curl -sIL -o /dev/null -w "%{http_code}\n" "$url"   # 期望 200
   ```

   并配一句判据：「200 才算发布完成；404 = feed 指着不存在的资产，检查更新能过、下载必挂」。
3. 文件名三处同步批 1 的点号名。

另加一道**离线机械检查**（进四门禁）：新增测试读 `package.json` 断言 `build.artifactName` 存在且不含空格；若工作区存在 `release/latest.yml`，断言其 `path` 与 artifactName 按当前版本渲染的结果逐字一致（本地没构建过就跳过存在性判断，不许因此假红）。

### 批 4 — 修复已发布的 v0.7.15 feed（止血，需 Andiii 批准后执行）

v0.7.14 用户更新到 0.7.15 必须经过 0.7.15 这一跳，feed 不修则更新链断了 0.7.14 用户。修法（**不动 exe 资产、不删 tag、不重新打包**，与 2026-10-01 v0.7.13 补传 latest.yml 同一性质——只订正 feed 元数据）：

```bash
# 本地把 release/latest.yml 的 path/url 从连字符版改为点号版（其余四行原样），然后：
gh release upload v0.7.15 release/latest.yml --clobber
```

上传后立刻跑批 3 第 2 条的 200 自检闭环。0.7.13/0.7.14 的 latest.yml 同样错但不修（只有最新 release 的 feed 会被下载），在 PROGRESS 记录即可。

### 批 5 — 收尾

PROGRESS.md 记一条（本复核结论 + 五批落地 + 0.7.15 feed 订正）；若 D2 裁为发版则走 `scripts/release.md` 全流程发 v0.7.16（第一次带上下载 URL 自检的发布）。

## 3. 决策项（请 Andiii 裁）

| # | 决策 | 选项 | 推荐 |
| --- | --- | --- | --- |
| D1 | 批 4（修 v0.7.15 release 的 latest.yml）是否现在做 | A. 批准后立即执行（止血，0.7.14 用户恢复更新链）/ B. 不修，等 v0.7.16 发布后自然覆盖（期间 0.7.14 用户只能去页面手动下载） | **A**——零成本（改一个 358 B 的元数据文件），且发 0.7.16 前 0.7.14 用户本就得先经过 0.7.15 |
| D2 | 批 1-3 落地后是否发 v0.7.16 | A. 发（一次收口，新发布管线首次带下载自检）/ B. 只合代码推送，等下个功能版本自然带出 | **A**——版本号只差修订位，且发布流程刚加固，趁热跑一遍全清单最有价值 |
| D3 | artifactName 用点号还是连字符做实际文件名 | A. `Flash.Summary.Setup.${version}.exe`（与 GitHub 现存资产、README 已文档化的下载名一致）/ B. `Flash-Summary-Setup-${version}.exe`（连字符，需改 README 与用户习惯） | **A** |
| D4 | 顺带清理 `release/` 目录三个陈旧安装包（0.7.11/0.7.12/0.7.13，约 480 MB，gitignored） | A. 删 / B. 留 | **A**——已在 GitHub Releases 有档，本地无留存价值 |

## 4. 验收

- 四门禁：`npm run lint && npm run typecheck && npm test`（新增 artifactName 一致性测试 + 下载脱敏两例，测试数只增不减）。
- `npm run build` 后：`release/Flash.Summary.Setup.<v>.exe` 与 `release/latest.yml` 的 `path` 逐字一致（批 3 离线检查的现场版）。
- D2 若裁 A：走完 `scripts/release.md` 全清单，重点是新旧两道自检（渠道文件在 + 下载 URL 200）；`gh release view` 资产三件（exe / blockmap 可选 / latest.yml）。
- D1 若裁 A：`curl -sI` 对 v0.7.15 下载 URL 返回 200 的记录贴进 PROGRESS。
