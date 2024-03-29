# [`@knighted/duel`](https://www.npmjs.com/package/@knighted/duel)

![CI](https://github.com/knightedcodemonkey/duel/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/knightedcodemonkey/duel/branch/main/graph/badge.svg?token=7K74BRLHFy)](https://codecov.io/gh/knightedcodemonkey/duel)
[![NPM version](https://img.shields.io/npm/v/@knighted/duel.svg)](https://www.npmjs.com/package/@knighted/duel)

Tool for building a Node.js [dual package](https://nodejs.org/api/packages.html#dual-commonjses-module-packages) with TypeScript. Supports CommonJS and ES module projects.

## Features

- Bidirectional ESM ↔️ CJS dual builds inferred from the package.json `type`.
- Correctly preserves module systems for `.mts` and `.cts` file extensions.
- Use only one package.json and tsconfig.json.

## Requirements

- Node >= 16.19.0.

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

### Parallel builds

This is experimental, as your mileage may vary based on the size of your `node_modules` directory.

```json
"scripts": {
  "build": "duel --parallel"
}
```

You _might_ reduce your build times, but only if your project has minimal dependencies. This requires first copying your project to a parent directory of `--project` if it exists as a writable folder. Common [gitignored directories for Node.js projects](https://github.com/github/gitignore/blob/main/Node.gitignore) are not copied, with the exception of `node_modules`. See the [notes](#notes) as to why this can't be improved much further. In most cases, you're better off with serial builds.

## Options

The available options are limited, because you should define most of them inside your project's `tsconfig.json` file.

- `--project, -p` The path to the project's configuration file. Defaults to `tsconfig.json`.
- `--pkg-dir, -k` The directory to start looking for a package.json file. Defaults to the cwd.
- `--dirs, -d` Outputs both builds to directories inside of `outDir`. Defaults to `false`.
- `--parallel, -l` Run the builds in parallel. Defaults to `false`.

You can run `duel --help` to get the same info. Below is the output of that:

```console
Usage: duel [options]

Options:
--project, -p [path] 	 Compile the project given the path to its configuration file, or to a folder with a 'tsconfig.json'.
--pkg-dir, -k [path] 	 The directory to start looking for a package.json file. Defaults to cwd.
--dirs, -d 		 Output both builds to directories inside of outDir. [esm, cjs].
--parallel, -l 		 Run the builds in parallel.
--help, -h 		 Print this message.
```

## Gotchas

These are definitely edge cases, and would only really come up if your project mixes file extensions. For example, if you have `.ts` files combined with `.mts`, and/or `.cts`. For most projects, things should just work as expected.

- This is going to work best if your CJS-first project uses file extensions in _relative_ specifiers. This is completely acceptable in CJS projects, and [required in ESM projects](https://nodejs.org/api/esm.html#import-specifiers). This package makes no attempt to rewrite bare specifiers, or remap any relative specifiers to a directory index.

- Unfortunately, TypeScript doesn't really build [dual packages](https://nodejs.org/api/packages.html#dual-commonjses-module-packages) very well in regards to preserving module system by file extension. For instance, there doesn't appear to be a way to convert an arbitrary `.ts` file into another module system, _while also preserving the module system of `.mts` and `.cts` files_, without requiring **multiple** package.json files. In my opinion, the `tsc` compiler is fundamentally broken in this regard, and at best is enforcing usage patterns it shouldn't. This is only mentioned for transparency, `duel` will correct for this and produce files with the module system you would expect based on the file's extension, so that it works with [how Node.js determines module systems](https://nodejs.org/api/packages.html#determining-module-system).

- If doing an `import type` across module systems, i.e. from `.mts` into `.cts`, or vice versa, you might encounter the compilation error ``error TS1452: 'resolution-mode' assertions are only supported when `moduleResolution` is `node16` or `nodenext`.``. This is a [known issue](https://github.com/microsoft/TypeScript/issues/49055) and TypeScript currently suggests installing the nightly build, i.e. `npm i typescript@next`.

- If running `duel` with your project's package.json file open in your editor, you may temporarily see the content replaced. This is because `duel` dynamically creates a new package.json using the `type` necessary for the dual build. Your original package.json will be restored after the build completes.

## Notes

As far as I can tell, `duel` is one (if not the only) way to get a correct dual package build using `tsc` with only **one package.json and tsconfig.json file**, _and also preserving module system by file extension_. Basically, how you expect things to work. The Microsoft backed TypeScript team [keep](https://github.com/microsoft/TypeScript/pull/54546) [talking](https://github.com/microsoft/TypeScript/issues/54593) about dual build support, but their philosophy is mainly one of self-preservation, rather than collaboration. For instance, they continue to [refuse to rewrite specifiers](https://github.com/microsoft/TypeScript/issues/16577). The downside of their decisions, and the fact that `npm` does not support using alternative names for the package.json file, is that `duel` must copy your project
directory before attempting to run the builds in parallel.
