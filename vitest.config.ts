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
          include: ['tests/components/**/*.test.tsx']
        }
      }
    ]
  }
})
