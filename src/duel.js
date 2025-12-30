#!/usr/bin/env node

import { argv } from 'node:process'
import {
  join,
  dirname,
  resolve,
  relative,
  parse as parsePath,
  posix,
  isAbsolute,
} from 'node:path'
import { spawn } from 'node:child_process'
import { writeFile, rm, mkdir, cp, access, readFile, symlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import { glob } from 'glob'
import { findUp } from 'find-up'
import { transform } from '@knighted/module'

import { init } from './init.js'
import {
  getRealPathAsFileUrl,
  getCompileFiles,
  log,
  logError,
  logWarn,
  logSuccess as logSuccessBadge,
} from './util.js'
import { rewriteSpecifiersAndExtensions } from './resolver.js'

const stripKnownExt = path => {
  return path.replace(/(\.d\.(?:ts|mts|cts)|\.(?:mjs|cjs|js))$/, '')
}
const ensureDotSlash = path => {
  return path.startsWith('./') ? path : `./${path}`
}

const readExportsConfig = async (configPath, pkgDir) => {
  const abs = isAbsolute(configPath)
    ? configPath
    : configPath.startsWith('.')
      ? resolve(pkgDir, configPath)
      : resolve(process.cwd(), configPath)
  const raw = await readFile(abs, 'utf8')

  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Invalid JSON in --exports-config (${configPath}): ${err.message}`)
  }

  const { entries, main } = parsed

  if (
    !entries ||
    !Array.isArray(entries) ||
    entries.some(item => typeof item !== 'string')
  ) {
    throw new Error(
      '--exports-config expects an object with an "entries" array of strings',
    )
  }

  if (main && typeof main !== 'string') {
    throw new Error('--exports-config "main" must be a string when provided')
  }

  const normalize = value => ensureDotSlash(value.replace(/\\/g, '/'))
  const normalizedEntries = [...new Set(entries.map(normalize))]
  const normalizedMain = main ? normalize(main) : null

  return { entries: normalizedEntries, main: normalizedMain }
}

const getSubpath = (mode, relFromRoot) => {
  const parsed = parsePath(relFromRoot)
  const segments = parsed.dir.split('/').filter(Boolean)

  if (mode === 'name') {
    return parsed.name ? `./${parsed.name}` : null
  }

  if (mode === 'dir') {
    const last = segments.at(-1)
    return last ? `./${last}/*` : null
  }

  if (mode === 'wildcard') {
    const first = segments[0]
    return first ? `./${first}/*` : null
  }

  return null
}

const handleErrorAndExit = message => {
  const parsed = parseInt(message, 10)
  const exitCode = Number.isNaN(parsed) ? 1 : parsed

  logError('Compilation errors found.')
  process.exit(exitCode)
}

const generateExports = async options => {
  const { mode, pkg, pkgDir, esmRoot, cjsRoot, mainDefaultKind, mainPath, entries } =
    options

  const toPosix = path => path.replace(/\\/g, '/')
  const esmRootPosix = toPosix(esmRoot)
  const cjsRootPosix = toPosix(cjsRoot)
  const esmPrefix = toPosix(relative(pkgDir, esmRoot))
  const cjsPrefix = toPosix(relative(pkgDir, cjsRoot))
  const esmIgnore = ['node_modules/**']
  const cjsIgnore = ['node_modules/**']
  const baseMap = new Map()
  const subpathMap = new Map()
  const baseToSubpath = new Map()

  if (cjsRootPosix.startsWith(`${esmRootPosix}/`)) {
    esmIgnore.push(`${cjsRootPosix}/**`)
  }

  if (esmRootPosix.startsWith(`${cjsRootPosix}/`)) {
    cjsIgnore.push(`${esmRootPosix}/**`)
  }

  const toWildcardValue = value => {
    const dir = posix.dirname(value)
    const file = posix.basename(value)
    const dtsMatch = file.match(/(\.d\.(?:ts|mts|cts))$/i)

    if (dtsMatch) {
      const ext = dtsMatch[1]
      return dir === '.' ? `./*${ext}` : `${dir}/*${ext}`
    }

    const ext = posix.extname(file)
    return dir === '.' ? `./*${ext}` : `${dir}/*${ext}`
  }

  const expandEntriesBase = base => {
    const variants = [base]

    if (esmPrefix && cjsPrefix && esmPrefix !== cjsPrefix) {
      const esmPrefixWithSlash = `${esmPrefix}/`
      const cjsPrefixWithSlash = `${cjsPrefix}/`

      if (base.startsWith(esmPrefixWithSlash)) {
        variants.push(base.replace(esmPrefixWithSlash, cjsPrefixWithSlash))
      }

      if (base.startsWith(cjsPrefixWithSlash)) {
        variants.push(base.replace(cjsPrefixWithSlash, esmPrefixWithSlash))
      }
    }

    return variants
  }

  const entriesBase = entries?.length
    ? new Set(
        entries.flatMap(entry => {
          const normalized = stripKnownExt(entry.replace(/^\.\//, ''))
          return expandEntriesBase(normalized)
        }),
      )
    : null

  const recordPath = (kind, filePath, root) => {
    const relPkg = toPosix(relative(pkgDir, filePath))
    const relFromRoot = toPosix(relative(root, filePath))
    const withDot = ensureDotSlash(relPkg)
    const baseKey = stripKnownExt(relPkg)
    const useEntriesSubpaths = Boolean(entriesBase)

    if (entriesBase && !entriesBase.has(baseKey)) {
      return
    }
    const baseEntry = baseMap.get(baseKey) ?? {}

    baseEntry[kind] = withDot
    baseMap.set(baseKey, baseEntry)

    const subpath = useEntriesSubpaths
      ? ensureDotSlash(stripKnownExt(relFromRoot))
      : getSubpath(mode, relFromRoot)
    const useWildcard = subpath?.includes('*')

    if (kind === 'types') {
      const mappedSubpath = baseToSubpath.get(baseKey)

      if (mappedSubpath) {
        const subEntry = subpathMap.get(mappedSubpath) ?? {}
        subEntry.types = useWildcard ? toWildcardValue(withDot) : withDot
        subpathMap.set(mappedSubpath, subEntry)
      }

      return
    }

    if (subpath && subpath !== '.') {
      const subEntry = subpathMap.get(subpath) ?? {}
      subEntry[kind] = useWildcard ? toWildcardValue(withDot) : withDot
      subpathMap.set(subpath, subEntry)
      baseToSubpath.set(baseKey, subpath)
    }
  }

  const esmFiles = await glob(`${esmRootPosix}/**/*.{js,mjs,d.ts,d.mts}`, {
    ignore: esmIgnore,
  })

  for (const file of esmFiles) {
    if (/\.d\.(ts|mts)$/.test(file)) {
      recordPath('types', file, esmRoot)
    } else {
      recordPath('import', file, esmRoot)
    }
  }

  const cjsFiles = await glob(`${cjsRootPosix}/**/*.{js,cjs,d.ts,d.cts}`, {
    ignore: cjsIgnore,
  })

  for (const file of cjsFiles) {
    if (/\.d\.(ts|cts)$/.test(file)) {
      recordPath('types', file, cjsRoot)
    } else {
      recordPath('require', file, cjsRoot)
    }
  }

  const exportsMap = {}
  const mainBase = mainPath ? stripKnownExt(mainPath.replace(/^\.\//, '')) : null
  const mainEntry = mainBase ? (baseMap.get(mainBase) ?? {}) : {}

  if (mainPath) {
    const rootEntry = {}

    if (mainEntry.types) {
      rootEntry.types = mainEntry.types
    }

    if (mainDefaultKind === 'import') {
      rootEntry.import = mainEntry.import ?? ensureDotSlash(mainPath)
      if (mainEntry.require) {
        rootEntry.require = mainEntry.require
      }
    } else {
      rootEntry.require = mainEntry.require ?? ensureDotSlash(mainPath)
      if (mainEntry.import) {
        rootEntry.import = mainEntry.import
      }
    }

    rootEntry.default = ensureDotSlash(mainPath)

    exportsMap['.'] = rootEntry
  }

  const defaultKind = mainDefaultKind ?? 'import'

  for (const [subpath, entry] of subpathMap.entries()) {
    const out = {}

    if (entry.types) {
      out.types = entry.types
    }
    if (entry.import) {
      out.import = entry.import
    }
    if (entry.require) {
      out.require = entry.require
    }

    const def =
      defaultKind === 'import'
        ? (entry.import ?? entry.require)
        : (entry.require ?? entry.import)

    if (def) {
      out.default = def
    }

    if (Object.keys(out).length) {
      exportsMap[subpath] = out
    }
  }

  if (!exportsMap['.']) {
    const firstNonWildcard = [...subpathMap.entries()].find(([key]) => !key.includes('*'))

    if (firstNonWildcard) {
      const [subpath, entry] = firstNonWildcard
      const out = {}

      if (entry.types) {
        out.types = entry.types
      }
      if (entry.import) {
        out.import = entry.import
      }
      if (entry.require) {
        out.require = entry.require
      }

      const def =
        defaultKind === 'import'
          ? (entry.import ?? entry.require)
          : (entry.require ?? entry.import)

      if (def) {
        out.default = def
      }

      if (Object.keys(out).length) {
        exportsMap['.'] = out

        if (!exportsMap[subpath]) {
          exportsMap[subpath] = out
        }
      }
    }
  }

  if (Object.keys(exportsMap).length) {
    if (options.validateOnly) {
      return { exportsMap }
    }

    const pkgJson = {
      ...pkg.packageJson,
      exports: exportsMap,
    }

    await writeFile(pkg.path, `${JSON.stringify(pkgJson, null, 2)}\n`)
  }

  return { exportsMap }
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
      verbose,
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
      return new Promise((resolve, reject) => {
        const useBuildMode = hasReferences
        const args = useBuildMode
          ? [tsc, '-b', project]
          : outDir
            ? [tsc, '-p', project, '--outDir', outDir]
            : [tsc, '-p', project]
        const build = spawn(process.execPath, args, { stdio: 'inherit' })

        build.on('exit', code => {
          if (code > 0) {
            return reject(new Error(code))
          }

          resolve(code)
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

      const compileFiles = getCompileFiles(tsc, projectDir)

      await mkdir(subDir, { recursive: true })
      const nodeModules = await findUp('node_modules', {
        cwd: projectRoot,
        type: 'directory',
      })
      if (nodeModules) {
        try {
          await symlink(nodeModules, join(subDir, 'node_modules'), 'junction')
        } catch {
          /* If symlink fails, fall back to existing resolution. */
        }
      }
      const projectRel = relative(projectRoot, projectDir)
      const projectCopyDest = join(subDir, projectRel)

      const allowDist = hasReferences

      await cp(projectDir, projectCopyDest, {
        recursive: true,
        filter: src =>
          !/\bnode_modules\b/.test(src) && (allowDist || !/\bdist\b/.test(src)),
      })

      if (hasReferences) {
        for (const ref of tsconfig.references ?? []) {
          if (!ref.path) continue
          const refAbs = resolve(projectDir, ref.path)
          const refRel = relative(projectRoot, refAbs)
          const refDest = join(subDir, refRel)

          await cp(refAbs, refDest, {
            recursive: true,
            filter: src =>
              !/\bnode_modules\b/.test(src) && (allowDist || !/\bdist\b/.test(src)),
          })
        }
      }

      await Promise.all(
        compileFiles.map(async file => {
          const dest = join(subDir, relative(projectRoot, file))

          await mkdir(dirname(dest), { recursive: true })
          await cp(file, dest)
        }),
      )

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

        for (const file of toTransform) {
          const isTsLike = /\.[cm]?tsx?$/.test(file)
          const transformSyntaxMode =
            syntaxMode === true && isTsLike ? 'globals-only' : syntaxMode

          await transform(file, {
            out: file,
            target: isCjsBuild ? 'commonjs' : 'module',
            transformSyntax: transformSyntaxMode,
          })
        }
      }

      // Build dual
      log('Starting dual build...')
      try {
        await runBuild(dualConfigPath, hasReferences ? undefined : absoluteDualOutDir)
      } catch ({ message }) {
        success = false
        errorMsg = message
      } finally {
        // Cleanup temp dir
        await rm(dualConfigPath, { force: true })
        await rm(subDir, { force: true, recursive: true })

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

        if (exportsOpt || exportsConfigData || exportsValidate) {
          const esmRoot = isCjsBuild ? primaryOutDir : absoluteDualOutDir
          const cjsRoot = isCjsBuild ? absoluteDualOutDir : primaryOutDir

          if (exportsValidate && !exportsOpt && !exportsConfigData) {
            logWarn(
              '--exports-validate has no effect without --exports or --exports-config',
            )
          }

          await generateExports({
            mode: exportsOpt,
            pkg,
            pkgDir,
            esmRoot,
            cjsRoot,
            mainDefaultKind,
            mainPath: exportsConfigData?.main ?? mainPath,
            entries: exportsConfigData?.entries,
            validateOnly: exportsValidate,
          })

          if (exportsValidate) {
            log('Exports validation successful.')
            if (!exportsOpt && !exportsConfigData) {
              logWarn(
                'No exports were written; use --exports or --exports-config to emit exports.',
              )
            }
          }
        }
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
