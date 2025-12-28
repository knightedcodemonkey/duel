# Roadmap

## Phase 1 (current)

- Keep defaults unchanged: no flag → no pre-`tsc` transform; `--modules` → globals-only lowering; `--modules --transform-syntax` → full lowering.
- Make `--transform-syntax` imply `--modules` (shorthand for `--modules --transform-syntax`).
- Document the behavior and keep all flags available.

## Phase 2 (planned, non-breaking)

- Introduce `--mode` (`none` | `globals` | `full`) as the primary UX.
  - `none`: no module transform.
  - `globals`: module transform with globals-only lowering (equivalent to `--modules`).
  - `full`: module transform with full syntax lowering (equivalent to `--modules --transform-syntax`).
- Keep `--modules` and `--transform-syntax` as supported aliases; note that `--transform-syntax` implies `--modules`.

## Phase 3 (future/major)

- Deprecate old flags in help output in favor of `--mode`.
- Consider auto-enabling `globals` mode when the build would hit TypeScript 58658 scenarios, with `--mode none` as an explicit opt-out.
- Remove deprecated flags in a major release after a migration window.
