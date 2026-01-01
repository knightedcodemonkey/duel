#!/usr/bin/env node

import { argv } from 'node:process'
import { join, dirname, resolve, relative, sep, normalize } from 'node:path'
import { spawn } from 'node:child_process'
import { writeFile, rm, mkdir, cp, access } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
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
  maybeLinkNodeModules,
  runExportsValidationBlock,
} from './util.js'
import { rewriteSpecifiersAndExtensions } from './resolver.js'

const handleErrorAndExit = message => {
  const parsed = parseInt(message, 10)
  const exitCode = Number.isNaN(parsed) ? 1 : parsed

  logError('Compilation errors found.')
  process.exit(exitCode)
}

const logDiagnostics = (diags, projectDir) => {
  let hasError = false

  for (const diag of diags) {
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

    const runBuild = (project, outDir) => {
      return new Promise((fulfill, rejectBuild) => {
        const useBuildMode = hasReferences
        const tsArgs = useBuildMode
          ? [tsc, '-b', project]
          : outDir
            ? [tsc, '-p', project, '--outDir', outDir]
            : [tsc, '-p', project]
        const build = spawn(process.execPath, tsArgs, { stdio: 'inherit' })

        build.on('exit', code => {
          if (code > 0) {
            return rejectBuild(new Error(code))
          }

          fulfill(code)
        })
      })
    }
    const pkgDir = dirname(pkg.path)
    const mainPath = pkg.packageJson.main
    const mainDefaultKind = mainPath?.endsWith('.cjs') ? 'require' : 'import'
    const outDir = tsconfig.compilerOptions?.outDir ?? 'dist'
    const absoluteOutDir = resolve(projectDir, outDir)
    const originalType = pkg.packageJson.type ?? 'commonjs'
    const isCjsBuild = originalType !== 'commonjs'
    const primaryOutDir = dirs
      ? isCjsBuild
        ? join(absoluteOutDir, 'esm')
        : join(absoluteOutDir, 'cjs')
      : absoluteOutDir
    const hex = randomBytes(4).toString('hex')
    const hazardMode = detectDualPackageHazard ?? 'warn'
    const hazardScope = dualPackageHazardScope ?? 'file'
    const getOverrideTsConfig = () => {
      return {
        ...tsconfig,
        compilerOptions: {
          ...tsconfig.compilerOptions,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
        },
      }
    }
    const hasReferences =
      Array.isArray(tsconfig.references) && tsconfig.references.length > 0
    const runPrimaryBuild = () => {
      return runBuild(configPath, hasReferences ? undefined : primaryOutDir)
    }
    const resolveReferenceConfigPath = (baseDir, refPath) => {
      const abs = resolve(baseDir, refPath)

      return /\.json$/i.test(abs) ? abs : join(abs, 'tsconfig.json')
    }
    const collectCompileFilesWithReferences = async () => {
      const seenConfigs = new Set()
      const compileFiles = new Set()
      const configFiles = new Set()
      const packageJsons = new Set()
      const queue = [{ configPath, tsconfig, projectDir }]
      const isLocalConfig = candidate => {
        const normalized = resolve(candidate)
        return (
          normalized.startsWith(projectDir) &&
          !normalized.split(sep).includes('node_modules')
        )
      }
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

            if (isLocalConfig(extendsConfigPath)) {
              configFiles.add(extendsConfigPath)
              logVerbose(`Including extended tsconfig ${extendsConfigPath} in copy plan`)
              queue.push({
                configPath: extendsConfigPath,
                tsconfig: nextExtendsConfig,
                projectDir: dirname(extendsConfigPath),
              })
            } else {
              logVerbose(`Skipping external extended tsconfig ${extendsConfigPath}`)
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

          try {
            const parsed = parseTsconfig(refConfigPath)
            const nextTsconfig = parsed?.tsconfig ?? parsed

            if (nextTsconfig) {
              logVerbose(`Including project reference ${refConfigPath} in copy plan`)
              queue.push({
                configPath: refConfigPath,
                tsconfig: nextTsconfig,
                projectDir: dirname(refConfigPath),
              })
            }
          } catch (err) {
            logWarn(
              `Skipping missing or invalid project reference at ${refConfigPath}: ${err.message}`,
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
      await runPrimaryBuild()
      success = true
    } catch ({ message }) {
      handleErrorAndExit(message)
    }

    if (success) {
      const projectRoot = dirname(projectDir)
      const parentRoot = dirname(projectRoot)
      const subDir = join(projectRoot, `_${hex}_`)
      const absoluteDualOutDir = join(
        projectDir,
        isCjsBuild ? join(outDir, 'cjs') : join(outDir, 'esm'),
      )
      const tsconfigDual = getOverrideTsConfig()
      const tsconfigRel = relative(projectRoot, configPath)
      const tsconfigDualRel = tsconfigRel.replace(
        /tsconfig\.json$/i,
        `tsconfig.${hex}.json`,
      )
      const dualConfigPath = join(subDir, tsconfigDualRel)
      const dualConfigDir = dirname(dualConfigPath)
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

      const { compileFiles, configFiles, packageJsons } =
        await collectCompileFilesWithReferences()
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

      if (projectHazards) {
        let hasHazardError = false

        for (const diags of projectHazards.values()) {
          if (!diags?.length) continue
          const errored = logDiagnostics(diags, projectDir)
          hasHazardError = hasHazardError || errored
        }

        if (hasHazardError && hazardMode === 'error') {
          process.exit(1)
        }
      }

      await mkdir(subDir, { recursive: true })
      await maybeLinkNodeModules(projectRoot, subDir)
      const projectRel = relative(projectRoot, projectDir)
      const projectCopyDest = join(subDir, projectRel)
      const makeCopyFilter = (rootDir, allowDist) => src => {
        if (src.split(/[/\\]/).includes('node_modules')) return false

        if (allowDist) return true

        const rel = relative(rootDir, src)

        if (rel.startsWith('..')) return true

        const [segment] = rel.split(sep)

        return segment !== outDir
      }
      const copyProjectTree = async allowDist => {
        await cp(projectDir, projectCopyDest, {
          recursive: true,
          filter: makeCopyFilter(projectDir, allowDist),
        })

        if (hasReferences) {
          for (const ref of tsconfig.references ?? []) {
            if (!ref.path) continue
            const refAbs = resolve(projectDir, ref.path)
            const refRel = relative(projectRoot, refAbs)
            const refDest = join(subDir, refRel)

            await cp(refAbs, refDest, {
              recursive: true,
              filter: makeCopyFilter(refAbs, allowDist),
            })
          }
        }
      }

      if (copyMode === 'full') {
        const allowDist = hasReferences

        await copyProjectTree(allowDist)
      } else {
        const filesToCopy = new Set([...compileFiles, ...configFiles, ...packageJsons])

        for (const file of filesToCopy) {
          let rel = relative(projectRoot, file)
          rel = normalize(rel)

          if (rel.startsWith('..')) {
            const altRel = hasReferences ? normalize(relative(parentRoot, file)) : rel

            if (!altRel.startsWith('..')) {
              rel = altRel
            } else {
              logWarn(`Skipping copy for ${file} outside of project root ${projectRoot}`)
              continue
            }
          }

          const dest = join(subDir, rel)

          await mkdir(dirname(dest), { recursive: true })
          await cp(file, dest)
        }

        const missingConfigs = []

        for (const configFile of configFiles) {
          const dest = join(subDir, relative(projectRoot, configFile))

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

      /**
       * Write dual package.json and tsconfig into temp dir; avoid mutating root package.json.
       */
      await writeFile(
        join(subDir, relative(projectRoot, pkg.path)),
        JSON.stringify({
          type: isCjsBuild ? 'commonjs' : 'module',
        }),
      )

      await mkdir(dualConfigDir, { recursive: true })
      await writeFile(
        dualConfigPath,
        JSON.stringify(
          {
            ...tsconfigDual,
            compilerOptions: {
              ...tsconfigDual.compilerOptions,
              outDir: absoluteDualOutDir,
            },
          },
          null,
          2,
        ),
      )

      if (modules) {
        /**
         * Transform ambiguous modules for the target dual build.
         * @see https://github.com/microsoft/TypeScript/issues/58658
         */
        const toTransform = await glob(
          `${subDir.replace(/\\/g, '/')}/**/*{.js,.jsx,.ts,.tsx}`,
          {
            ignore: 'node_modules/**',
          },
        )

        let transformDiagnosticsError = false

        for (const file of toTransform) {
          const isTsLike = /\.[cm]?tsx?$/.test(file)
          const transformSyntaxMode =
            syntaxMode === true && isTsLike ? 'globals-only' : syntaxMode
          const diagnostics = []

          await transform(file, {
            out: file,
            target: isCjsBuild ? 'commonjs' : 'module',
            transformSyntax: transformSyntaxMode,
            // Project-level hazards are collected above; disable file-scope repeats during transform.
            detectDualPackageHazard: hazardScope === 'project' ? 'off' : hazardMode,
            dualPackageHazardScope: hazardScope,
            cwd: projectDir,
            diagnostics: diag => diagnostics.push(diag),
          })

          const errored = processDiagnosticsForFile(
            diagnostics,
            projectDir,
            logDiagnostics,
          )
          transformDiagnosticsError = transformDiagnosticsError || errored
        }

        exitOnDiagnostics(transformDiagnosticsError)
      }

      // Build dual
      log('Starting dual build...')
      try {
        await runBuild(dualConfigPath, hasReferences ? undefined : absoluteDualOutDir)
      } catch ({ message }) {
        success = false
        errorMsg = message
      } finally {
        const keepTemp = process.env.DUEL_KEEP_TEMP === '1'

        // Cleanup temp dir unless debugging is requested
        if (!keepTemp) {
          await rm(dualConfigPath, { force: true })
          await rm(subDir, { force: true, recursive: true })
        } else {
          logWarn(`DUEL_KEEP_TEMP=1 set; temp workspace preserved at ${subDir}`)
        }

        if (errorMsg) {
          handleErrorAndExit(errorMsg)
        }
      }

      if (success) {
        const dualTarget = isCjsBuild ? 'commonjs' : 'module'
        const dualTargetExt = isCjsBuild ? '.cjs' : dirs ? '.js' : '.mjs'
        const filenames = await glob(
          `${absoluteDualOutDir.replace(/\\/g, '/')}/**/*{.js,.d.ts}`,
          {
            ignore: 'node_modules/**',
          },
        )

        await rewriteSpecifiersAndExtensions(filenames, {
          target: dualTarget,
          ext: dualTargetExt,
          syntaxMode,
          rewritePolicy,
          validateSpecifiers,
          onWarn: message => logWarn(message),
          onRewrite: (from, to) => logVerbose(`Rewrote specifiers in ${from} -> ${to}`),
        })

        if (dirs && originalType === 'commonjs') {
          const primaryFiles = await glob(
            `${primaryOutDir.replace(/\\/g, '/')}/**/*{.js,.d.ts}`,
            { ignore: 'node_modules/**' },
          )

          await rewriteSpecifiersAndExtensions(primaryFiles, {
            target: 'commonjs',
            ext: '.cjs',
            syntaxMode,
            rewritePolicy,
            validateSpecifiers,
            onWarn: message => logWarn(message),
            onRewrite: (from, to) => logVerbose(`Rewrote specifiers in ${from} -> ${to}`),
          })
        }

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
        logSuccess(startTime)
      }
    }
  }
}

;(async () => {
  const realFileUrlArgv1 = await getRealPathAsFileUrl(argv[1] ?? '')

  if (import.meta.url === realFileUrlArgv1) {
    await duel()
  }
})()

export { duel }
