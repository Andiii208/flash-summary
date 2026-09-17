import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  test: {
    // Main-layer tests keep the node environment (real fetch, better-sqlite3);
    // only the component tests get a DOM. projects replaces the deprecated
    // environmentMatchGlobs (vitest 3).
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.{ts,tsx}', '!tests/components/**']
        }
      },
      {
        test: {
          name: 'components',
          environment: 'happy-dom',
          // 批4: happy-dom 不实现 document.compatMode，而 KaTeX 在**模块加载时**
          // 据此判定并永久禁用渲染（见 tests/components/setup.ts）。必须在被测模块
          // import 之前补齐，所以走 setupFiles 而不是测试文件内。
          setupFiles: ['tests/components/setup.ts'],
          include: ['tests/components/**/*.test.{ts,tsx}']
        }
      }
    ]
  }
})
