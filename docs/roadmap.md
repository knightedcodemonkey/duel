# Roadmap

- Consider auto-enabling `globals` mode when the build would hit TypeScript 58658 scenarios, with `--mode none` as an explicit opt-out.
- Decide coupling of `--rewrite-policy` with `--validate-specifiers` (fail fast when `warn|safe` + validation=false, or document decoupling).
- Consider a `--quiet` flag to reduce log chatter alongside warnings/hazards.
- Memoize resolver existence checks to trim repeated sync fs hits during rewrite, if profiling shows it matters.

## Optimize temp-copy overhead

- **Measure first:** add timing/logs (bytes copied, copy duration, hazard pre-scan duration); optional `npm run bench:copy` task.
- **Default skips:** always exclude `node_modules`, caches (`.turbo`, `.next`, `.cache`), and `dist`/build outputs when safe (e.g., no refs relying on dist).
- **User filters:** consider `--copy-include` / `--copy-exclude` globs to bound what is copied for very large repos.
- **Reuse artifacts:** when project references exist, reuse existing `dist` intelligently; otherwise favor skipping `dist` to cut I/O.
- **Avoid double work:** keep hazard aggregation single-pass; short-circuit if hazard checks are off.
