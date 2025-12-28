# Migrate @knighted/duel v2 → v3

## What changed (breaking)

- **Node version floor:** Now requires Node >= 22.21.1 (<23) or >= 24 (<25).
- **Build orientation:** Duel infers primary vs dual build from `package.json.type`.
  - `"type": "module"` → primary ESM, dual CJS.
  - `"type": "commonjs"` → primary CJS, dual ESM.
  - If `type` was absent in v2, set it explicitly to avoid flipped outputs.
- **Specifier rewrites:** Uses `@knighted/module` (no `@knighted/specifier`).
- **Transform flags quality-of-life:** `--transform-syntax` now implies `--modules`, and a new `--mode` flag provides a shorthand (`none | globals | full`). Defaults are unchanged.

## What stayed the same

- `tsconfig.json` drives compiler options; no extra configs required.
- `--dirs` still nests outputs under `outDir/esm` and `outDir/cjs`.
- `--modules` still pre-transforms module globals before `tsc` to avoid errors.

## Quick migration steps

1. **Set `type`** in your `package.json` to reflect your primary module system ("module" or "commonjs").
2. **Upgrade Node** to 22.21.1+ or 24.x.
3. **Upgrade dependency** to `@knighted/duel@^3.0.0`.
4. If you had custom postinstall patches for `@knighted/module` imports, remove them (v3+ ships correct `imports`).

## New convenience flags (v3.x)

- `--transform-syntax` (full lowering) now automatically enables `--modules` so you don't have to pass both.
- `--mode` offers a single switch:
  - `none`: no pre-`tsc` module transform (default)
  - `globals`: equivalent to `--modules` (globals-only lowering)
  - `full`: equivalent to `--modules --transform-syntax`
    The legacy flags remain supported and documented.

That's it—no config rewrites should be needed beyond `type` and Node version.
