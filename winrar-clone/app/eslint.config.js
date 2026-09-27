import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'coverage/**', 'vendor/**', 'test/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'scripts/**/*.ts', '*.config.ts', 'test/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': [
        'error',
        {
          paths: ['child_process', 'node:child_process'].map((name) => ({
            name,
            message: 'Start processes only via src/main/engine/spawn.ts.',
          })),
        },
      ],
    },
  },
  {
    // Build scripts may run tools directly.
    files: ['scripts/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // The renderer must never reach Node or Electron APIs directly.
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'electron', 'fs', 'path', 'child_process'],
              message: 'Renderer has no Node access. Use window.api.',
            },
          ],
        },
      ],
    },
  },
);
