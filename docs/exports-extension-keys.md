# Extensionful Export Keys (Feature Proposal)

This document captures requirements for adding an option that emits package.json `exports` keys **with file extensions** (e.g., `./foo.js`, `./foo.mjs`) while keeping the current extensionless default.

## Background

- Today `duel --exports` emits extensionless keys (`./foo`, `./foo/*`); targets already carry explicit extensions (`.js/.mjs/.cjs/.d.ts`).
- Some consumers prefer extensionful specifiers for clarity or to align with stricter import policies.

## Goals

- Opt-in mode that generates export keys with extensions.
- Preserve current behavior by default (extensionless keys).
- Keep targets unchanged (still explicit extensions, mapped to built outputs).

## Non-goals

- Changing the default key shape for existing modes.
- Emitting multiple keys per subpath for every extension variant.

## Proposed API (strawman)

- Extend `--exports` values with `name-ext`, `dir-ext`, `wildcard-ext` (parallel to `name|dir|wildcard`).
  - `name-ext`: `./foo.js` keys (primary build extension) for files.
  - `dir-ext`: `./dir.js` keys per directory.
  - `wildcard-ext`: `./dir/*.js` wildcard keys.
- Alternative: a boolean `--exports-keys-with-ext` that toggles extensionful keys when combined with existing modes. Pick one approach and document it.

## Behavior

- Keys: include the chosen extension based on the primary build artifact (e.g., `.js` for ESM primary, `.cjs` for CJS primary if that’s the default). Avoid duplicate keys when both `.js` and `.mjs` exist; define a deterministic preference.
- Root entry `.`: keep extensionless for compatibility (recommended), but note the decision explicitly.
- Targets (`import`/`require`/`types`/`default`): unchanged; remain explicit file paths.

## Examples

Given `type: module`, `outDir: dist`, dual CJS in `dist/cjs`, running `duel --exports name-ext` could produce:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/cjs/index.cjs",
      "default": "./dist/index.js"
    },
    "./index.js": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/cjs/index.cjs",
      "default": "./dist/index.js"
    },
    "./utils.js": {
      "types": "./dist/utils.d.ts",
      "import": "./dist/utils.js",
      "require": "./dist/cjs/utils.cjs",
      "default": "./dist/utils.js"
    }
  }
}
```

## Acceptance Criteria

- CLI accepts the new mode(s) and validates inputs.
- Export keys include extensions per the selected mode; no duplicates.
- Root `.` behavior documented and covered by tests.
- Targets remain explicit and correct for import/require/types/default.
- Integration tests cover `name-ext`, `dir-ext`, `wildcard-ext` (or the chosen flag) for both module orientations and `--dirs`.
- README/docs updated with examples and guidance.

## Open Questions

- Should the root `.` ever include an extension (e.g., `./index.js`) or stay extensionless? Default proposal: keep extensionless.
- Which extension to prefer for keys when primary build uses `.mjs` vs `.js`? Proposed: use the primary build’s emitted extension.
- Should types influence key extension (e.g., `.d.ts` keys)? Proposed: no; keep JS/MJS/CJS only.

## Test Plan (high level)

- Integration: generate exports in each new mode; assert key shapes, default mapping, and target correctness.
- Edge: dirs mode nesting (dist/esm, dist/cjs), missing `main`, types-only files.
- Lint/format: ensure ESLint/Prettier and lint-staged pass.

## Compatibility

- Default remains extensionless; existing users unaffected unless they opt in.
- New modes documented as opt-in and experimental until stabilized.
