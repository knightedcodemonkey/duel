# Performance + Correctness Guide

This document outlines ways to speed up @knighted/duel while preserving the guarantees of dual ESM/CJS output and specifier correctness.

## Goals

- Keep dual ESM/CJS output identical to today (specifier rewrites, extension rewrites, exports generation).
- Reduce redundant work (copying, parsing, type-checking) across runs.
- Make optimizations opt-in or auto-detected to avoid regressions.

## Phased Plan

- **Phase 1: Quick wins (I/O & orchestration)**
  - Shadow dir persistence: key temp workspace to a hash of tsconfig/package so `.tsbuildinfo` survives between runs.
  - Selective copy only: keep skipping `node_modules` and outDir; prefer symlink/junction for `node_modules` with fallback (junction/hardlink) and clear messaging when symlink fails on Windows.
  - Parallel setup: run copy + patch + link in `Promise.all`; gate parallelism by CPU count to avoid thrash.
- **Phase 2: Correctness core**
  - Single type-check, dual emit: use TS Program/SolutionBuilder to parse/check once, then emit ESM and CJS from the same AST/options delta; declarations come from the primary emit only.
- **Phase 3: Fast path (opt-in)**
  - `--fast-secondary`: keep primary `tsc` for ESM + types; use transform-only (esbuild/SWC) for CJS. Keep @knighted/module as the rewrite source of truth. Default remains pure `tsc`.

## Emit Strategy Options (detail)

- **Single type-check, dual emit:** Parse/check once; emit twice with differing `module` settings. Eliminates the second parse/check and preserves rewrite correctness.
- **Fast secondary emit (opt-in):** Primary emit and declarations via `tsc`; secondary CJS via transform-only (esbuild/SWC) for speed. Guard behind `--fast-secondary`.
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

- Start with incremental `.tsbuildinfo` reuse, hash-keyed temp dirs, and parallelized setup (lowest risk).
- Next, prototype single type-check + dual emit; measure on a representative monorepo.
- Offer `--fast-secondary` as an opt-in flag; document trade-offs (no type-check on secondary path).
- Keep a `--no-parallel` escape hatch for constrained CI runners.

## Profiling (TODO)

- Add `--profile` to print timing breakdowns (workspace prep, primary emit, secondary emit, rewrites) and note cache hits vs cold runs.
