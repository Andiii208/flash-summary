import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['out/**', 'node_modules/**', 'dist/**', 'release/**', '.zcode/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node release scripts need node globals; js.configs.recommended would
    // otherwise flag process/console as no-undef. fetch/WebSocket/setTimeout
    // are Node >= 22 runtime globals (smoke-cdp.mjs requires them).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        setTimeout: 'readonly'
      }
    }
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  }
)
