# Duel v4 Migration Guide

This guide highlights behavior changes introduced in v4 and how to adapt existing workflows.

## Breaking/Behavioral Changes

- **Specifier rewrites now default to safer behavior.** `--rewrite-policy` now defaults to `safe`, and `--validate-specifiers` is forced on when policy is `safe`. Missing targets skip rewrites and emit warnings instead of silently rewriting.
- **Dual-package hazard detection enabled by default.** `--detect-dual-package-hazard` now defaults to `warn`, and `--dual-package-hazard-scope` defaults to `file`. You may see new warnings (or errors if configured).
- **Build pipeline runs in a temp workspace copy.** Dual builds no longer mutate the root `package.json`; a temp copy is created with an adjusted `type`. External tools that watched in-place `package.json` edits will see different behavior.
  - **IMPORTANT:** The temp-copy flow adds some I/O for large repos (copying sources/reference packages and running transforms there). `node_modules` is skipped; when references exist, existing `dist` may be reused. Very large projects may see modestly slower runs compared to the old in-place mutation.
- **Cache/shadow location is project-local.** `.duel-cache` now lives under the project root (e.g., `<project>/.duel-cache`) instead of the parent directory to avoid “filesystem invasion.” Temp shadow workspaces and tsbuildinfo cache files stay inside that folder. Add `.duel-cache/` to your `.gitignore`.
- **Project references run with `tsc -b`.** When `tsconfig.json` contains references, builds switch to TypeScript build mode. Output shape can differ from `tsc -p` for some setups.
- **Referenced configs must be patchable.** Duel now fails fast if a referenced `tsconfig` lives outside the allowed workspace boundary (package root, packages root, or repo root, excluding `node_modules`) or cannot be parsed in the temp workspace. Move references inside the repo and fix invalid configs so both primary and dual builds stay isolated.
- **Dual CJS builds enforce CJS semantics.** The shadow workspace now uses `type: "commonjs"` plus `module: "NodeNext"` for the dual build, so TypeScript will error on CJS-incompatible syntax like `import.meta` unless you adjust code or opt into `--mode globals`/`--mode full` (v3 previously allowed this to slip through).
- **Exports tooling additions.** New flags (`--exports-config`, `--exports-validate`) are available; when used, they can emit warnings or fail on invalid configs.
- **Deprecated flags removed.** `--modules`, `--transform-syntax`, and `--target-extension` are gone; use `--mode globals` or `--mode full` instead.
- **Copy strategy defaults to sources.** `--copy-mode sources` is the default (minimal temp copy of inputs/configs). Use `--copy-mode full` to mirror the entire project like v3.

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
- **Why do I see `import.meta` errors in CJS builds?** v4 compiles the dual target in a CommonJS context (shadow `package.json` is `type: "commonjs"`), so TypeScript rejects CJS-incompatible syntax. Fix the source for CJS or run with `--mode globals`/`--mode full` to inject compatibility transforms.
- **Where is `.duel-cache` now?** Under your project root (e.g., `<project>/.duel-cache`); the temp shadow workspace and tsbuildinfo cache files stay there to avoid writing to the parent directory.
