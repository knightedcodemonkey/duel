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
]
