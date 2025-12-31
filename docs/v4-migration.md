# Duel v4 Migration Guide

This guide highlights behavior changes introduced in v4 and how to adapt existing workflows.

## Breaking/Behavioral Changes

- **Specifier rewrites now default to safer behavior.** `--rewrite-policy` now defaults to `safe`, and `--validate-specifiers` is forced on when policy is `safe`. Missing targets skip rewrites and emit warnings instead of silently rewriting.
- **Dual-package hazard detection enabled by default.** `--detect-dual-package-hazard` now defaults to `warn`, and `--dual-package-hazard-scope` defaults to `file`. You may see new warnings (or errors if configured).
- **Build pipeline runs in a temp workspace copy.** Dual builds no longer mutate the root `package.json`; a temp copy is created with an adjusted `type`. External tools that watched in-place `package.json` edits will see different behavior.
- **Project references run with `tsc -b`.** When `tsconfig.json` contains references, builds switch to TypeScript build mode. Output shape can differ from `tsc -p` for some setups.
- **Exports tooling additions.** New flags (`--exports-config`, `--exports-validate`) are available; when used, they can emit warnings or fail on invalid configs.
- **Deprecated flags removed.** `--modules` and `--transform-syntax` are gone; use `--mode globals` or `--mode full` instead.

## Restoring v3-like Behavior

- **Specifier rewrites:** use `--rewrite-policy warn --validate-specifiers false` to continue rewriting even when targets are missing (previous behavior). To fully bypass rewrites, set `--rewrite-policy skip`.
- **Hazard detection:** disable by passing `--detect-dual-package-hazard off` (or set scope to `project` only if you want aggregated warnings).
- **Build/package.json side effects:** if tooling depended on in-place `package.json` mutation, update it to read outputs from the temp dual build outputs (`dist/esm` / `dist/cjs` or `outDir` variants). No flag restores the old mutation pattern.
- **TypeScript references:** if build mode changes output undesirably, remove `references` or run your own `tsc -p` before calling `duel`.

## Recommended Migration Steps

1. Pick a rewrite policy:
   - Safety-first (default): keep `--rewrite-policy safe` (default) and address any missing-target warnings by fixing paths or adding files.
   - Legacy: add `--rewrite-policy warn --validate-specifiers false` to mimic v3 rewrites.
2. Decide on hazard handling:
   - Keep defaults to surface hazards.
   - Silence: `--detect-dual-package-hazard off`.
3. Check CI/build scripts: remove assumptions about `package.json` being mutated; consume artifacts from the generated outDir(s).
4. Projects with TS references: expect `tsc -b`; validate output paths and adjust if needed.
5. If using exports helpers: verify `--exports-config` files and watch for new validation warnings/errors.

## New/Notable Flags

- `--rewrite-policy [safe|warn|skip]` (default: `safe`)
- `--validate-specifiers` (defaults to `true` when policy is `safe`; otherwise `false`)
- `--detect-dual-package-hazard [off|warn|error]` (default: `warn`)
- `--dual-package-hazard-scope [file|project]` (default: `file`)
- `--exports-config <path>`
- `--exports-validate`
- `--verbose`

## Quick FAQ

- **Why are some rewrites skipped now?** Missing targets + `rewrite-policy safe` causes skips with warnings. Use `warn` to force rewrites or fix the missing files.
- **Can I suppress hazard warnings?** Yes, `--detect-dual-package-hazard off`.
- **Why isn’t package.json changed anymore?** v4 writes to a temp copy to avoid mutating your root; watch the emitted outDir instead.
