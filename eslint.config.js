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
      'no-use-before-define': 'error',
      'n/no-process-exit': 'off',
      'n/hashbang': [
        'error',
        {
          convertPath: {
            'src/*.js': ['^src/(.+)$', 'dist/esm/$1'],
          },
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
