# Exports Generation

This guide shows a simple before/after flow when using `duel --exports` to emit `package.json` exports.

> [!TIP]
> **Convention over Configuration**
>
> The `--exports` option is designed to be zero-config. It determines your public API by scanning your build output and applying standard Node.js patterns. It assumes that your directory structure reflects your intended module boundaries. If you need to hide specific files or create complex custom mappings, you should manage the exports field manually; `duel` is built to handle the 90% of use cases that follow standard project layouts without requiring a separate configuration file.

## Scenario

- `package.json` has `"type": "module"` and no `exports` field.
- `tsconfig.json` uses `outDir: "dist"`.
- Running `duel` produces ESM in `dist` and CJS in `dist/cjs`.

Example layout (source tree):

- `src/index.ts`
- `src/components/button.ts`
- `src/components/card.ts`
- `src/utils/math/add.ts`
- `src/utils/math/subtract.ts`

## Before

```json
{
  "name": "my-lib",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
```

## After: `duel --exports name`

Keys stay extensionless; targets keep explicit extensions. Values are concrete (no wildcards) because each file gets its own subpath. The subpath key is derived from the file name (via `path.parse().name`), not its directory path.

> [!WARNING]
> If two files share the same basename (e.g., `foo.ts` in different folders), they collide on that subpath: the later file discovered by the glob pass overwrites the earlier one.

```json
{
  "name": "my-lib",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/cjs/index.cjs",
      "default": "./dist/index.js"
    },
    "./index": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/cjs/index.cjs",
      "default": "./dist/index.js"
    },
    "./button": {
      "types": "./dist/components/button.d.ts",
      "import": "./dist/components/button.js",
      "require": "./dist/cjs/components/button.cjs",
      "default": "./dist/components/button.js"
    },
    "./card": {
      "types": "./dist/components/card.d.ts",
      "import": "./dist/components/card.js",
      "require": "./dist/cjs/components/card.cjs",
      "default": "./dist/components/card.js"
    },
    "./add": {
      "types": "./dist/utils/math/add.d.ts",
      "import": "./dist/utils/math/add.js",
      "require": "./dist/cjs/utils/math/add.cjs",
      "default": "./dist/utils/math/add.js"
    },
    "./subtract": {
      "types": "./dist/utils/math/subtract.d.ts",
      "import": "./dist/utils/math/subtract.js",
      "require": "./dist/cjs/utils/math/subtract.cjs",
      "default": "./dist/utils/math/subtract.js"
    }
  }
}
```

## After: `duel --exports dir`

Directory-based keys are emitted with a trailing `/*`; values are wildcarded to cover all files under that directory.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/cjs/index.cjs",
      "default": "./dist/index.js"
    },
    "./components/*": {
      "types": "./dist/components/*.d.ts",
      "import": "./dist/components/*.js",
      "require": "./dist/cjs/components/*.cjs",
      "default": "./dist/components/*.js"
    },
    "./math/*": {
      "types": "./dist/utils/math/*.d.ts",
      "import": "./dist/utils/math/*.js",
      "require": "./dist/cjs/utils/math/*.cjs",
      "default": "./dist/utils/math/*.js"
    }
  }
}
```

## After: `duel --exports wildcard`

Wildcard keys use the first path segment and cover folders; values are wildcarded to match all files in that segment. With the same layout as above, keys group by the **first** directory (`components`, `utils`) instead of the deepest one.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/cjs/index.cjs",
      "default": "./dist/index.js"
    },
    "./components/*": {
      "types": "./dist/components/*.d.ts",
      "import": "./dist/components/*.js",
      "require": "./dist/cjs/components/*.cjs",
      "default": "./dist/components/*.js"
    },
    "./utils/*": {
      "types": "./dist/utils/*.d.ts",
      "import": "./dist/utils/*.js",
      "require": "./dist/cjs/utils/*.cjs",
      "default": "./dist/utils/*.js"
    }
  }
}
```

## Notes

- Keys are extensionless to keep the public API stable; targets carry `.js/.cjs/.d.ts` so Node resolution stays explicit.
- For `dir`/`wildcard`, both keys and values use wildcards (`./dir/*` -> `./dist/dir/*.js` etc.).
- The root `.` entry uses your `main` (if set) to pick the default orientation (import vs require) and mirrors both builds when present.
- If `main` is absent and no non-wildcard subpath exists, `.` is not promoted.
- Windows paths are normalized with `path.posix`.

## Exports config (JSON)

If you want to constrain which built files become exports while keeping a conventional layout, pass `--exports-config <file>`. The file must be JSON with this shape:

```json
{
  "entries": ["./dist/index.js", "./dist/folder/module.js"],
  "main": "./dist/index.js"
}
```

- `entries` (required): array of strings pointing to emitted files (relative with `./`). Only these bases are exported.
- `main` (optional): overrides the `main` used for the root `.` entry and default orientation.

Convention over configuration remains the default: if you omit `--exports-config`, `duel` scans the output and infers exports automatically.

## Validation-only

Use `--exports-validate` to compute and validate the exports map without writing `package.json`. Combine with `--exports` and/or `--exports-config` to emit after validation. When run alone, it logs success and leaves your package.json untouched.
