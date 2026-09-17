import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import { resolve } from 'path'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'

/**
 * @fontsource gives every @font-face a woff2 url followed by a legacy woff url.
 * Chromium always takes the woff2, but Vite emits whatever url() it sees in the
 * CSS — 500 woff files (~17 MB) that can never be requested. Dropping the legacy
 * url before Vite rewrites them keeps the files out of the build entirely.
 *
 * 批4 (plan 2026-09-17 note-quality upgrade): KaTeX 引入公式渲染，它自带的字体是
 * woff2 + woff + **ttf** 三份（60 个文件 / 1.2MB）。原实现的门是
 * `id.includes('@fontsource')`、正则也只剥 `.woff`——KaTeX 的 CSS 一条都过不了，
 * 不扩展就等于把 2026-09-14 刚省下的字体体积又还回去。这里改成同时剥 woff 与
 * ttf，只留 Chromium 真正会取的 woff2。
 */
function dropLegacyWoff(): Plugin {
  return {
    name: 'drop-legacy-woff',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('.css')) return null
      if (!id.includes('@fontsource') && !id.includes('katex')) return null
      const stripped = source.replace(/,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\(['"](?:woff|truetype)['"]\)/g, '')
      return stripped === source ? null : { code: stripped, map: null }
    }
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['better-sqlite3'],
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [dropLegacyWoff(), preact(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
