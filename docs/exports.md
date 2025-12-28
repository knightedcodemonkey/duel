# Exports Generation Examples

This guide shows a simple before/after flow when using `duel --exports` to emit `package.json` exports.

## Scenario

- `package.json` has `"type": "module"` and no `exports` field.
- `tsconfig.json` uses `outDir: "dist"`.
- Running `duel` produces ESM in `dist` and CJS in `dist/cjs`.

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

Keys stay extensionless; targets keep explicit extensions.

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
    "./utils": {
      "types": "./dist/utils.d.ts",
      "import": "./dist/utils.js",
      "require": "./dist/cjs/utils.cjs",
      "default": "./dist/utils.js"
    }
  }
}
```

## After: `duel --exports dir`

Directory-based keys are emitted while values keep explicit extensions.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/cjs/index.cjs",
      "default": "./dist/index.js"
    },
    "./utils": {
      "types": "./dist/utils.d.ts",
      "import": "./dist/utils.js",
      "require": "./dist/cjs/utils.cjs",
      "default": "./dist/utils.js"
    }
  }
}
```

## After: `duel --exports wildcard`

Wildcard keys cover folders; values still point to concrete files.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/cjs/index.cjs",
      "default": "./dist/index.js"
    },
    "./utils/*": {
      "types": "./dist/utils/index.d.ts",
      "import": "./dist/utils/index.js",
      "require": "./dist/cjs/utils/index.cjs",
      "default": "./dist/utils/index.js"
    }
  }
}
```

## Notes

- Keys are extensionless to keep the public API stable; targets carry `.js/.cjs/.d.ts` so Node resolution stays explicit.
- The root `.` entry uses your `main` to pick the default orientation (import vs require) and mirrors both builds when present.
- If `main` is absent, the first discovered subpath will be promoted to `.`.
