# Duel FAQ

## Why does Duel recommend excluding `dist/` in `tsconfig.json`?

Duel emits JavaScript and declaration files into `dist/`, and the same `tsconfig.json` is reused for both emitting and type-checking. In workspace setups, sibling packages often import `@scope/pkg` via its package exports, so TypeScript resolves into the generated `.d.ts` files inside `dist/`. When `tsc` later tries to emit, it refuses to overwrite files it now treats as inputs (TS5055). Adding `"exclude": ["dist"]` keeps build artifacts out of the compilation so Duel can regenerate them safely.

## Why is this mostly a workspace issue?

Single-package projects seldom import their own published outputs, but monorepos routinely do. When another package in the workspace references `@scope/pkg`, TypeScript follows that path right back into the freshly built `dist/` directory. Without the exclusion, the repo ends up both producing and consuming those artifacts during the same build, confusing the compiler.

## Do I still need `"outDir": "dist"` if I exclude it?

Yes. `outDir` controls where Duel (and `tsc`) place emit results. The exclusion only affects what the compiler considers source inputs; it does not change the emit destination.

## Can I avoid editing `tsconfig.json`?

You could maintain separate configs (one for emit, one for checking) or lean on project references, but Duel's default workflow assumes a single package-level config. Excluding `dist/` is the simplest, least error-prone way to ensure dual builds, incremental type-checks, and workspace consumers all cooperate.
