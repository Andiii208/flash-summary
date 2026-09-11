/**
 * 声明批3: Vite `?raw` 导入的模块声明。
 *
 * 随包分发的声明文档（DISCLAIMER.md / THIRD-PARTY-NOTICES.md）在**构建期**被内联
 * 成字符串，所以需要给 TS 一个 `*?raw` 的模块形状。tsconfig.web.json 的
 * `types: []` 不含 vite/client，因此这里显式声明比引入一整套 Vite 类型更省。
 */
declare module '*?raw' {
  const content: string
  export default content
}

/** 声明批6: bundled image assets (the feedback QR) — Vite returns the final URL. */
declare module '*.png' {
  const url: string
  export default url
}
