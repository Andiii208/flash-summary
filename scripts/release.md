# 发布清单（Flash Summary）

> 每次发布必须逐条执行并勾选。教训见 CHANGELOG 0.1.1：**发布资产必须在打 tag 的同一提交上构建，发布前用 asar 抽验包内产物**。

## 1. 前置门禁（全绿才可继续）

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

- [ ] 四条门禁 0 退出；测试数相对上一版本只增不减。
- [ ] `git status` 干净（无未提交文件）。
- [ ] CI（windows-latest 全量测试）对当前提交为 success。

## 2. 版本与文档同步

- [ ] `package.json` `version` 升级（如 0.2.0）。
- [ ] `CHANGELOG.md` 增加本版本条目（Keep a Changelog 格式）。
- [ ] `README.md` 与代码事实一致（功能列表、IPC/设置项）。
- [ ] `PROGRESS.md` 记录本阶段结论与提交号。

以上变更在**同一提交**内完成（`docs: release vX.Y.Z` 或 `chore(release): ...`）。

## 3. 构建（在将要打 tag 的同一提交上）

```bash
npm run dist
```

- [ ] 产物生成：`release/Flash.Summary.Setup.<version>.exe`、`release/win-unpacked/` 与 **`release/latest.yml`**。latest.yml 由 electron-builder 与 exe 同次构建生成（版本号 / `path` / `sha512` / `size` 四项），是 electron-updater 的 feed 渠道文件——**漏传它，应用内「检查更新」必然 404**（2026-09-30 v0.7.13 实锤：Release 只传了 exe，检查更新报 `Cannot find latest.yml ... 404`）。文件名必须**正好** `latest.yml`，不要改。产物名由 `package.json` 的 `build.artifactName`（`Flash.Summary.Setup.${version}.${ext}`）钉死——**不要改回含空格的默认名**，原因见 §5 的「资产名规范化」条。
- [ ] **目视安装器许可页**（`./release/Flash.Summary.Setup.<version>.exe` 打开看一眼，看完点「取消」——不点「我同意」不会写任何东西）：正文必须是**可读中文**。编码不对时 NSIS 会把 UTF-8 当 CP936 读，整屏乱码（2026-09-11 0.7.3 实锤：`build/installer-license.txt` 缺 UTF-8 BOM）。**这一步代码层面查不出来**，只能看。

## 4. asar 抽验（防资产过期事故）

```bash
node scripts/verify-asar.mjs "release/win-unpacked/resources/app.asar" out
```

- [ ] 输出 `asar verification OK`；任何 MISSING / EXTRA / HASH MISMATCH 都必须停止发布。

## 4.5 打包产物冒烟（验安装版真实加载路径）

```bash
node scripts/smoke-cdp.mjs --packaged
```

- [ ] 输出 `SMOKE PASSED: 40/40`（2026-09-28 v0.7.12 实测；计数随断言集增长，以实跑输出为准）。这一步与 `npm run smoke` 的区别：它启动的是
  `release/win-unpacked/Flash Summary.exe`（安装版的加载路径，better-sqlite3 来自
  `app.asar.unpacked`），而不是开发构建。0.7.5 起列为发布前必跑。

## 5. 打 tag 与发布

```bash
git tag vX.Y.Z
git push origin master vX.Y.Z
gh release create vX.Y.Z "release/Flash.Summary.Setup.<version>.exe" release/latest.yml --title "vX.Y.Z" --notes "<CHANGELOG 摘要>"
```

- [ ] release 资产与 tag 同一提交（`git log --oneline -1` 与 release 的 target commit 一致）。
- [ ] release 页面资产可下载，说明含版本号。
- [ ] **渠道文件必须真的在 release 上**（发布后立刻只读自检，没有这行输出就是发布未完成——检查更新会 404）：

  ```bash
  gh api repos/Andiii208/flash-summary/releases/tags/vX.Y.Z --jq '.assets[].name' | grep -x latest.yml
  ```

- [ ] **latest.yml 指向的安装包 URL 必须可达（200）**——这条 2026-10-10 才补上，此前三个版本（v0.7.13/0.7.14/0.7.15）全倒在它下面：渠道文件在、版本比对通，用户点「下载并安装」却必然失败。用刚上传的 latest.yml 里的 `path` 拼出真实下载 URL 打一发：

  ```bash
  url="https://github.com/Andiii208/flash-summary/releases/download/vX.Y.Z/$(grep -m1 '^path:' release/latest.yml | awk '{print $2}')"
  curl -sIL -o /dev/null -w "%{http_code}\n" "$url"   # 必须 200；404 = feed 指着不存在的资产
  ```

- [ ] **资产名规范化（2026-10-10 订正，旧结论是错的）**：GitHub 上传时会把资产名里的**空格换成点**（`Flash Summary Setup 0.7.3.exe` → `Flash.Summary.Setup.0.7.3.exe`）；而 electron-builder 写进 latest.yml 的 `path`/`url` 走的是另一套规范化——含空格的默认产物名被 `computeSafeArtifactNameIfNeeded` 换成**连字符**（`Flash-Summary-Setup-0.7.15.exe`）。**两边不一致，feed 从此指着一个不存在的文件，下载必 404**（2026-10-10 实锤：`curl -I` 连字符 URL 404、点号 URL 200；v0.7.13-0.7.15 三个 release 的 latest.yml 全错）。修法= `build.artifactName` 显式写成无空格的点号名，让「本地产物 = latest.yml path = GitHub 资产」三者同名；上面那条 URL 自检就是盯这件事的机械闸门。README 的「安装」一节按**下载后的名字**写（2026-09-11 已对齐，点号名不变）。
- [ ] 万一漏传 latest.yml（tag 已打、包内容不变）：**不必删 tag 重发**——`gh release upload vX.Y.Z release/latest.yml` 追加即可（2026-10-01 v0.7.13 补传实测：资产与内容一致）。若漏传的是**修正版 latest.yml**（如 2026-10-10 修 v0.7.15 的连字符名），加 `--clobber` 覆盖，并补跑上面那条 URL 200 自检。⚠️ `gh release upload` **按本地文件名落资产名**——本地文件不叫 `latest.yml` 就会传出一个新资产（`--clobber` 只替换同名资产），完事必须 `gh api … --jq '.assets[].name'` 核对资产清单正好是 exe + latest.yml 两件，多一件删一件（`gh api -X DELETE repos/Andiii208/flash-summary/releases/assets/<id>`）。

## 6. 收尾

- [ ] `PROGRESS.md` 追加发布记录行。
- [ ] 若发布过程发现问题，禁止“修了再发同一 tag”——必须新提交 + 重新走本清单（必要时删 tag 重打并重新构建）。
