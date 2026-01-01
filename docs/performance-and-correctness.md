# Performance + Correctness Guide

This document outlines ways to speed up @knighted/duel while preserving the guarantees of dual ESM/CJS output and specifier correctness.

## Goals

- Keep dual ESM/CJS output identical to today (specifier rewrites, extension rewrites, exports generation).
- Reduce redundant work (copying, parsing, type-checking) across runs.
- Make optimizations opt-in or auto-detected to avoid regressions.

## Low-Risk, High-Value Improvements

- **Incremental builds:** Pass `--incremental` (and `--composite` where needed) to both emits and persist `.tsbuildinfo` inside the temp/shadow workspace. Reuse the same shadow dir keyed by project hash to avoid re-parsing unchanged projects.
- **Selective copy only:** Continue skipping `node_modules` and outDir; avoid full-copy fallbacks. Prefer symlink/junction for `node_modules` to cut I/O.
- **Parallelize setup:** Run config copy/patching, node_modules linking, and temp dir prep with `Promise.all` while the primary build initializes. Gate parallelism by CPU count to avoid thrash on small machines.
- **Config hashing:** Only rebuild the temp workspace when tsconfig/package hash changes; otherwise reuse cached copies and `.tsbuildinfo`.

## Emit Strategy Options

- **Single type-check, dual emit (recommended first):** Use the TS program or solution builder API to parse/check once, then emit ESM and CJS with different `module` settings. Keeps correctness, removes the second parse/check.
- **Fast secondary emit (opt-in):** Primary emit and declarations via `tsc`; secondary CJS via transform-only (esbuild/SWC) for speed. Guard behind a flag (e.g., `--fast-secondary`) so default remains pure `tsc`.
- **No redundant types:** Emit declarations once (primary pass), skip `--emitDeclarationOnly` on the secondary.

## TSConfig and Resolution Hygiene

- Honor `include`/`exclude` when selecting files to copy/transform.
- Add an LRU cache for module resolution when traversing project references to reduce repeated lookups.
- Keep specifier and extension rewrite logic unchanged; validate outputs in tests after any performance change.

## Validation and Safety Nets

- Keep exports validation (`--exports-validate`) and specifier rewrite tests as-is; add targeted fixtures if emit paths change.
- When using fast-secondary mode, add a compare step that diffs ESM vs CJS specifier shapes on a sample fixture set to catch regressions.
- Measure before/after: collect timings for copy, parse/check, emit, and total wall-clock.

## Rollout Suggestions

- Start with incremental `.tsbuildinfo` reuse and parallelized setup (lowest risk).
- Next, prototype single type-check + dual emit; measure on a representative monorepo.
- Offer `--fast-secondary` as an opt-in flag; document trade-offs (no type-check on secondary path).
- Keep a `--no-parallel` escape hatch for constrained CI runners.
