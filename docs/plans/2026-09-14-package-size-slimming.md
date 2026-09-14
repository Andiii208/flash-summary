# 安装包体积精简：307.7MB → 159.2MB（实测 -48.3%）

- 日期：2026-09-14
- 基线：v0.7.5 `Flash Summary Setup 0.7.5.exe` = 307,709,747 B
- 结果：**159,164,522 B（-148,545,225 B，-48.3%）**，已实跑打包验证
- 性质：纯打包配置 + 一个构建期 Vite 插件。**零业务代码改动、零功能删减**

---

## 1. 实测结果

| 指标 | 基线 | 现在 | 变化 |
|---|---|---|---|
| **Setup.exe** | 307,709,747 B | **159,164,522 B** | **-48.3%** |
| `win-unpacked/` 解压后 | ~1,221 MB | **480 MB** | -61% |
| `resources/app.asar` | 59.1 MB | **20.9 MB** | -65% |
| `resources/app.asar.unpacked` | 451.1 MB | **2.0 MB** | -99.6% |
| `locales/` | 48.4 MB（55 个） | **1.14 MB（2 个）** | -97.7% |
| `out/renderer/assets` | 38 MB（500 个 `.woff`） | **21 MB（0 个 `.woff`）** | -45% |

体积去向（现在）：Electron 主二进制 233MB + 实际使用的 ffmpeg/ffprobe 139MB + asar 21MB +
`dxcompiler.dll` 25MB + `LICENSES.chromium.html` 19.5MB（压缩后仅 2MB）+ 其余运行时必需件。
**这 159MB 里已经没有"可以随手删掉"的东西了。**

---

## 2. 关键机制发现（踩过的坑，务必记住）

精简 node_modules 的直觉做法在 electron-builder 里**是无效的**。实测确认了三条规则：

### 2.1 不显式排除时，production dependencies 是**全量**拷贝的

`app.asar.unpacked` 里躺着 451MB，根因在此。`computeNodeModuleFileSets` 只有在
`build.files` 里存在 `!` 模式时才构造过滤器；**一个 `!` 模式都没有时 filter 为 `null`，
包目录被原样整包拷贝**（包括 `ffprobe-static` 的 6 个平台二进制、better-sqlite3 的 SQLite C 源码）。

### 2.2 排除模式的路径基准是**应用目录**，不是包目录

`app-builder-lib/out/util/filter.js` 的 `getRelativePath()`：

```js
let relative = stat.moduleFullFilePath || file.substring(srcWithEndSlash.length);
```

`NodeModuleCopyHelper` 会先给 stat 挂上 `moduleFullFilePath`（= `node_modules/<pkg>/<相对路径>`），
于是过滤器看到的路径**总是相对于应用根目录**。结论：

| 写法 | 是否生效 | 说明 |
|---|---|---|
| `!node_modules/better-sqlite3/deps/**` | ✅ 生效 | **正确写法** |
| `!deps/**` | ❌ 无效 | 误以为是包内相对路径，实际匹配不上 |
| 直接把包移出 `dependencies` | ✅ 生效 | 最彻底，包根本不会被收集 |

> 本次复查中一度把正确写法改成了 `!deps/**`，打包后 `identified module ... filesCount=76`
> 暴露了问题——**这个坑只能靠实跑打包验证，读代码推不出来**。

### 2.3 `extraResources` 与 `dependencies` 无关

`extraResources` 走 `getFileMatchers(config, "extraResources", ...)`，是独立的文件拷贝，
不经过依赖收集。所以 `ffmpeg-static` / `ffprobe-static` 移出 `dependencies` 后，
`resources/ffmpeg/{ffmpeg,ffprobe}.exe` **照常产出**（已实测确认文件在位）。

---

## 3. 四处改动

### 改动 1 — 依赖归位：把"只用于构建"的包移出 `dependencies`

**实测收益：依赖收集从 11 个包降到 3 个**（`electron-builder` 日志 `depCount=3`）。

main/preload 被 bundle 成单文件 cjs（`electron.vite.config.ts` 只 external 了 `better-sqlite3`），
renderer 也是 bundle 的。实测 `out/main/index.cjs` 里运行时外部 `require` 只有
`better-sqlite3`、`jpeg-js`、`ffmpeg-static`、`ffprobe-static` 四个。

