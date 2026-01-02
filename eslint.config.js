import eslint from '@eslint/js'
import nodePlugin from 'eslint-plugin-n'
import globals from 'globals'

export default [
  eslint.configs.recommended,
  nodePlugin.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 2023,
      globals: {
        ...globals.es2015,
        ...globals.node,
      },
      parserOptions: {
        sourceType: 'module',
      },
    },
    rules: {
      'no-console': 'error',
      'no-shadow': 'error',
      'n/no-process-exit': 'off',
      'n/hashbang': [
        'error',
        {
          convertPath: {
            'src/*.js': ['^src/(.+)$', 'dist/esm/$1'],
          },
        },
      ],
      'n/no-unsupported-features/node-builtins': [
        'error',
        {
          ignores: [
            // No longer experimental with v22.3.0
            'fs/promises.cp',
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.{js,ts}'],
    rules: {
      'n/no-unsupported-features/node-builtins': [
        'error',
        {
          version: '>=22.0.0',
          ignores: [
            // No longer experimental with v22.3.0
            'test.describe',
            // No longer experimental with v24.0.0
            'import.meta.dirname',
          ],
        },
      ],
    },
  },
  {
    files: ['test/unit.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: ['test/__fixtures__/projectRefs/packages/**'],
  },
  {
    ignores: ['test/__fixtures__/**/*.ts'],
  },
]
