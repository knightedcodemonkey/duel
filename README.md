# [`@knighted/duel`](https://www.npmjs.com/package/@knighted/duel)

![CI](https://github.com/knightedcodemonkey/duel/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/knightedcodemonkey/duel/branch/main/graph/badge.svg?token=7K74BRLHFy)](https://codecov.io/gh/knightedcodemonkey/duel)
[![NPM version](https://img.shields.io/npm/v/@knighted/duel.svg)](https://www.npmjs.com/package/@knighted/duel)

Node.js tool for building a TypeScript dual package.

## Features

* Bidirectional ESM <--> CJS dual builds inferred from the package.json `type`.
* Correctly preserves module systems for `.mts` and `.cts` file extensions.
* Only one package.json and tsconfig.json needed.

## Requirements

* Node >= 16.19.0.
* A package.json with `type` defined.
* A tsconfig.json with `outDir` defined.

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
    "declaration": true,
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

It should work similarly for a CJS-first project. Except, your package.json file would use `"type": "commonjs"`.

See the available [options](#options).


## Options

The available options are limited, because you should define most of them inside your project's `tsconfig.json` file.

* `--project, -p` The path to the project's configuration file. Defaults to `tsconfig.json`.
* `--pkg-dir, -k` The directory to start looking for a package.json file. Defaults to the cwd.

You can run `duel --help` to get the same info. Below is the output of that:

```console
Usage: duel [options]

Options:
--project, -p 		 Compile the project given the path to its configuration file, or to a folder with a 'tsconfig.json'.
--pkg-dir, -k 		 The directory to start looking for a package.json file. Defaults to cwd.
--help, -h 		 Print this message.
```

## Gotchas

These are definitely edge cases, and would only really come up if your project mixes file extensions. For example, if you have `.ts` files combined with `.mts`, and/or `.cts`. For most projects, things should just work as expected.

As far as I can tell, `duel` is one (if not the only) way to get a correct dual package build using only `tsc` while only using **one package.json** file and **one tsconfig.json** file _and also_ preserving module system by file extension. The Microsoft backed TypeScript team [keep](https://github.com/microsoft/TypeScript/issues/54593) [talking](https://github.com/microsoft/TypeScript/pull/54546) about dual build support, but their philosophy is mainly one of self perseverance, rather than collaboration. For instance, they continue to refuse to rewrite specifiers.

* Unfortunately, TypeScript doesn't really build [dual packages](https://nodejs.org/api/packages.html#dual-commonjses-module-packages) very well in regards to preserving module system by file extension. For instance, there doesn't appear to be a way to convert an arbitrary `.ts` file into another module system, _while also preserving the module system of `.mts` and `.cts` files_ without using **multiple** package.json files. In my opinion, the `tsc` compiler is fundamentally broken in this regard, and at best is enforcing usage patterns it shouldn't.  This is only mentioned for transparency, `duel` will correct for this and produce files with the module system you would expect based on the files extension, so that it works with [how Node.js determines module systems](https://nodejs.org/api/packages.html#determining-module-system).

* If doing an `import type` across module systems, i.e. from `.mts` into `.cts`, or vice versa, you might encounter the compilation error ``error TS1452: 'resolution-mode' assertions are only supported when `moduleResolution` is `node16` or `nodenext`.``. This is a [known issue](https://github.com/microsoft/TypeScript/issues/49055) and TypeScript currently suggests installing the nightly build, i.e. `npm i typescript@next`.
