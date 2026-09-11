/**
 * 声明批3（plan 2026-09-11 compliance-disclosure）: the disclosure documents the
 * app shows under «设置 → 关于与声明».
 *
 * 用 `?raw` 在**构建期**内联，而不是运行时读盘：
 *  - 开发版与安装版拿到的一定是同一份文本（没有 resourcesPath / asar 的分叉要处理）；
 *  - 文本成为构建产物的一部分——改了文件不重新构建，界面与随包文件不可能不一致。
 *
 * 唯一权威仍是仓库根的那两个文件；这里只是把它们搬进 UI，不复制内容。
 */
import disclaimerRaw from '../../DISCLAIMER.md?raw'
import noticesRaw from '../../THIRD-PARTY-NOTICES.md?raw'

/** 使用须知与免责声明全文（九条）。 */
export const DISCLAIMER_FULL_TEXT = disclaimerRaw

/** 第三方组件与许可声明（含内置 ffmpeg 的 GPL-3.0 说明与源码获取途径）。 */
export const THIRD_PARTY_NOTICES_TEXT = noticesRaw
