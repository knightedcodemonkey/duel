#!/usr/bin/env node

import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { join, dirname, resolve, relative, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { writeFile, rm, mkdir, cp, access, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import { glob } from 'glob'
import { findUp } from 'find-up'
import { transform, collectProjectDualPackageHazards } from '@knighted/module'
import { getTsconfig, parseTsconfig } from 'get-tsconfig'

import { init } from './init.js'
import {
  getRealPathAsFileUrl,
  getCompileFiles,
  log,
  logError,
  logWarn,
  logSuccess as logSuccessBadge,
  readExportsConfig,
  processDiagnosticsForFile,
  exitOnDiagnostics,
  filterDualPackageDiagnostics,
  maybeLinkNodeModules,
  runExportsValidationBlock,
  createTempCleanup,
  registerCleanupHandlers,
} from './util.js'

import { rewriteSpecifiersAndExtensions } from './resolver.js'

const handleErrorAndExit = message => {
  const parsed = parseInt(message, 10)
  const exitCode = Number.isNaN(parsed) ? 1 : parsed

  logError('Compilation errors found.')
  process.exit(exitCode)
}

const logDiagnostics = (diags, projectDir, hazardAllowlist = null) => {
  let hasError = false

  for (const diag of diags) {
    if (hazardAllowlist && diag?.code?.startsWith('dual-package') && diag?.message) {
      const match = /Package '([^']+)'/.exec(diag.message)
      const pkg = match?.[1]

      if (pkg && hazardAllowlist.has(pkg)) continue
    }

    const loc = diag.loc ? ` [${diag.loc.start}-${diag.loc.end}]` : ''
    const rel = diag.filePath ? `${relative(projectDir, diag.filePath)}` : ''
    const location = rel ? `${rel}: ` : ''
    const message = `${diag.code}: ${location}${diag.message}${loc}`

    if (diag.level === 'error') {
      hasError = true
      logError(message)
    } else {
      logWarn(message)
    }
  }

  return hasError
}

