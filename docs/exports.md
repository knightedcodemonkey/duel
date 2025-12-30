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

Keys stay extensionless; targets keep explicit extensions. Values are concrete (no wildcards) because each file gets its own subpath.

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
    "./utils/*": {
      "types": "./dist/utils/*.d.ts",
      "import": "./dist/utils/*.js",
      "require": "./dist/cjs/utils/*.cjs",
      "default": "./dist/utils/*.js"
    }
  }
}
```

## After: `duel --exports wildcard`

Wildcard keys use the first path segment and cover folders; values are wildcarded to match all files in that segment.

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
