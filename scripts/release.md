# 发布清单（SEU Summary）

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

- [ ] 产物生成：`release/SEU Summary Setup <version>.exe` 与 `release/win-unpacked/`。

## 4. asar 抽验（防资产过期事故）

```bash
node scripts/verify-asar.mjs "release/win-unpacked/resources/app.asar" out
```

- [ ] 输出 `asar verification OK`；任何 MISSING / EXTRA / HASH MISMATCH 都必须停止发布。

## 5. 打 tag 与发布

```bash
git tag vX.Y.Z
git push origin master vX.Y.Z
gh release create vX.Y.Z "release/SEU Summary Setup <version>.exe" --title "vX.Y.Z" --notes "<CHANGELOG 摘要>"
```

- [ ] release 资产与 tag 同一提交（`git log --oneline -1` 与 release 的 target commit 一致）。
- [ ] release 页面资产可下载，说明含版本号。

## 6. 收尾

- [ ] `PROGRESS.md` 追加发布记录行。
- [ ] 若发布过程发现问题，禁止“修了再发同一 tag”——必须新提交 + 重新走本清单（必要时删 tag 重打并重新构建）。
