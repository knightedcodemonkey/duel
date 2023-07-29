# [`@knighted/duel`](https://www.npmjs.com/package/@knighted/duel)

![CI](https://github.com/knightedcodemonkey/duel/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/knightedcodemonkey/duel/branch/main/graph/badge.svg?token=7K74BRLHFy)](https://codecov.io/gh/knightedcodemonkey/duel)
[![NPM version](https://img.shields.io/npm/v/@knighted/duel.svg)](https://www.npmjs.com/package/@knighted/duel)

Node.js tool for creating a TypeScript dual package.

Early stages of development. Inspired by https://github.com/microsoft/TypeScript/issues/49462.

## Requirements

* Node >= 16.19.0.
* TypeScript, `npm i typescript`.

## Example

First, install the package to create the `duel` executable inside your `node_modules/.bin` directory.

```console
user@comp ~ $ npm i @knighted/duel
```

Then, given a `package.json` that defines `"type": "module"` and  a `tsconfig.json` file that looks like the following:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "strict": true,
  },
  "include": ["src"]
}
```

You can create a build for the project defined by the above configuration, **and also a separate dual CJS build** by defining the following npm run script in your `package.json`:

```json
"scripts": {
  "build": "duel"
}
```

And then running it:

```console
user@comp ~ $ npm run build
```

If everything worked, you should have an ESM build inside of `dist` and a CJS build inside of `dist/cjs`. Now you can update your `exports` in package.json to match the build output.

It should work similarly for a CJS first project. Except, your `tsconfig.json` would define `--module` and `--moduleResolution` differently, and you'd want to pass `-x .mjs`.

See the available [options](#options).


## Options

The available options are limited, because you should define most of them inside your project's `tsconfig.json` file.

* `--project, -p` The path to the project's configuration file. Defaults to `tsconfig.json`.
* `--target-extension, -x` The desired target extension which determines the type of dual build. Defaults to `.cjs`.

You can run `duel --help` to get more info. Below is the output of that:

```console
Usage: duel [options]

Options:
--project, -p 			 Compile the project given the path to its configuration file, or to a folder with a 'tsconfig.json'.
--target-extension, -x 		 Sets the file extension for the dual build. [.cjs,.mjs]
--help, -h 			 Print this message.
```

## Gotchas

* Unfortunately, TypeScript doesn't really understand dual packages very well. For instance, it will **always** create CJS exports when `--module commonjs` is used, even on files with an `.mts` extension. One reference issue is https://github.com/microsoft/TypeScript/issues/54573. If you use `.mts` extensions to enforce an ESM module system, this might break in the corresponding dual CJS build.
* If targeting a dual CJS build, and you are using [top level `await`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await#top_level_await), you will most likely encounter the compilation error `error TS1378: Top-level 'await' expressions are only allowed when the 'module' option is set to 'es2022', 'esnext', 'system', 'node16', or 'nodenext', and the 'target' option is set to 'es2017' or higher.` during the CJS build. This is because `duel` creates a temporary `tsconfig.json` from your original and overwrites the `--module` and `--moduleResolution` based on the provided `--target-ext`.
* If doing an `import type` across module systems, i.e. from `.mts` into `.cts`, or vice versa, you might encounter the compilation error ``error TS1452: 'resolution-mode' assertions are only supported when `moduleResolution` is `node16` or `nodenext`.``. This is a [known issue](https://github.com/microsoft/TypeScript/issues/49055) and TypeScript currently suggests installing the nightly build, i.e. `npm i typescript@next`.