```diff
 dependencies: {
-  "ffmpeg-static", "ffprobe-static", "lucide-preact", "preact", "qrcode", "zod",
   "better-sqlite3", "jpeg-js"
 }
 devDependencies: { + 上述六个包 }
```

- `zod` / `qrcode` / `preact` / `lucide-preact`：已被 bundle 内联，node_modules 副本是纯冗余。
- `ffmpeg-static` / `ffprobe-static`：运行时二进制由 `extraResources` 提供，
  包本体只在构建期用于取源文件；dev 模式 `require()` 仍走 devDependencies。

### 改动 2 — 裁 `better-sqlite3` 到 Windows 实际所需

**实测：`app.asar.unpacked` 从 26.8 MB → 2.0 MB。**

运行时只加载 `prebuilds/win32-x64.node`（加载逻辑见 `lib/binding.js` 的 `getPrebuildPath()`），
`deps/` 是只在从源码编译时使用的 SQLite C 源码。`build.files` 增加（§2.2 的正确写法）：

```json
"!node_modules/better-sqlite3/deps/**",
"!node_modules/better-sqlite3/src/**",
"!node_modules/better-sqlite3/build/**",
"!node_modules/better-sqlite3/prebuilds/darwin-arm64.node",
… 其余 6 个非 win32-x64 平台各一行（显式列出，不用 glob 扩展，避免匹配歧义）
```

另外附带两条防回归排除（这两个包已移出 `dependencies`，加排除是双保险）：

```json
"!node_modules/ffmpeg-static/**",
"!node_modules/ffprobe-static/**"
```

保留了 `lib/` 下各平台的 JS 加载器（每个几百字节），删它们没有收益却可能踩到 `binding.js` 的 require 链。

### 改动 3 — 只带中英文语言包

**实测：locales 48.4 MB → 1.14 MB。**

```json
"electronLanguages": ["zh-CN", "en-US"]
```

保留 `en-US` 是给 Electron 原生对话框/错误信息留英文兜底，比只留 zh-CN 稳妥。

### 改动 4 — 剥掉永远不会被加载的 `.woff`

**实测：500 个 woff → 0 个，`out/renderer/assets` 38 MB → 21 MB。**

`@fontsource/*/[weight].css` 的每条 `@font-face` 都声明两个 url：

```css
src: url(./files/x.woff2) format('woff2'), url(./files/x.woff) format('woff');
```

Chromium（Electron 44 = Chromium 13x）永远取 woff2，但 Vite 会把 CSS 里出现的
每个 `url()` 都 emit 成文件。woff 是**未压缩**格式，NSIS 也压不动它，所以这 17MB 是实打实进安装包。

实现：`electron.vite.config.ts` 里加一个 `enforce: 'pre'` 的插件，
在 Vite 处理 url 之前把 legacy woff 的 url 段从 CSS 里剥掉：

```ts
function dropLegacyWoff(): Plugin {
  return {
    name: 'drop-legacy-woff',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('@fontsource') || !id.includes('.css')) return null
      const stripped = source.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, '')
      return stripped === source ? null : { code: stripped, map: null }
    }
  }
}
```

只作用于 `@fontsource` 的 CSS；`lxgw-wenkai-screen-webfont` 本来就只用 woff2，不受影响。
字体族定义、`main.tsx` 的 import、视觉设计全部未动。

---

## 4. 验证记录（全部实跑）

| 门禁 | 结果 |
|---|---|
| `npm run lint` | 0 退出 |
| `npm run typecheck` | 0 退出 |
| `npm test` | **898 / 898 通过（93 文件）** |
| `npm run build` | 0 退出 |
| `node scripts/verify-asar.mjs release/win-unpacked/resources/app.asar out` | `asar verification OK: 601 files … (sha256)` |
| `node scripts/smoke-cdp.mjs` | **SMOKE PASSED 32/32** |
| `npx electron-builder --win nsis` | 0 退出，Setup 159,164,522 B |

冒烟里的两条关键断言直接覆盖了本次改动的高危面：

- `L4 app.db created in isolated library` — better-sqlite3 裁剪后数据库仍能创建
- `L4 all ten migrations applied — schema_migrations rows 10` — 迁移链完整

功能面人工核对（打包产物内）：`resources/ffmpeg/{ffmpeg,ffprobe}.exe` 在位、
`resources/legal/LICENSES/` 全部许可文本在位、`locales/` 只含 zh-CN + en-US、
`better-sqlite3/lib/` + `prebuilds/win32-x64.node` 在位。

