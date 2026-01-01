# [`@knighted/duel`](https://www.npmjs.com/package/@knighted/duel)

![CI](https://github.com/knightedcodemonkey/duel/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/knightedcodemonkey/duel/branch/main/graph/badge.svg?token=7K74BRLHFy)](https://codecov.io/gh/knightedcodemonkey/duel)
[![NPM version](https://img.shields.io/npm/v/@knighted/duel.svg)](https://www.npmjs.com/package/@knighted/duel)

Tool for building a Node.js [dual package](https://nodejs.org/api/packages.html#dual-commonjses-module-packages) with TypeScript. Supports CommonJS and ES module projects.

> [!NOTE]
> I wish this tool were unnecessary, but dual emit was declared out of scope by the TypeScript team, so `duel` exists to fill that gap.

## Features

- Bidirectional ESM ↔️ CJS dual builds inferred from the package.json `type`.
- Correctly preserves module systems for `.mts` and `.cts` file extensions.
- No extra configuration files needed, uses `package.json` and `tsconfig.json` files.
- Transforms the [differences between ES modules and CommonJS](https://nodejs.org/api/esm.html#differences-between-es-modules-and-commonjs).
- Works with monorepos.

## Requirements

- Node >= 22.21.1 (<23) or >= 24 (<25)

## Example

First, install this package to create the `duel` executable inside your `node_modules/.bin` directory.

```console
npm i @knighted/duel --save-dev
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
npm run build
```

If everything worked, you should have an ESM build inside of `dist` and a CJS build inside of `dist/cjs`. You can manually update your [`exports`](https://nodejs.org/api/packages.html#exports) to match the build output, or run `duel --exports <mode>` to generate them automatically (see [docs/exports.md](docs/exports.md)).

It should work similarly for a CJS-first project. Except, your package.json file would use `"type": "commonjs"` and the dual build directory is in `dist/esm`.

> [!IMPORTANT]
> This works best if your CJS-first project uses file extensions in _relative_ specifiers. That is acceptable in CJS and [required in ESM](https://nodejs.org/api/esm.html#import-specifiers). `duel` does not rewrite bare specifiers or remap relative specifiers to directory indexes.

### Build orientation

`duel` infers the primary vs dual build orientation from your `package.json` `type`:

- `"type": "module"` → primary ESM, dual CJS
- `"type": "commonjs"` → primary CJS, dual ESM

### Output directories

If you prefer to have both builds in directories inside of your defined `outDir`, you can use the `--dirs` option.

```json
"scripts": {
  "build": "duel --dirs"
}
```

Assuming an `outDir` of `dist`, running the above will create `dist/esm` and `dist/cjs` directories.

### Module transforms

`tsc` is asymmetric: `import.meta` globals fail in a CJS-targeted build, but CommonJS globals like `__filename`/`__dirname` pass when targeting ESM, causing runtime errors in the compiled output. See [TypeScript#58658](https://github.com/microsoft/TypeScript/issues/58658). Use `--mode` to mitigate:

- `--mode globals` [rewrites module globals](https://github.com/knightedcodemonkey/module/blob/main/docs/globals-only.md#rewrites-at-a-glance).
- `--mode full` adds syntax lowering _in addition to_ the globals rewrite.

```json
"scripts": {
  "build": "duel --mode globals"
}
```

```json
"scripts": {
  "build": "duel --mode full"
}
```

When `--mode` is enabled, `duel` copies sources and runs [`@knighted/module`](https://github.com/knightedcodemonkey/module) **before** `tsc`, so TypeScript sees already-mitigated sources. That pre-`tsc` step is globals-only for `--mode globals` and full lowering for `--mode full`.

### Dual package hazards

Mixed `import`/`require` of the same dual package (especially when conditional exports differ) can create two module instances. `duel` exposes the detector from `@knighted/module`:

- `--detect-dual-package-hazard [off|warn|error]` (default `warn`): emit diagnostics; `error` exits non-zero.
- `--dual-package-hazard-scope [file|project]` (default `file`): per-file checks or a project-wide pre-pass that aggregates package usage across all compiled sources before building.

Project scope is helpful in monorepos or hoisted installs where hazards surface only when looking across files.

## Options

The available options are limited, because you should define most of them inside your project's `tsconfig.json` file.

- `--project, -p` The path to the project's configuration file. Defaults to `tsconfig.json`.
- `--pkg-dir, -k` The directory to start looking for a package.json file. Defaults to `--project` dir.
- `--mode` Optional shorthand for the module transform mode: `none` (default), `globals` (globals-only), `full` (globals + full syntax lowering).
- `--dirs, -d` Outputs both builds to directories inside of `outDir`. Defaults to `false`.
- `--exports, -e` Generate `package.json` `exports` from build output. Values: `wildcard` | `dir` | `name`.
- `--exports-config` Provide a JSON file with `{ "entries": ["./dist/index.js", ...], "main": "./dist/index.js" }` to limit which outputs become exports.
- `--exports-validate` Dry-run exports generation/validation without writing package.json; combine with `--exports` or `--exports-config` to emit after validation.
- `--rewrite-policy [safe|warn|skip]` Control how specifier rewrites behave when a matching target is missing (`safe` warns and skips, `warn` rewrites and warns, `skip` leaves specifiers untouched).
- `--validate-specifiers` Validate that rewritten specifiers resolve to outputs; defaults to `true` when `--rewrite-policy` is `safe`.
- `--detect-dual-package-hazard [off|warn|error]` Flag mixed import/require usage of dual packages; `error` exits non-zero.
- `--dual-package-hazard-scope [file|project]` Run hazard checks per file (default) or aggregate across the project.
- `--copy-mode [sources|full]` Temp copy strategy. `sources` (default) copies only files participating in the build (plus configs); `full` mirrors the previous whole-project copy.
- `--verbose, -V` Verbose logging.
- `--help, -h` Print the help text.

> [!NOTE]
> Exports keys are extensionless by design; the target `import`/`require`/`types` entries keep explicit file extensions so Node resolution remains deterministic.

You can run `duel --help` to get the same info.

## Notes

As far as I can tell, `duel` is one (if not the only) way to get a correct dual package build using `tsc` without requiring multiple `tsconfig.json` files or extra configuration. The TypeScript team [keep](https://github.com/microsoft/TypeScript/pull/54546) [talking](https://github.com/microsoft/TypeScript/issues/54593) about dual build support, but they continue to [refuse to rewrite specifiers](https://github.com/microsoft/TypeScript/issues/16577).

Fortunately, Node.js has added `--experimental-require-module` so that you can [`require()` ES modules](https://nodejs.org/api/esm.html#require) if they don't use top level await, which sets the stage for possibly no longer requiring dual builds.

## Documentation

- [docs/faq.md](docs/faq.md)
- [docs/exports.md](docs/exports.md)
- [docs/migrate-v2-v3.md](docs/migrate-v2-v3.md)
