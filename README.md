# [`@knighted/duel`](https://www.npmjs.com/package/@knighted/duel)

![CI](https://github.com/knightedcodemonkey/duel/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/knightedcodemonkey/duel/branch/main/graph/badge.svg?token=7K74BRLHFy)](https://codecov.io/gh/knightedcodemonkey/duel)
[![NPM version](https://img.shields.io/npm/v/@knighted/duel.svg)](https://www.npmjs.com/package/@knighted/duel)

Node.js tool for building a TypeScript dual package.

Inspired by https://github.com/microsoft/TypeScript/issues/49462.

## Requirements

* Node >= 16.19.0.
* TypeScript, `npm i typescript`.
* A `tsconfig.json` with `outDir` defined.

## Example

First, install this package to create the `duel` executable inside your `node_modules/.bin` directory.

```console
user@comp ~ $ npm i @knighted/duel
```

Then, given a `package.json` that defines `"type": "module"` and  a `tsconfig.json` file that looks something like the following:

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

If everything worked, you should have an ESM build inside of `dist` and a CJS build inside of `dist/cjs`. Now you can update your [`exports`](https://nodejs.org/api/packages.html#exports) to match the build output.

It should work similarly for a CJS-first project. Except, your `tsconfig.json` may define `--module` and `--moduleResolution` differently, your package.json file would use `"type": "commonjs"`, and you'd want to pass `--target-extension .mjs`.

See the available [options](#options).


## Options

The available options are limited, because you should define most of them inside your project's `tsconfig.json` file.

* `--project, -p` The path to the project's configuration file. Defaults to `tsconfig.json`.
* `--target-extension, -x` The desired target extension which determines the type of dual build. Defaults to `.cjs`.

You can run `duel --help` to get more info. Below is the output of that:

```console
Usage: duel [options]

Options:
--project, -p 		 Compile the project given the path to its configuration file, or to a folder with a 'tsconfig.json'.
--target-extension, -x 	 Sets the file extension for the dual build. [.cjs,.mjs]
--help, -h 		 Print this message.
```

## Gotchas

These are definitely edge cases, and would only really come up if your project mixes file extensions. For example, if you have `.ts` files combined with `.mts`, and/or `.cts`. For most projects, things should just work as expected.

As far as I can tell, `duel` is one (if not the only) way to get a correct dual package build using `tsc` while only using a single package.json file and tsconfig.json file _and_ preserving module system by file extension. The MicroSoft backed TypeScript team [keep](https://github.com/microsoft/TypeScript/issues/54593) [talking](https://github.com/microsoft/TypeScript/pull/54546) about dual build support, but their philosophy is mainly one of self perseverance, rather than collaboration.

* Unfortunately, TypeScript doesn't really build [dual packages](https://nodejs.org/api/packages.html#dual-commonjses-module-packages) very well in regards to preserving module system by file extension. For instance, there doesn't appear to be a way to convert an arbitrary `.ts` file into another module system, _while also preserving the module system of `.mts` and `.cts` files_. In my opinion, the `tsc` compiler is fundamentally broken in this regard, and at best is enforcing usage patterns it shouldn't. If you want to see one of my extended rants on this, check out this [comment](https://github.com/microsoft/TypeScript/pull/50985#issuecomment-1656991606). This is only mentioned for transparency, `duel` will correct for this and produce files with the module system you would expect based on the files extension, so that it works with [how Node.js determines module systems](https://nodejs.org/api/packages.html#determining-module-system).

* If doing an `import type` across module systems, i.e. from `.mts` into `.cts`, or vice versa, you might encounter the compilation error ``error TS1452: 'resolution-mode' assertions are only supported when `moduleResolution` is `node16` or `nodenext`.``. This is a [known issue](https://github.com/microsoft/TypeScript/issues/49055) and TypeScript currently suggests installing the nightly build, i.e. `npm i typescript@next`.