**仍需真机走查**（打包与冒烟都覆盖不到）：下载真实课次 → 提取音频 → 生成笔记；
B 站扫码导入；中文字体渲染目视；设置 → 关于与声明页可读。

---

## 5. 剩余待做（未纳入本次改动）

1. **`out/tsbuildcache-*/` 被打进 asar**（0.28 MB）。
   `tsconfig.node.json` / `tsconfig.web.json` 的 `outDir` 指向 `./out/tsbuildcache-*`，
   落在 `files: ["out/**"]` 范围内。改法：`outDir` 迁到 `node_modules/.cache/tsbuild-*`
   （`node_modules` 已被 gitignore，也不再污染 `out/`）。收益极小，属整洁性问题。
2. **体积门禁脚本**（防回归）。建议新增 `scripts/verify-package-size.mjs`，对
   `release/win-unpacked` 断言：`app.asar.unpacked` < 10 MB、`locales/*.pak` ≤ 3 个、
   `app.asar` < 30 MB、`.woff` 文件数为 0，并**正向断言** `resources/ffmpeg/*.exe`
   与 `resources/legal/LICENSES/` 必须存在（防止将来"精简过头"把功能砍掉）。
   接进 `package.json` 的 `verify:package`，并写进 `scripts/release.md` 第 4 节。

---

## 6. 约束与红线

**本次改动的隐含约束**（必须写进 `scripts/release.md`）：

- `ffmpeg-static` / `ffprobe-static` 现在在 `devDependencies`，但 `extraResources`
  仍从 `node_modules/` 取源文件。因此**打包机必须安装 devDependencies**——
  `npm ci --omit=dev` 之后跑 `npm run dist` 会在 `extraResources` 阶段失败。
  （CI 用 `npm ci`，不受影响。）

**不动的**：

- `appId` / `name` / `productName` / userData 目录 —— 改了丢登录态与已加密的 Provider 密钥。
- `resources/legal/**` —— 声明层，AGENTS.md 红线。
- `LICENSES.chromium.html` —— 许可义务，19.5MB 未压缩但 gzip 后仅 2.0MB。
- `icudtl.dat` / `resources.pak` / `chrome_*.pak` / `v8_context_snapshot.bin` —— 运行时必需。
- `dxcompiler.dll`（25MB）/ `vk_swiftshader.dll`（5.4MB）—— 图形栈兜底，删了在少见的
  显卡环境下会白屏，收益/风险不划算。

**不采用**：

- 降级 Electron 换体积（Electron 28 比 44 小约 60MB）—— 丢安全补丁，得不偿失。
- 字体子集化裁剪 `noto-*` —— 笔记内容含生僻字时会出现回退错乱，风险高于收益。

---

## 7. 可选进一步（需单独裁决，本次不做）

**换 FFmpeg 二进制**：预计再省约 30–35 MB（Setup 约 125–130 MB）。
当前 `resources/ffmpeg/` 两个二进制 139.1 MB，是 gyan.dev 的 `essentials_build`，
`--enable-gpl --enable-version3` 且静态链接 libx264/libx265。

而代码实际只用三种调用（`src/main/media/ffmpeg.ts`）：`-vn -ar 16000 -f wav`（抽音频给 ASR）、
`-c copy`（HLS remux 合并）、`probeMedia` / `hasAudioStream`（ffprobe）。**用不到任何编码器。**

- 换 **LGPL 构建**（去掉 x264/x265）：体积更小，且**许可从 GPL-3.0 变宽松**，
  可卸掉现在为 GPL 二进制所做的整套合规处置。
- 去掉 **ffprobe**（60.1MB）：用 ffmpeg 的 stderr 输出代替 `-show_entries stream=index`。

两者都是**供应链变更**，需重走 AGENTS.md 的「同步 THIRD-PARTY-NOTICES + 更新 LICENSES/
+ 更新版本与构建配置与来源链接」，并重新验证真实课次的编解码兼容性
（含已知的「CDN 对无 Referer 的 ffmpeg 返回 403」那条坑）。

---

## 8. 附带发现（不属本方案，仅记录）

`release/` 累积了 0.1.0 → 0.7.5 共约 14 个历史安装包，**占本机 4.29 GB**。
已 gitignore，不影响仓库与分发。是否清理请 Andiii 裁决（历史上 0.7.2 曾于 2026-09-12 经批准删除）。
