import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Main-layer tests keep the node environment (real fetch, better-sqlite3);
    // only the component tests get a DOM.
    environment: 'node',
    environmentMatchGlobs: [['tests/components/**', 'happy-dom']]
  }
})
