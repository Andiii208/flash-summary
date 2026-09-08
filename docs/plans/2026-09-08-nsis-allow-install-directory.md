# 安装包支持自定义安装路径

- 日期：2026-09-08 · 状态：**待批（Andiii）**
- 背景：Andiii 用户实测反馈 0.7.x 安装包安装时**不能自定义安装路径**。本方案 = 根因定位 + 标准改法，纯打包配置改动，不碰任何 TS 代码。

---

## 一、根因（实锤）

`package.json` → `build.nsis` 两行配置锁死了一键安装模式：

| 配置 | 现值 | 效果 |
|---|---|---|
| `oneClick: true` | 一键安装模式 | NSIS **不出现任何向导页**，双击后直接静默安装到 `%LOCALAPPDATA%\Programs\Flash Summary`，用户全程无选择机会 |
| `allowToChangeInstallationDirectory: false` | 向导模式下的目录开关 | 在一键模式下本就不生效；即使将来切向导也明令禁止改目录 |

（`package.json:44-50`，现状：`oneClick: true` + `perMachine: false` + `allowToChangeInstallationDirectory: false`。）

结论：不是 bug，是 electron-builder 一键安装器的固有形态；要给用户选目录，必须切到「向导式安装（assisted installer）」。

## 二、方案（推荐，标准改法）

`build.nsis` 两处改动，其余全部保持：

```jsonc
"nsis": {
  "oneClick": false,                          // 一键模式 → 向导模式：出现语言外默认向导（欢迎→目录→安装→完成）
  "perMachine": false,                        // 不变：默认仍按用户级安装，无需管理员权限
  "allowToChangeInstallationDirectory": true, // 目录页放开编辑，用户可自选安装路径
  "createDesktopShortcut": true,              // 不变
  "createStartMenuShortcut": true             // 不变
}
```

提交：`fix(installer): NSIS 切向导式安装并放开自定义安装路径`，进 0.7.2（0.7.1 测试构建已交付），CHANGELOG 未发布节记一条。

## 三、影响面分析

1. **升级无缝**：向导默认目录仍是 `%LOCALAPPDATA%\Programs\Flash Summary`（electron-builder 检测到已有安装时会预填上次安装位置），老用户一路「下一步」即覆盖升级；升级时多点两下「下一步」是向导模式的固有代价，可接受。
2. **登录态/资料库零风险**：userData 固定在 `%APPDATA%\Flash Summary`（按 productName，与安装位置无关）；改安装目录不影响 DPAPI 密钥与 Library。红线（appId / name / userData / Documents 资料库目录）一处不碰。
3. **权限行为**：默认目录不需要 UAC（per-user 保持）；用户若主动选 `C:\Program Files` 等受保护目录，NSIS 默认 `allowElevation: true` 会弹 UAC 提权，属合理兜底，无需配置。
4. **向导语言**：NSIS 默认按系统 locale 出界面，中文 Windows 显示简体中文向导，无需配置。
5. **完成页**：默认勾选「运行 Flash Summary」，与一键版装完自动启动的行为等价。
6. **快捷方式/卸载**：桌面+开始菜单快捷方式与卸载体验不变；未配 auto-update，无 differentialPackage 牵连。

## 四、验证与走查

- 无代码路径 → 不新增单元测试（现有 720/720 不动），lint/typecheck/test 全过即提交。
- 本地 `npm run dist` 出包后装机走查（可并入 0.7.2 走查清单）：
  1. 安装器出现向导页且为中文；
  2. 目录页可编辑，改到自定义目录（如 `D:\Apps\Flash Summary`）能装成功；
  3. 桌面/开始菜单快捷方式正常，应用可启动、登录态完好；
  4. 在已装 0.7.1 的机器上覆盖安装，默认目录预填旧位置；
  5. 卸载干净（控制面板条目、快捷方式清除）。
- CI 打包流程不变（`npm run dist`）。

## 五、不做的事

- 不加自定义安装器侧栏/头图（assisted 模式用 electron-builder 默认灰白侧栏；想要品牌图后续单独立项）。
- 不加许可协议页、不改 perMachine、不引入 electron-updater。
- 不顺带动任何 UI/笔记链路代码。
