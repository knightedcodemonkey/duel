# [`@knighted/duel`](https://www.npmjs.com/package/@knighted/duel)

![CI](https://github.com/knightedcodemonkey/duel/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/knightedcodemonkey/duel/branch/main/graph/badge.svg?token=7K74BRLHFy)](https://codecov.io/gh/knightedcodemonkey/duel)
[![NPM version](https://img.shields.io/npm/v/@knighted/duel.svg)](https://www.npmjs.com/package/@knighted/duel)

Tool for building a Node.js [dual package](https://nodejs.org/api/packages.html#dual-commonjses-module-packages) with TypeScript. Supports CommonJS and ES module projects.

## Features

- Bidirectional ESM ↔️ CJS dual builds inferred from the package.json `type`.
- Correctly preserves module systems for `.mts` and `.cts` file extensions.
- No extra configuration files needed, uses `package.json` and `tsconfig.json` files.
- Transforms the [differences between ES modules and CommonJS](https://nodejs.org/api/esm.html#differences-between-es-modules-and-commonjs).
- Works with monorepos.


## Requirements

- Node >= 20.11.0

## Example

First, install this package to create the `duel` executable inside your `node_modules/.bin` directory.

```console
user@comp ~ $ npm i @knighted/duel --save-dev
```

Then, given a `package.json` that defines `"type": "module"` and a `tsconfig.json` file that looks something like the following:

```json
{
  "compilerOptions": {
    "declaration": true,
    "module": "NodeNext",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

You can create an ES module build for the project defined by the above configuration, **and also a dual CJS build** by defining the following npm run script in your `package.json`:

```json
"scripts": {
  "build": "duel"
}
```

And then running it:

```console
user@comp ~ $ npm run build
```

If everything worked, you should have an ESM build inside of `dist` and a CJS build inside of `dist/cjs`. Now you can update your [`exports`](https://nodejs.org/api/packages.html#exports) to match the build output.

It should work similarly for a CJS-first project. Except, your package.json file would use `"type": "commonjs"` and the dual build directory is in `dist/esm`.

### Output directories

If you prefer to have both builds in directories inside of your defined `outDir`, you can use the `--dirs` option.

```json
"scripts": {
  "build": "duel --dirs"
}
```

Assuming an `outDir` of `dist`, running the above will create `dist/esm` and `dist/cjs` directories.

### Module transforms

TypeScript will throw compiler errors when using `import.meta` globals while targeting a CommonJS dual build, but _will not_ throw compiler errors when the inverse is true, i.e. using CommonJS globals (`__filename`, `__dirname`, etc.) while targeting an ES module dual build. There is an [open issue](https://github.com/microsoft/TypeScript/issues/58658) regarding this unexpected behavior. You can use the `--modules` option to have the [differences between ES modules and CommonJS](https://nodejs.org/api/esm.html#differences-between-es-modules-and-commonjs) transformed by `duel` prior to running compilation with `tsc` so that there are no compilation or runtime errors.

Note, there is a slight performance penalty since your project needs to be copied first to run the transforms before compiling with `tsc`.

```json
"scripts": {
  "build": "duel --modules"
}
```

This feature is still a work in progress regarding transforming `exports` when targeting an ES module build (relies on [`@knighted/module`](https://github.com/knightedcodemonkey/module)).

## Options

The available options are limited, because you should define most of them inside your project's `tsconfig.json` file.

- `--project, -p` The path to the project's configuration file. Defaults to `tsconfig.json`.
- `--pkg-dir, -k` The directory to start looking for a package.json file. Defaults to the cwd.
- `--modules, -m` Transform module globals for dual build target. Defaults to false.
- `--dirs, -d` Outputs both builds to directories inside of `outDir`. Defaults to `false`.

You can run `duel --help` to get the same info. Below is the output of that:

```console
Usage: duel [options]

Options:
--project, -p [path] 	 Compile the project given the path to its configuration file, or to a folder with a 'tsconfig.json'.
--pkg-dir, -k [path] 	 The directory to start looking for a package.json file. Defaults to cwd.
--modules, -m 		 Transform module globals for dual build target. Defaults to false.
--dirs, -d 		 Output both builds to directories inside of outDir. [esm, cjs].
--help, -h 		 Print this message.
```

## Gotchas

These are definitely edge cases, and would only really come up if your project mixes file extensions. For example, if you have `.ts` files combined with `.mts`, and/or `.cts`. For most projects, things should just work as expected.

- This is going to work best if your CJS-first project uses file extensions in _relative_ specifiers. This is completely acceptable in CJS projects, and [required in ESM projects](https://nodejs.org/api/esm.html#import-specifiers). This package makes no attempt to rewrite bare specifiers, or remap any relative specifiers to a directory index.

- Unfortunately, TypeScript doesn't really build [dual packages](https://nodejs.org/api/packages.html#dual-commonjses-module-packages) very well. One instance of unexpected behavior is when the compiler throws errors for ES module globals when running a dual CJS build, but not for the inverse case, despite both causing runtime errors in Node.js. See the [open issue](https://github.com/microsoft/TypeScript/issues/58658). You can circumvent this with `duel` by using the `--modules` option if your project uses module globals such as `import.meta` properties or `__dirname`, `__filename`, etc. in a CommonJS project.

- If doing an `import type` across module systems, i.e. from `.mts` into `.cts`, or vice versa, you might encounter the compilation error ``error TS1452: 'resolution-mode' assertions are only supported when `moduleResolution` is `node16` or `nodenext`.``. This is a [known issue](https://github.com/microsoft/TypeScript/issues/49055) and TypeScript currently suggests installing the nightly build, i.e. `npm i typescript@next`.

- If running `duel` with your project's package.json file open in your editor, you may temporarily see the content replaced. This is because `duel` dynamically creates a new package.json using the `type` necessary for the dual build. Your original package.json will be restored after the build completes.

## Notes

As far as I can tell, `duel` is one (if not the only) way to get a correct dual package build using `tsc` without requiring multiple `tsconfig.json` files or extra configuration. The Microsoft backed TypeScript team [keep](https://github.com/microsoft/TypeScript/pull/54546) [talking](https://github.com/microsoft/TypeScript/issues/54593) about dual build support, but they continue to [refuse to rewrite specifiers](https://github.com/microsoft/TypeScript/issues/16577).

Fortunately, Node.js has added `--experimental-require-module` so that you can [`require()` ES modules](https://nodejs.org/api/esm.html#require) if they don't use top level await, which sets the stage for possibly no longer requiring dual builds.
