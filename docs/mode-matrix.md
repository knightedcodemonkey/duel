# Mode matrix for @knighted/module

This table shows how `duel` maps its CLI flag (`--mode`) to the options passed into `@knighted/module` during the two transform phases:

- **Pre-`tsc` transform (only when `modules` is enabled):** runs on copied sources to avoid TypeScript 58658 asymmetry. TS-like files intentionally cap `transformSyntax` at `"globals-only"` to avoid fighting `tsc`'s type erasure and declaration emit; JS-like files honor full syntax lowering when requested.
- **Post-build rewrite:** always runs to adjust specifiers/file extensions in the built output. When the dual target is CommonJS, this pass always uses `transformSyntax: true` regardless of the CLI mode so the CJS output is fully lowered; for ESM targets it uses the same `syntaxMode` value from the CLI.

<!-- prettier-ignore-start -->
| CLI input | modulesFinal | transformSyntaxFinal | Pre-`tsc` `transformSyntax` | Post-build `transformSyntax` |
| --- | --- | --- | --- | --- |
| _default_ / `--mode none` | false | false | _none (skipped)_ | dual CJS: `true`; dual ESM: `"globals-only"` |
| `--mode globals` | true | false | `"globals-only"` | dual CJS: `true`; dual ESM: `"globals-only"` |
| `--mode full` | true | true | JS-like: `true`; TS-like: `"globals-only"` | dual CJS: `true`; dual ESM: `true` |
<!-- prettier-ignore-end -->

Notes

- "TS-like" means `.ts`, `.tsx`, `.mts`, `.cts`. When `transformSyntax` is `true`, those files use `"globals-only"` pre-`tsc` to avoid stripping types and to keep declaration emit stable; JS-like files get full lowering.
- When `modulesFinal` is `false`, no pre-`tsc` transform runs; only the post-build rewrite runs (full lowering for dual CJS, `"globals-only"` for dual ESM).
- Practical implication: Optional chaining (and other ESNext syntax) in TS will only be downleveled if your `tsconfig` target lowers it or if you relax the TS guard; JS/JSX files and dual CJS outputs are fully lowered under `--mode full`.
