# Performance + Correctness Guide

This document outlines ways to speed up @knighted/duel while preserving the guarantees of dual ESM/CJS output and specifier correctness.

## Goals

- Keep dual ESM/CJS output identical to today (specifier rewrites, extension rewrites, exports generation).
- Reduce redundant work (copying, parsing, type-checking) across runs.
- Make optimizations opt-in or auto-detected to avoid regressions.

## Opportunities (performance while keeping correctness)

- Single type-check, dual emit: parse/check once (TS Program/SolutionBuilder), then emit ESM and CJS from the same graph; emit declarations from the primary pass only.
- Optional fast secondary emit: keep `tsc` for primary/types; allow transform-only (esbuild/SWC) for the secondary target behind a flag, with an opt-in compare step to validate specifier shapes.
- Module resolution cache: add an LRU for module resolution during reference traversal to cut duplicate lookups in large workspaces.
- Profiling: add `--profile` to report timing for prep, primary emit, secondary emit, rewrites, and cache hits/misses.

## Parallel builds (opt-in flag)

- Default remains sequential: safest for CI and low-memory machines.
- Isolation is already in place (shadow workspace, separate `tsBuildInfoFile`, separate outDirs), so concurrent primary/dual builds are feasible.
- Run shadow setup in parallel with the primary build to hide latency without spawning two `tsc` processes; gate full `tsc` concurrency behind `--parallel`.
- Guardrails: ensure `copyFilesToTemp` continues to ignore `outDir` to avoid copying in-flight artifacts; run `collectCompileFilesWithReferences` before/alongside primary to get a consistent source view.
- Surface CPU/memory risk in logs when `--parallel` is used; consider auto-disabling on constrained hosts (heuristic: core count, free memory).

## Validation and safety nets

- Keep exports validation (`--exports-validate`) and specifier rewrite tests; add fixtures if emit paths change.
- For any fast-secondary mode, add a compare step that diffs ESM vs CJS specifier shapes on sample fixtures to catch regressions.
- Measure before/after on representative repos: copy time, parse/check, emit, rewrites, total wall-clock.

## Rollout suggestions

- Prototype single type-check + dual emit; measure on a representative monorepo.
- If adding fast-secondary, gate behind a flag and keep the compare step on by default; allow `--no-compare` only for CI fast paths after validation.
- Keep a `--no-parallel` escape hatch for constrained runners if parallel prep proves noisy.
