# 第三方组件与许可声明

本文件列出随 **Flash Summary** 安装包分发的第三方组件及其许可，并说明其中 **GPL-3.0** 组件（ffmpeg 与 ffprobe）的合规处置方式。

本软件自身的代码以 [MIT](LICENSE) 许可发布；下列组件的许可各自独立，不因本软件的许可而改变。

- 完整许可文本：本仓库 [`LICENSES/`](LICENSES/) 目录（随安装包一并分发）
- 应用内查看：「设置 → 关于与声明 → 第三方许可」

---

## ⚠ 重要：内置的 ffmpeg / ffprobe 是 GPL-3.0，不是 MIT

安装包内置了 `ffmpeg.exe` 与 `ffprobe.exe` 用于媒体处理（提取音频、抽取关键帧、读取媒体元信息）。二者**都使用 GPL 许可**，这一点与常见的「ffmpeg 是 LGPL」印象不同，需要单独说明。

### 随包分发的二进制

| 项目 | 值 |
|---|---|
| 组件 | ffmpeg（`ffmpeg.exe`） |
| 版本 | ffmpeg 6.1.1 — `essentials_build`（[gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 提供） |
| 许可 | **GPL-3.0-or-later** |
| 为何是 GPL | 该构建启用了 `--enable-gpl --enable-version3`，并**静态链接**了 GPL 组件（如 libx264、libx265），因此整个二进制按 GPL 分发 |
| 获取二进制的上游位置 | [github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1) |
| 完整许可文本 | [`LICENSES/GPL-3.0-or-later.txt`](LICENSES/GPL-3.0-or-later.txt) |

| 项目 | 值 |
|---|---|
| 组件 | ffprobe（`ffprobe.exe`，经 npm 包 `ffprobe-static@3.1.0` 安装） |
| 版本 | ffprobe 4.0.2 |
| 许可 | **GPL-3.0-or-later** |
| 为何是 GPL | 2026-09-28 实测 `ffprobe.exe -version`：构建参数含 `--enable-gpl --enable-version3` 并静态链接 libx264/libx265 等 GPL 组件，因此整个二进制按 GPL 分发（`ffprobe-static` 这个 npm 包自身的脚本代码是 MIT，但**随包分发的是二进制**，按二进制许可声明） |
| 完整许可文本 | [`LICENSES/GPL-3.0-or-later.txt`](LICENSES/GPL-3.0-or-later.txt) |

### ffmpeg 的完整构建配置（用于对应源码）

```
--enable-gpl --enable-version3 --enable-static --disable-w32threads --disable-autodetect
--enable-fontconfig --enable-iconv --enable-gnutls --enable-libxml2 --enable-gmp --enable-bzlib
--enable-lzma --enable-zlib --enable-libsrt --enable-libssh --enable-libzmq --enable-avisynth
--enable-sdl2 --enable-libwebp --enable-libx264 --enable-libx265 --enable-libxvid --enable-libaom
--enable-libopenjpeg --enable-libvpx --enable-mediafoundation --enable-libass --enable-libfreetype
--enable-libfribidi --enable-libharfbuzz --enable-libvidstab --enable-libvmaf --enable-libzimg
--enable-amf --enable-cuda-llvm --enable-cuvid --enable-ffnvcodec --enable-nvdec --enable-nvenc
--enable-dxva2 --enable-d3d11va --enable-libvpl --enable-libgme --enable-libopenmpt
--enable-libopencore-amrwb --enable-libmp3lame --enable-libtheora --enable-libvo-amrwbenc
--enable-libgsm --enable-libopencore-amrnb --enable-libopus --enable-libspeex --enable-libvorbis
--enable-librubberband
```

### 获取 ffmpeg / ffprobe 对应源码（GPL-3.0 §6 书面要约）

ffmpeg（6.1.1）的源码可从下列任一位置获得：

1. 上游官方仓库与发布包：<https://ffmpeg.org/download.html>、<https://git.ffmpeg.org/ffmpeg.git>
2. 本组件所用的二进制发布页（含构建说明）：<https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1>
3. 该构建的构建脚本来源：<https://www.gyan.dev/ffmpeg/builds/>

ffprobe（4.0.2）与 ffmpeg 同属 FFmpeg 项目，源码同样从 <https://ffmpeg.org/download.html> 与 <https://git.ffmpeg.org/ffmpeg.git> 的对应版本（4.0.2）获得；安装它的 npm 包 `ffprobe-static@3.1.0` 的发行信息见其仓库页面。

按上述**构建配置**重新编译对应版本的 ffmpeg，即可得到与本安装包内置二进制功能等价的程序。若你需要其他形式的源码副本，请在仓库的 issue 中提出。

### 为什么本软件自身的 MIT 许可不受影响

本软件**以独立子进程方式调用** ffmpeg（`child_process` 启动 `ffmpeg.exe`，通过文件与标准输入输出交换数据），并未将其以链接方式并入本软件。按 GPL 的通行解释，这属于**独立程序的聚合分发**（mere aggregation），因此：

- ffmpeg 二进制本身**仍然受 GPL-3.0 约束**（我们随附了完整许可文本、构建配置与源码获取途径）；
- 本软件自身的代码**不因此被传染**，继续以 MIT 发布。

---

## 其他随包分发的组件

| 组件 | 用途 | 许可 | 许可文本 |
|---|---|---|---|
| [ffprobe](https://ffmpeg.org/)（`ffprobe.exe`，经 `ffprobe-static` 安装） | 读取媒体元信息 | GPL-3.0-or-later | [`GPL-3.0-or-later.txt`](LICENSES/GPL-3.0-or-later.txt) |
| [Electron](https://www.electronjs.org/) | 桌面应用运行时 | MIT | 见 Electron 官方发行包与 <https://github.com/electron/electron/blob/main/LICENSE> |
| [Preact](https://preactjs.com/) | 渲染层 UI 框架 | MIT | [`preact-MIT.txt`](LICENSES/preact-MIT.txt) |
| [lucide-preact](https://lucide.dev/) | 图标 | ISC | [`lucide-preact-ISC.txt`](LICENSES/lucide-preact-ISC.txt) |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | 本地资料库（SQLite） | MIT | [`better-sqlite3-MIT.txt`](LICENSES/better-sqlite3-MIT.txt) |
| [zod](https://zod.dev/) | 笔记数据结构校验 | MIT | [`zod-MIT.txt`](LICENSES/zod-MIT.txt) |
| [qrcode](https://github.com/soldair/node-qrcode) | 二维码生成（B 站登录） | MIT | [`qrcode-MIT.txt`](LICENSES/qrcode-MIT.txt) |
| [jpeg-js](https://github.com/jpeg-js/jpeg-js) | JPEG 解码（关键帧感知哈希） | BSD-3-Clause | [`jpeg-js-BSD-3-Clause.txt`](LICENSES/jpeg-js-BSD-3-Clause.txt) |
| [pngjs](https://github.com/pngjs/pngjs) | PNG 解码（平台 PPT 页感知哈希；PPT×关键帧视觉融合） | MIT | [`pngjs-MIT.txt`](LICENSES/pngjs-MIT.txt) |
| [KaTeX](https://katex.org/) | 数学公式排版（笔记/讲义里的 LaTeX 渲染，矢量输出） | MIT | [`katex-MIT.txt`](LICENSES/katex-MIT.txt) |
| [LXGW WenKai Screen](https://github.com/lxgw/LxgwWenKai-Screen) | 中文字体 | MIT | [`lxgw-wenkai-screen-webfont-MIT.txt`](LICENSES/lxgw-wenkai-screen-webfont-MIT.txt) |
| [Noto Sans SC](https://fonts.google.com/noto)（via `@fontsource`） | 中文字体 | OFL-1.1 | [`fontsource-noto-sans-sc-OFL-1.1.txt`](LICENSES/fontsource-noto-sans-sc-OFL-1.1.txt) |
| [Noto Serif SC](https://fonts.google.com/noto)（via `@fontsource`） | 中文字体 | OFL-1.1 | [`fontsource-noto-serif-sc-OFL-1.1.txt`](LICENSES/fontsource-noto-serif-sc-OFL-1.1.txt) |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/)（via `@fontsource`） | 等宽字体 | OFL-1.1 | [`fontsource-jetbrains-mono-OFL-1.1.txt`](LICENSES/fontsource-jetbrains-mono-OFL-1.1.txt) |

> 仅用于开发、不随安装包分发的构建期依赖（如 electron-builder、TypeScript、ESLint、vitest）不在本清单内。

---

## 维护约定（给贡献者）

- **新增运行时依赖 → 必须在本文件补一行，并把其许可文本放进 `LICENSES/`。** 这条与 [`AGENTS.md`](AGENTS.md) 的安全红线一起执行。
- 升级 `ffmpeg-static`（或更换媒体二进制）后，**必须**同步更新上文 ffmpeg 的版本、构建配置与来源链接——版本漂移会让本节变成不实陈述。
- 本文件与 `LICENSES/` 随安装包分发（见 `package.json` 的 `build.extraResources`），安装目录内可查。
