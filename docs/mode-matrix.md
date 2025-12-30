# Mode matrix for @knighted/module

This table shows how `duel` maps its CLI flags (`--mode`, `--modules`, `--transform-syntax`) to the options passed into `@knighted/module` during the two transform phases:

- **Pre-`tsc` transform (only when `modules` is enabled):** runs on copied sources to avoid TypeScript 58658 asymmetry.
- **Post-build rewrite:** always runs to adjust specifiers/file extensions in the built output.

<!-- prettier-ignore-start -->
| CLI input | modulesFinal | transformSyntaxFinal | Pre-`tsc` `transformSyntax` | Post-build `transformSyntax` |
| --- | --- | --- | --- | --- |
| _default_ / `--mode none` | false | false | _none (skipped)_ | `"globals-only"` |
| `--mode globals` | true | false | `"globals-only"` | `"globals-only"` |
| `--mode full` | true | true | JS-like: `true`; TS-like: `"globals-only"` | `true` |
| `--modules` | true | false | `"globals-only"` | `"globals-only"` |
| `--transform-syntax` (implies modules) | true | true | JS-like: `true`; TS-like: `"globals-only"` | `true` |
<!-- prettier-ignore-end -->

Notes

- "TS-like" means `.ts`, `.tsx`, `.mts`, `.cts`. When `transformSyntax` is `true`, those files use `"globals-only"` pre-`tsc` to avoid stripping types; JS-like files get full lowering.
- When `modulesFinal` is `false`, no pre-`tsc` transform runs; only the post-build rewrite runs with `transformSyntax` set to `"globals-only"`.
- Legacy flags `--modules` / `--transform-syntax` map to `--mode globals` / `--mode full` respectively.
