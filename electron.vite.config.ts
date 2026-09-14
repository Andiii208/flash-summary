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
 */
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
