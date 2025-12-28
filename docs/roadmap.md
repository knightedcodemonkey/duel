# Roadmap

## Phase 1 (current)

- Defaults unchanged: no flag → no pre-`tsc` transform; `--modules` → globals-only lowering; `--modules --transform-syntax` → full lowering.
- `--transform-syntax` implies `--modules` (shorthand for `--modules --transform-syntax`).
- `--mode` (`none` | `globals` | `full`) is available as a single-switch UX; legacy flags remain supported.
- Documentation and tests cover the new flows; behavior is backward compatible.

## Phase 2 (planned, non-breaking)

- Optionally emit a soft note when legacy flags are used (no change to behavior).

## Phase 3 (future/major)

- Deprecate old flags in help output in favor of `--mode`.
- Consider auto-enabling `globals` mode when the build would hit TypeScript 58658 scenarios, with `--mode none` as an explicit opt-out.
- Remove deprecated flags in a major release after a migration window.
