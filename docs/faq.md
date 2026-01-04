# Duel FAQ

## Why does Duel recommend excluding `dist/` in `tsconfig.json`?

Duel emits JavaScript and declaration files into `dist/`, and the same `tsconfig.json` is reused for both emitting and type-checking. In workspace setups, sibling packages often import `@scope/pkg` via its package exports, so TypeScript resolves into the generated `.d.ts` files inside `dist/`. When `tsc` later tries to emit, it refuses to overwrite files it now treats as inputs (TS5055). Adding `"exclude": ["dist"]` keeps build artifacts out of the compilation so Duel can regenerate them safely.

### Why is this mostly a workspace issue?

Single-package projects seldom import their own published outputs, but monorepos routinely do. When another package in the workspace references `@scope/pkg`, TypeScript follows that path right back into the freshly built `dist/` directory. Without the exclusion, the repo ends up both producing and consuming those artifacts during the same build, confusing the compiler.

### Do I still need `"outDir": "dist"` if I exclude it?

Yes. `outDir` controls where Duel (and `tsc`) place emit results. The exclusion only affects what the compiler considers source inputs; it does not change the emit destination.

### Can I avoid editing `tsconfig.json`?

You could maintain separate configs (one for emit, one for checking) or lean on project references, but Duel's default workflow assumes a single package-level config. Excluding `dist/` is the simplest, least error-prone way to ensure dual builds, incremental type-checks, and workspace consumers all cooperate.

## How do I detect dual package hazards?

Dual packages can load twice if a project mixes `import` and `require` for the same dependency (especially when conditional exports differ). Use the built-in detector:

- `--detect-dual-package-hazard [off|warn|error]` controls severity (default `warn`; `error` exits non-zero).
- `--dual-package-hazard-scope [file|project]` scopes diagnostics per file (legacy) or across the compiled source set (recommended for monorepos/hoisted installs).

Project scope runs a pre-pass before builds so hazards surface once per package, even if the conflicting usage spans multiple files.

## Why does Duel error on references outside the project or on unparseable tsconfig files?

Duel copies and patches every referenced `tsconfig` into a shadow workspace so emit targets and `.tsbuildinfo` stay isolated. If a reference points outside the project (or its parent when using project references), or if a referenced config cannot be parsed, Duel cannot safely patch it and now fails fast with a clear error. Move the reference inside the root/parent workspace and fix the config so the build can proceed.

## Why might Duel fall back to unbounded source paths on Windows?

Duel filters TypeScript source paths to prefer files inside your project root. On Windows, certain edge cases in path normalization can cause all paths to be incorrectly filtered out, triggering a fallback to the full unbounded list. Known scenarios include:

### Extended-length / UNC-style paths

`tsc` may emit paths like `\\?\C:\repo\src\file.ts` while `resolve(workingDir)` yields `C:\repo`. After normalization, these can still differ at the prefix level (`\\?\C:\repo` vs `C:\repo`), causing the root-matching logic to fail and filter out valid paths.

### Junctions / symlinked working directories

If your working directory is a junction or symlink (e.g., `C:\link-to-repo`) but `tsc` prints the real path (e.g., `C:\repo`), the normalized root and file paths won't share the same prefix. Every candidate fails the root check, leaving `insideRoot` empty.

### Mixed drive/root representations

Historically, tools can prepend UNC-style prefixes or vary drive letter formatting in ways that survive normalization. These differences make the string-prefix comparison too strict, dropping otherwise valid source files.

### Debugging the fallback

If you encounter this fallback in practice and need to debug it:

1. Add temporary logging to compare the normalized `root` value with a sample of paths from `allPaths`.
2. Look for mismatched prefixes such as `\\?\C:\` vs `C:\`, or junction vs realpath differences.
3. Consider using the real path consistently (via `fs.realpathSync`) if your workflow involves symlinks or junctions.

The fallback ensures real source files aren't silently dropped, but understanding the root cause can help you avoid the edge case entirely.
