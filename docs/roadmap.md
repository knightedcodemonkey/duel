# Roadmap

- Consider auto-enabling `globals` mode when the build would hit TypeScript 58658 scenarios, with `--mode none` as an explicit opt-out.
- Consider a `--quiet` flag to reduce log chatter alongside warnings/hazards.
- Revisit a gated `--validate-specifiers` flag for advanced workflows that need explicit validation separate from rewrite policy.
- Memoize resolver existence checks to trim repeated sync fs hits during rewrite, if profiling shows it matters.
- Optionally prune stale `_duel_*` temp workspaces on startup (behind env flag and skipped in CI) to keep project roots tidy.
- Deprecate `copyMode=full` (announce as compatibility-only, plan removal if unused) and favor the selective copy path by default.
- Clarify workspace boundary policy: keep the widened default (pkg dir, parent, repo root) for “just works” single-package/monorepo support; consider conditional inclusion of the repo root (e.g., only when an extends lands there or when a workspace root is detected) to tighten surface area in a future iteration.

## Optimize temp-copy overhead

- **Measure first:** add timing/logs (bytes copied, copy duration, hazard pre-scan duration); optional `npm run bench:copy` task.
- **Default skips:** always exclude `node_modules`, caches (`.turbo`, `.next`, `.cache`), and `dist`/build outputs when safe (e.g., no refs relying on dist).
- **User filters:** consider `--copy-include` / `--copy-exclude` globs to bound what is copied for very large repos.
- **Reuse artifacts:** when project references exist, reuse existing `dist` intelligently; otherwise favor skipping `dist` to cut I/O.
- **Avoid double work:** keep hazard aggregation single-pass; short-circuit if hazard checks are off.