const duel = async args => {
  const ctx = await init(args)

  if (ctx) {
    const {
      projectDir,
      tsconfig,
      configPath,
      modules,
      dirs,
      transformSyntax,
      pkg,
      exports: exportsOpt,
      exportsConfig,
      exportsValidate,
      rewritePolicy,
      validateSpecifiers,
      detectDualPackageHazard,
      dualPackageHazardAllowlist,
      dualPackageHazardScope,
      verbose,
      copyMode,
    } = ctx
    const logVerbose = verbose ? (...messages) => log(...messages) : () => {}
    const tsc = await findUp(
      async dir => {
        const candidate = join(dir, 'node_modules', 'typescript', 'bin', 'tsc')

        try {
          await access(candidate)
          return resolve(candidate)
        } catch {
          /* continue */
        }
      },
      { cwd: projectDir },
    )
    const hasReferences =
      Array.isArray(tsconfig.references) && tsconfig.references.length > 0
    const runBuild = (project, outDir, tsBuildInfoFile, cwdForBuild) => {
      return new Promise((fulfill, rejectBuild) => {
        const useBuildMode = hasReferences
        const tsArgs = useBuildMode
          ? [tsc, '-b', project]
          : outDir
            ? [tsc, '-p', project, '--outDir', outDir]
            : [tsc, '-p', project]
        if (!useBuildMode) {
          tsArgs.push('--incremental')

          if (tsBuildInfoFile) {
            tsArgs.push('--tsBuildInfoFile', tsBuildInfoFile)
          }
        }
        const build = spawn(process.execPath, tsArgs, {
          stdio: 'inherit',
          cwd: cwdForBuild ?? process.cwd(),
        })

        build.on('exit', code => {
          if (code > 0) {
            return rejectBuild(new Error(code))
          }

          fulfill(code)
        })
      })
    }
    const pkgDir = dirname(pkg.path)
    const packageRoot = resolve(pkgDir)
    const mainPath = pkg.packageJson.main
    const mainDefaultKind = mainPath?.endsWith('.cjs') ? 'require' : 'import'
    const outDir = tsconfig.compilerOptions?.outDir ?? 'dist'
    const absoluteOutDir = resolve(projectDir, outDir)
    const originalType = pkg.packageJson.type ?? 'commonjs'
    const isCjsBuild = originalType !== 'commonjs'
    const absoluteDualOutDir = join(
      projectDir,
      isCjsBuild ? join(outDir, 'cjs') : join(outDir, 'esm'),
    )
    /*
     * Workspace boundary: package root, its parent (e.g., packages/), and repo root.
     * Chosen to make single-package and typical monorepo base-config extends “just work”
     * even without TS references, while still excluding node_modules.
     */
    const packagesRoot = dirname(packageRoot)
    const repoRoot = dirname(packagesRoot)
    const allowedConfigRoots = [packageRoot, packagesRoot, repoRoot].filter(
      (root, idx, arr) => arr.indexOf(root) === idx,
    )
    const isInAllowedRoots = absPath =>
      allowedConfigRoots.some(
        root => absPath === root || absPath.startsWith(`${root}${sep}`),
      )
    const shouldIncludeConfig = absPath => {
      const normalized = resolve(absPath)

      if (normalized.split(sep).includes('node_modules')) return false

      return isInAllowedRoots(normalized)
    }
    const toWorkspaceRelative = absPath => {
      const normalized = resolve(absPath)

      for (const root of allowedConfigRoots) {
        if (normalized === root) return '.'
        if (normalized.startsWith(`${root}${sep}`)) return relative(root, normalized)
      }

      return null
    }
    const requireWorkspaceRelative = absPath => {
      const rel = toWorkspaceRelative(absPath)

      if (rel === null) {
        logError(
          `Referenced config or source is outside the allowed workspace boundary and cannot be patched: ${absPath}. Move it inside one of: ${allowedConfigRoots.join(', ')} so Duel can create an isolated shadow build.`,
        )
        process.exit(1)
      }

      return rel
    }
    const primaryOutDir = dirs
      ? isCjsBuild
        ? join(absoluteOutDir, 'esm')
        : join(absoluteOutDir, 'cjs')
      : absoluteOutDir
    const {
      type,
      exports,
      imports,
      main,
      module,
      types,
      typings,
      typesVersions,
      sideEffects,
    } = pkg.packageJson ?? {}
    const pkgHashInputs = {
      type,
      exports,
      imports,
      main,
      module,
      types,
      typings,
      typesVersions,
      sideEffects,
    }
    const hash = createHash('sha1')
      .update(
        JSON.stringify({
          configPath,
          tsconfig,
          packageJson: pkgHashInputs,
          dualTarget: isCjsBuild ? 'cjs' : 'esm',
        }),
      )
      .digest('hex')
      .slice(0, 8)
    const cacheDir = join(projectDir, '.duel-cache')
    const primaryTsBuildInfoFile = join(cacheDir, `primary.${hash}.tsbuildinfo`)
    const dualTsBuildInfoFile = join(cacheDir, `dual.${hash}.tsbuildinfo`)
    const subDir = join(cacheDir, `_duel_${hash}_`)
    const shadowDualOutDir = join(subDir, requireWorkspaceRelative(absoluteDualOutDir))
    const hazardMode = detectDualPackageHazard ?? 'warn'
    const hazardScope = dualPackageHazardScope ?? 'file'
    const hazardAllowlist = new Set(
      (dualPackageHazardAllowlist ?? []).map(entry => entry.trim()).filter(Boolean),
    )
    const logDiagnosticsWithAllowlist = diags =>
      logDiagnostics(diags, projectDir, hazardAllowlist)
    const applyHazardAllowlist = diagnostics =>
      filterDualPackageDiagnostics(diagnostics ?? [], hazardAllowlist)
    function mapReferencesToShadow(references = [], options) {
      const { resolveRefPath, toShadowPathFn, fromDir } = options

      return references.map(ref => {
        if (!ref?.path) return ref

        const refAbs = resolveRefPath(ref.path)
        const shadowRef = toShadowPathFn(refAbs)

        return {
          ...ref,
          path: relative(fromDir, shadowRef),
        }
      })
    }
    const getOverrideTsConfig = dualConfigDir => {
      const shadowReferences = mapReferencesToShadow(tsconfig.references ?? [], {
        resolveRefPath: refPath => resolve(projectDir, refPath),
        toShadowPathFn: abs => join(subDir, requireWorkspaceRelative(abs)),
        fromDir: dualConfigDir,
      })

      return {
        ...tsconfig,
        references: shadowReferences,
        compilerOptions: {
          ...(tsconfig.compilerOptions ?? {}),
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: tsconfig.compilerOptions?.target ?? 'ES2022',
          // Emit dual build into the shadow workspace, then copy to real outDir
          outDir: shadowDualOutDir,
          incremental: true,
          tsBuildInfoFile: dualTsBuildInfoFile,
        },
      }
    }
    const runPrimaryBuild = () => {
      return runBuild(
        configPath,
        hasReferences ? undefined : primaryOutDir,
        hasReferences ? undefined : primaryTsBuildInfoFile,
        projectDir,
      )
    }
    const refreshDualBuildInfo = async () => {
      try {
        await access(shadowDualOutDir)
      } catch {
        await rm(dualTsBuildInfoFile, { force: true })
      }
    }
    const refreshPrimaryBuildInfo = async () => {
      try {
        await access(primaryOutDir)
      } catch {
        await rm(primaryTsBuildInfoFile, { force: true })
      }
    }
    const resolveReferenceConfigPath = (baseDir, refPath) => {
      const abs = resolve(baseDir, refPath)

      return /\.json$/i.test(abs) ? abs : join(abs, 'tsconfig.json')
    }
    const collectCompileFilesWithReferences = async ({ includeConfig }) => {
      const seenConfigs = new Set()
      const compileFiles = new Set()
      const configFiles = new Set()
      const referenceConfigFiles = new Set()
      const packageJsons = new Set()
      const queue = [{ configPath, tsconfig, projectDir }]
      const resolveExtendsConfig = (specifier, cwdForProject) => {
        try {
          const resolved = getTsconfig(specifier, { cwd: cwdForProject })

          if (resolved?.path) {
            return {
              path: resolved.path,
              tsconfig: resolved.tsconfig ?? resolved,
            }
          }
        } catch {
          /* ignore and fall back */
        }

        if (/^\.{1,2}[\\/]/.test(specifier)) {
          const candidate = resolve(cwdForProject, specifier)

          try {
            const parsed = parseTsconfig(candidate)
            const parsedConfig = parsed?.tsconfig ?? parsed

            if (parsedConfig) {
              return { path: candidate, tsconfig: parsedConfig }
            }
          } catch {
            /* ignore */
          }
        }

        return null
      }

      logVerbose(`Root tsconfig references: ${JSON.stringify(tsconfig.references ?? [])}`)

      /*
       * Depth-first traversal (LIFO via pop) is acceptable here because results
       * are collected into Sets where order is irrelevant. What matters is that
       * all configs are visited, not the order in which they're processed.
       */
      while (queue.length) {
        const current = queue.pop()
        const absConfig = resolve(current.configPath)

        if (seenConfigs.has(absConfig)) continue
        seenConfigs.add(absConfig)
        configFiles.add(absConfig)

        const cwdForProject = dirname(absConfig)
        const extendsPath = current.tsconfig.extends

        if (extendsPath) {
          const resolvedExtends = resolveExtendsConfig(extendsPath, cwdForProject)

          if (resolvedExtends) {
            const { path: extendsConfigPath, tsconfig: nextExtendsConfig } =
              resolvedExtends
            const normalizedExtendsPath = resolve(extendsConfigPath)

            if (includeConfig(normalizedExtendsPath)) {
              configFiles.add(normalizedExtendsPath)
              logVerbose(
                `Including extended tsconfig ${normalizedExtendsPath} in copy plan`,
              )
              queue.push({
                configPath: normalizedExtendsPath,
                tsconfig: nextExtendsConfig,
                projectDir: dirname(normalizedExtendsPath),
              })
            } else {
              if (!normalizedExtendsPath.split(sep).includes('node_modules')) {
                logError(
                  `Referenced config or source is outside the allowed workspace boundary and cannot be patched: ${normalizedExtendsPath}. Move it inside one of: ${allowedConfigRoots.join(', ')} so Duel can create an isolated shadow build.`,
                )
                process.exit(1)
              }

              logVerbose(`Skipping external extended tsconfig ${normalizedExtendsPath}`)
            }
          }
        }
        const files = getCompileFiles(tsc, { project: absConfig, cwd: cwdForProject })

        for (const file of files) {
          compileFiles.add(file)
          const jsSibling = file.replace(/\.(mts|cts|tsx|ts|d\.ts)$/i, '.js')

          if (jsSibling !== file) {
            try {
              await access(jsSibling)
              compileFiles.add(jsSibling)
            } catch {
              /* optional */
            }
          }
        }

        const pkgPath = join(cwdForProject, 'package.json')

        try {
          await access(pkgPath)
          packageJsons.add(pkgPath)
        } catch {
          /* optional */
        }

        for (const ref of current.tsconfig.references ?? []) {
          if (!ref?.path) continue

          const refConfigPath = resolveReferenceConfigPath(cwdForProject, ref.path)
          const refAbsPath = resolve(refConfigPath)

          try {
            const parsed = parseTsconfig(refAbsPath)
            const nextTsconfig = parsed?.tsconfig ?? parsed

            if (nextTsconfig) {
              logVerbose(`Including project reference ${refAbsPath} in copy plan`)
              referenceConfigFiles.add(refAbsPath)
              queue.push({
                configPath: refAbsPath,
                tsconfig: nextTsconfig,
                projectDir: dirname(refAbsPath),
              })
            }
          } catch (err) {
            logWarn(
              `Skipping missing or invalid project reference at ${refAbsPath}: ${err.message}`,
            )
          }
        }
      }

      logVerbose(
        `Copy plan (mode=${copyMode}): ${compileFiles.size} compile files, ${configFiles.size} tsconfig files, ${packageJsons.size} package.json files`,
      )

      return {
        compileFiles: Array.from(compileFiles),
        configFiles,
        referenceConfigFiles,
        packageJsons,
      }
    }
    const syntaxMode = transformSyntax ? true : 'globals-only'
    const logSuccess = start => {
      logSuccessBadge(
        `Successfully created a dual ${isCjsBuild ? 'CJS' : 'ESM'} build in ${Math.round(
          performance.now() - start,
        )}ms.`,
      )
    }

    log('Starting primary build...')

    let success = false
    const startTime = performance.now()

    try {
      await refreshPrimaryBuildInfo()
      await runPrimaryBuild()
      success = true
    } catch ({ message }) {
      handleErrorAndExit(message)
    }

    if (success) {
      const tsconfigRel = requireWorkspaceRelative(configPath)
      const tsconfigDualRel = tsconfigRel.replace(
        /tsconfig\.json$/i,
        `tsconfig.${hash}.json`,
      )
      const dualConfigPath = join(subDir, tsconfigDualRel)
      const dualConfigDir = dirname(dualConfigPath)
      const tsconfigDual = getOverrideTsConfig(dualConfigDir)
      const keepTemp = process.env.DUEL_KEEP_TEMP === '1'
      const { cleanupTemp, cleanupTempSync } = createTempCleanup({
        subDir,
        keepTemp,
        logWarnFn: logWarn,
      })
      const unregisterCleanupHandlers = registerCleanupHandlers(cleanupTempSync)
      let errorMsg = ''
      let exportsConfigData = null

      if (exportsConfig) {
        try {
          exportsConfigData = await readExportsConfig(exportsConfig, pkgDir)
        } catch (err) {
          logError(err.message)
          process.exit(1)
        }
      }

      const { compileFiles, configFiles, referenceConfigFiles, packageJsons } =
        await collectCompileFilesWithReferences({ includeConfig: shouldIncludeConfig })
      const sourceFiles = compileFiles.filter(file => {
        const isSupported = /\.(?:[cm]?jsx?|[cm]?tsx?)$/i.test(file)
        const isDeclaration = /\.d\.[cm]?tsx?$/i.test(file)
        return isSupported && !isDeclaration
      })
      const projectHazards =
        hazardScope === 'project' && hazardMode !== 'off'
          ? await collectProjectDualPackageHazards(sourceFiles, {
              detectDualPackageHazard: hazardMode,
              dualPackageHazardScope: 'project',
              cwd: projectDir,
            })
          : null
      const filteredProjectHazards = projectHazards
        ? new Map(
            [...projectHazards.entries()].map(([key, diags]) => [
              key,
              applyHazardAllowlist(diags ?? []),
            ]),
          )
        : null
      const projectHazardsHaveDiagnostics = filteredProjectHazards
        ? [...filteredProjectHazards.values()].some(diags => diags?.length)
        : false
      const projectHazardsHaveLocations = filteredProjectHazards
        ? [...filteredProjectHazards.values()].some(diags =>
            diags?.some(diag => diag?.filePath),
          )
        : false

      if (filteredProjectHazards) {
        let hasHazardError = false

        for (const diags of filteredProjectHazards.values()) {
          if (!diags?.length) continue
          const errored = logDiagnosticsWithAllowlist(diags)
          hasHazardError = hasHazardError || errored
        }

        if (hasHazardError && hazardMode === 'error') {
          process.exit(1)
        }
      }

      await Promise.all([
        mkdir(subDir, { recursive: true }),
        mkdir(cacheDir, { recursive: true }),
      ])

      const linkNodeModulesPromise = maybeLinkNodeModules(projectDir, subDir)
      const projectRel = requireWorkspaceRelative(projectDir)
      const projectCopyDest = projectRel === '.' ? subDir : join(subDir, projectRel)
      const makeCopyFilter = (rootDir, allowDist) => src => {
        if (src.split(/[/\\]/).includes('.duel-cache')) return false
        if (src.split(/[/\\]/).includes('node_modules')) return false

        if (allowDist) return true

        const rel = relative(rootDir, src)

        if (rel.startsWith('..')) return true

        const [segment] = rel.split(sep)

        return segment !== outDir
      }
      const copyFilesToTemp = async () => {
        const copyDirContents = async (sourceDir, destDir, allowDist) => {
          await mkdir(destDir, { recursive: true })
          const filter = makeCopyFilter(sourceDir, allowDist)
          const entries = await readdir(sourceDir, { withFileTypes: true })

          for (const entry of entries) {
            const srcPath = join(sourceDir, entry.name)
            if (!filter(srcPath)) continue
            const dstPath = join(destDir, entry.name)

            await cp(srcPath, dstPath, {
              recursive: true,
              filter,
            })
          }
        }

        if (copyMode === 'full') {
          const allowDist = true

          await copyDirContents(projectDir, projectCopyDest, allowDist)

          if (hasReferences) {
            for (const ref of tsconfig.references ?? []) {
              if (!ref.path) continue
              const refAbs = resolve(projectDir, ref.path)
              const refRel = requireWorkspaceRelative(refAbs)
              const refDest = join(subDir, refRel)

              await copyDirContents(refAbs, refDest, allowDist)
            }
          }
        } else {
          const filesToCopy = new Set([...compileFiles, ...configFiles, ...packageJsons])

          for (const file of filesToCopy) {
            const normalized = resolve(file)

            if (!isInAllowedRoots(normalized)) {
              logVerbose(`Skipping non-local file ${normalized}`)
              continue
            }

            const rel = toWorkspaceRelative(normalized)
            const dest = join(subDir, rel)

            await mkdir(dirname(dest), { recursive: true })
            await cp(file, dest)
          }

          const missingConfigs = []

          for (const configFile of configFiles) {
            const dest = join(subDir, requireWorkspaceRelative(configFile))

            try {
              await access(dest)
            } catch {
              missingConfigs.push({ src: configFile, dest })
            }
          }

          if (missingConfigs.length) {
            logWarn(
              `Copying ${missingConfigs.length} missing referenced config(s) into temp workspace: ${missingConfigs
                .map(entry => entry.src)
                .join(', ')}`,
            )

            for (const { src, dest } of missingConfigs) {
              await mkdir(dirname(dest), { recursive: true })
              await cp(src, dest)
            }
          }
        }
      }
      const toShadowPath = absPath => join(subDir, requireWorkspaceRelative(absPath))

      // Patch referenced tsconfig files in the shadow workspace to emit dual outputs
      const patchReferencedConfigs = async () => {
        for (const configFile of referenceConfigFiles) {
          if (configFile === configPath) continue

          const dest = join(subDir, requireWorkspaceRelative(configFile))

          const parsed = parseTsconfig(dest)
          const cfg = parsed?.tsconfig ?? parsed

          if (!cfg || typeof cfg !== 'object') continue

          const cfgDir = dirname(configFile)
          const baseOut = cfg.compilerOptions?.outDir
            ? resolve(cfgDir, cfg.compilerOptions.outDir)
            : resolve(cfgDir, 'dist')
          const dualOutReal = join(baseOut, isCjsBuild ? 'cjs' : 'esm')
          const dualOut = toShadowPath(dualOutReal)
          const tsbuildReal = cfg.compilerOptions?.tsBuildInfoFile
            ? resolve(cfgDir, cfg.compilerOptions.tsBuildInfoFile)
            : join(baseOut, 'tsconfig.tsbuildinfo')
          const dualTsbuild = toShadowPath(
            join(dirname(tsbuildReal), 'tsconfig.dual.tsbuildinfo'),
          )
          const shadowReferences = mapReferencesToShadow(cfg.references ?? [], {
            resolveRefPath: refPath => resolveReferenceConfigPath(cfgDir, refPath),
            toShadowPathFn: toShadowPath,
            fromDir: dirname(dest),
          })
          const patched = {
            ...cfg,
            references: shadowReferences,
            compilerOptions: {
              ...(cfg.compilerOptions ?? {}),
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              outDir: dualOut,
              incremental: cfg.compilerOptions?.incremental ?? true,
              tsBuildInfoFile: dualTsbuild,
            },
          }

          await writeFile(dest, JSON.stringify(patched, null, 2))
        }
      }

      /**
       * Write dual package.json and tsconfig into temp dir; avoid mutating root package.json.
       */
      await copyFilesToTemp()
      await patchReferencedConfigs()

      const writeDualPackage = async () => {
        const pkgDest = join(subDir, requireWorkspaceRelative(pkg.path))

        await mkdir(dirname(pkgDest), { recursive: true })
        await writeFile(
          pkgDest,
          JSON.stringify(
            {
              name: pkg.packageJson?.name,
              version: pkg.packageJson?.version,
              type: isCjsBuild ? 'commonjs' : 'module',
              exports: pkg.packageJson?.exports,
              imports: pkg.packageJson?.imports,
              main: pkg.packageJson?.main,
              module: pkg.packageJson?.module,
              types: pkg.packageJson?.types ?? pkg.packageJson?.typings,
              typesVersions: pkg.packageJson?.typesVersions,
              sideEffects: pkg.packageJson?.sideEffects,
            },
            null,
            2,
          ),
        )
      }

      const writeDualConfig = async () => {
        await mkdir(dualConfigDir, { recursive: true })
        await writeFile(
          dualConfigPath,
          JSON.stringify(
            {
              ...tsconfigDual,
              compilerOptions: {
                ...tsconfigDual.compilerOptions,
                outDir: shadowDualOutDir,
                incremental: true,
                tsBuildInfoFile: dualTsBuildInfoFile,
              },
            },
            null,
            2,
          ),
        )
      }

      await Promise.all([linkNodeModulesPromise, writeDualPackage(), writeDualConfig()])

      if (modules) {
        /**
         * Transform ambiguous modules for the target dual build.
         * @see https://github.com/microsoft/TypeScript/issues/58658
         */
        const toTransform = await glob(
          `${subDir.replace(/\\/g, '/')}/**/*{.js,.jsx,.ts,.tsx}`,
          {
            ignore: `${subDir.replace(/\\/g, '/')}/**/node_modules/**`,
          },
        )
        let transformDiagnosticsError = false
        /**
         * If project-scope hazards didn't surface file paths, fall back to
         * file-scope detection during the transform pass so we can emit
         * per-file diagnostics. Otherwise, keep project scope to avoid
         * duplicate warnings.
         */
        const shouldFallbackToFileScope =
          hazardScope === 'project' &&
          projectHazardsHaveDiagnostics &&
          !projectHazardsHaveLocations
        const transformHazardScope = shouldFallbackToFileScope ? 'file' : hazardScope
        const transformHazardMode =
          hazardScope === 'project'
            ? shouldFallbackToFileScope
              ? hazardMode
              : 'off'
            : hazardMode

        for (const file of toTransform) {
          if (file.split(/[/\\]/).includes('node_modules')) continue
          const isTsLike = /\.[cm]?tsx?$/.test(file)
          const transformSyntaxMode =
            syntaxMode === true && isTsLike ? 'globals-only' : syntaxMode
          const diagnostics = []

          await transform(file, {
            out: file,
            target: isCjsBuild ? 'commonjs' : 'module',
            transformSyntax: transformSyntaxMode,
            detectDualPackageHazard: transformHazardMode,
            dualPackageHazardScope: transformHazardScope,
            dualPackageHazardAllowlist: [...hazardAllowlist],
            cwd: projectDir,
            diagnostics: diag => diagnostics.push(diag),
          })

          const normalizedDiagnostics = diagnostics.map(diag =>
            !diag?.filePath && transformHazardScope === 'file'
              ? { ...diag, filePath: file }
              : diag,
          )
          const filteredDiagnostics = applyHazardAllowlist(normalizedDiagnostics)
          const errored = processDiagnosticsForFile(
            filteredDiagnostics,
            projectDir,
            logDiagnosticsWithAllowlist,
          )
          transformDiagnosticsError = transformDiagnosticsError || errored
        }

        exitOnDiagnostics(transformDiagnosticsError)
      }

      // Build dual
      log('Starting dual build...')
      try {
        await refreshDualBuildInfo()
        await runBuild(
          dualConfigPath,
          hasReferences ? undefined : shadowDualOutDir,
          hasReferences ? undefined : dualTsBuildInfoFile,
          subDir,
        )
      } catch ({ message }) {
        success = false
        errorMsg = message
      }

      if (!success) {
        await cleanupTemp()
        unregisterCleanupHandlers()
        if (errorMsg) {
          handleErrorAndExit(errorMsg)
        }
      }

      if (success) {
        const dualTarget = isCjsBuild ? 'commonjs' : 'module'
        const dualTargetExt = isCjsBuild ? '.cjs' : dirs ? '.js' : '.mjs'
        await rm(absoluteDualOutDir, { force: true, recursive: true })
        await mkdir(dirname(absoluteDualOutDir), { recursive: true })
        // Only copy if the shadow dual outDir was produced; absent indicates a failed emit
        try {
          await cp(shadowDualOutDir, absoluteDualOutDir, { recursive: true })
        } catch (err) {
          if (err?.code === 'ENOENT') {
            throw new Error(`Dual build output not found at ${shadowDualOutDir}`)
          }
          throw err
        }
        const dualGlob =
          dualTarget === 'commonjs' ? '**/*{.js,.cjs,.d.ts}' : '**/*{.js,.mjs,.d.ts}'
        const filenames = await glob(
          `${absoluteDualOutDir.replace(/\\/g, '/')}/${dualGlob}`,
          {
            ignore: `${absoluteDualOutDir.replace(/\\/g, '/')}/**/node_modules/**`,
          },
        )
        const rewriteSyntaxMode = dualTarget === 'commonjs' ? true : syntaxMode
        let rewriteDiagnosticsError = false
        const handleRewriteDiagnostic = diag => {
          const filtered = applyHazardAllowlist([diag])
          const errored = processDiagnosticsForFile(
            filtered,
            projectDir,
            logDiagnosticsWithAllowlist,
          )
          rewriteDiagnosticsError = rewriteDiagnosticsError || errored
        }

        await rewriteSpecifiersAndExtensions(filenames, {
          target: dualTarget,
          ext: dualTargetExt,
          syntaxMode: rewriteSyntaxMode,
          detectDualPackageHazard: hazardMode,
          dualPackageHazardScope: hazardScope,
          dualPackageHazardAllowlist: [...hazardAllowlist],
          onDiagnostics: handleRewriteDiagnostic,
          rewritePolicy,
          validateSpecifiers,
          onWarn: message => logWarn(message),
          onRewrite: (from, to) => logVerbose(`Rewrote specifiers in ${from} -> ${to}`),
        })

        if (dirs && originalType === 'commonjs') {
          const primaryFiles = await glob(
            `${primaryOutDir.replace(/\\/g, '/')}/**/*{.js,.cjs,.d.ts}`,
            {
              ignore: `${primaryOutDir.replace(/\\/g, '/')}/**/node_modules/**`,
            },
          )

          await rewriteSpecifiersAndExtensions(primaryFiles, {
            target: 'commonjs',
            ext: '.cjs',
            // Always lower syntax for primary CJS output when dirs mode rewrites primary build.
            syntaxMode: true,
            detectDualPackageHazard: hazardMode,
            dualPackageHazardScope: hazardScope,
            dualPackageHazardAllowlist: [...hazardAllowlist],
            onDiagnostics: handleRewriteDiagnostic,
            rewritePolicy,
            validateSpecifiers,
            onWarn: message => logWarn(message),
            onRewrite: (from, to) => logVerbose(`Rewrote specifiers in ${from} -> ${to}`),
          })
        }

        exitOnDiagnostics(rewriteDiagnosticsError)

        const esmRoot = isCjsBuild ? primaryOutDir : absoluteDualOutDir
        const cjsRoot = isCjsBuild ? absoluteDualOutDir : primaryOutDir

        await runExportsValidationBlock({
          exportsOpt,
          exportsConfigData,
          exportsValidate,
          pkg,
          pkgDir,
          esmRoot,
          cjsRoot,
          mainDefaultKind,
          mainPath,
        })
        await cleanupTemp()
        unregisterCleanupHandlers()
        logSuccess(startTime)
      }
    }
  }
}

const getCurrentHref = () => {
  if (typeof import.meta !== 'undefined' && import.meta.url) return import.meta.url
  if (typeof module !== 'undefined' && module?.filename) {
    return pathToFileURL(module.filename).href
  }
  return null
}

const runIfEntry = async () => {
  try {
    const realFileUrlArgv1 = await getRealPathAsFileUrl(argv[1] ?? '')
    const currentHref = getCurrentHref()

    if (currentHref && currentHref === realFileUrlArgv1) {
      await duel()
    }
  } catch (err) {
    logError(err?.message ?? err)
    process.exit(1)
  }
}

runIfEntry()

export { duel }
