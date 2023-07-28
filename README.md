# [`@knighted/duel`](https://www.npmjs.com/package/@knighted/duel)

![CI](https://github.com/knightedcodemonkey/duel/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/knightedcodemonkey/duel/branch/main/graph/badge.svg?token=7K74BRLHFy)](https://codecov.io/gh/knightedcodemonkey/duel)
[![NPM version](https://img.shields.io/npm/v/@knighted/duel.svg)](https://www.npmjs.com/package/@knighted/duel)

Node.js tool for creating a TypeScript dual package.

Early stages of development. Inspired by https://github.com/microsoft/TypeScript/issues/49462.

## Example

Consider a project that is ESM-first, i.e. `"type": "module"` in package.json, that also wants to create a separate CJS build. It might have a tsconfig.json file that looks like the following.

**tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "strict": true,
    "outDir": "dist"
  },
  "include": ["src/*.ts"]
}
```

Running the following will use the tsconfig.json defined above and create a separate CJS build in `dist/cjs`.

```console
user@comp ~ $ duel -p tsconfig.json -x .cjs
```

Now you can update your `exports` in package.json to match the build output.

It should work similarly for a CJS first project. Except, your tsconfig.json would be slightly different and you'd want to pass `-x .mjs`.

## Gotchas

Unfortunately, TypeScript doesn't really understand dual packages very well. For instance, it will **always** create CJS exports when `--module commonjs` is used, even on files with an `.mts` extension. One reference issue is https://github.com/microsoft/TypeScript/issues/54573.
