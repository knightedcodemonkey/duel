#!/usr/bin/env node

import { argv, platform } from 'node:process'
import { join, dirname, resolve, relative, parse as parsePath, posix } from 'node:path'
import { spawn } from 'node:child_process'
import { writeFile, rm, rename, mkdir, cp, access, readFile } from 'node:fs/promises'
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
  logSuccess as logSuccessBadge,
} from './util.js'

const stripKnownExt = path => {
  return path.replace(/(\.d\.(?:ts|mts|cts)|\.(?:mjs|cjs|js))$/, '')
}
const isWin = platform === 'win32'

const ensureDotSlash = path => {
  return path.startsWith('./') ? path : `./${path}`
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
  const { mode, pkg, pkgDir, esmRoot, cjsRoot, mainDefaultKind, mainPath } = options

  const toPosix = path => path.replace(/\\/g, '/')
  const esmRootPosix = toPosix(esmRoot)
  const cjsRootPosix = toPosix(cjsRoot)
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

  const recordPath = (kind, filePath, root) => {
    const relPkg = toPosix(relative(pkgDir, filePath))
    const relFromRoot = toPosix(relative(root, filePath))
    const withDot = ensureDotSlash(relPkg)
    const baseKey = stripKnownExt(relPkg)
    const baseEntry = baseMap.get(baseKey) ?? {}

    baseEntry[kind] = withDot
    baseMap.set(baseKey, baseEntry)

    const subpath = getSubpath(mode, relFromRoot)
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
    const pkgJson = {
      ...pkg.packageJson,
      exports: exportsMap,
    }

    await writeFile(pkg.path, `${JSON.stringify(pkgJson, null, 2)}\n`)
  }
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
    } = ctx
    const tsc = await findUp(
      async dir => {
        const tscBin = join(dir, 'node_modules', '.bin', 'tsc')
        const candidates = isWin ? [`${tscBin}.cmd`, `${tscBin}.ps1`, tscBin] : [tscBin]

        for (const candidate of candidates) {
          try {
            await access(candidate)
            return resolve(candidate)
          } catch {
            /* continue */
          }
        }
      },
      { cwd: projectDir },
    )
    const runBuild = (project, outDir) => {
      return new Promise((resolve, reject) => {
        const args = outDir ? ['-p', project, '--outDir', outDir] : ['-p', project]
        const build = spawn(tsc, args, { stdio: 'inherit', shell: false })

        build.on('error', err => {
          logError(`Failed to start tsc at ${tsc}: ${err.message}`)
          reject(err)
        })

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
    const runPrimaryBuild = () => {
      return runBuild(configPath, primaryOutDir)
    }
    const syntaxMode = transformSyntax ? true : 'globals-only'

    const updateSpecifiersAndFileExtensions = async (filenames, target, ext) => {
      for (const filename of filenames) {
        const dts = /(\.d\.ts)$/
        const isDts = dts.test(filename)
        const outFilename = isDts
          ? filename.replace(dts, target === 'commonjs' ? '.d.cts' : '.d.mts')
          : filename.replace(/\.js$/, ext)

        if (isDts) {
          const source = await readFile(filename, 'utf8')
          const rewritten = source.replace(
            /(?<=['"])(\.\.?(?:\/[\w.-]+)*)\.js(?=['"])/g,
            `$1${ext}`,
          )

          await writeFile(outFilename, rewritten)

          if (outFilename !== filename) {
            await rm(filename, { force: true })
          }

          continue
        }

        const rewriteSpecifier = (value = '') => {
          const collapsed = value.replace(/['"`+)\s]|new String\(/g, '')
          if (/^(?:\.|\.\.)\//.test(collapsed)) {
            return value.replace(/(.+)\.js([)"'`]*)?$/, `$1${ext}$2`)
          }
        }

        const writeOptions = {
          target,
          rewriteSpecifier,
          transformSyntax: syntaxMode,
          ...(outFilename === filename ? { inPlace: true } : { out: outFilename }),
        }

        await transform(filename, writeOptions)

        if (outFilename !== filename) {
          await rm(filename, { force: true })
        }
      }
    }
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
      const subDir = join(projectDir, `_${hex}_`)
      const absoluteDualOutDir = join(
        projectDir,
        isCjsBuild ? join(outDir, 'cjs') : join(outDir, 'esm'),
      )
      const tsconfigDual = getOverrideTsConfig()
      const pkgRename = 'package.json.bak'
      let dualConfigPath = join(projectDir, `tsconfig.${hex}.json`)
      let errorMsg = ''

      if (modules) {
        const compileFiles = getCompileFiles(tsc, projectDir)

        dualConfigPath = join(subDir, `tsconfig.${hex}.json`)
        await mkdir(subDir)
        await Promise.all(
          compileFiles.map(async file => {
            const dest = join(
              subDir,
              relative(projectDir, file).replace(/^(\.\.\/)+/, ''),
            )

            await mkdir(dirname(dest), { recursive: true })
            await cp(file, dest)
          }),
        )

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

      /**
       * Create a new package.json with updated `type` field.
       * Create a new tsconfig.json.
       */
      await rename(pkg.path, join(pkgDir, pkgRename))
      await writeFile(
        pkg.path,
        JSON.stringify({
          type: isCjsBuild ? 'commonjs' : 'module',
        }),
      )
      await writeFile(dualConfigPath, JSON.stringify(tsconfigDual))

      // Build dual
      log('Starting dual build...')
      try {
        await runBuild(dualConfigPath, absoluteDualOutDir)
      } catch ({ message }) {
        success = false
        errorMsg = message
      } finally {
        // Cleanup and restore
        await rm(dualConfigPath, { force: true })
        await rm(pkg.path, { force: true })
        await rm(subDir, { force: true, recursive: true })
        await rename(join(pkgDir, pkgRename), pkg.path)

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

        await updateSpecifiersAndFileExtensions(filenames, dualTarget, dualTargetExt)

        if (dirs && originalType === 'commonjs') {
          const primaryFiles = await glob(
            `${primaryOutDir.replace(/\\/g, '/')}/**/*{.js,.d.ts}`,
            { ignore: 'node_modules/**' },
          )

          await updateSpecifiersAndFileExtensions(primaryFiles, 'commonjs', '.cjs')
        }

        if (exportsOpt) {
          const esmRoot = isCjsBuild ? primaryOutDir : absoluteDualOutDir
          const cjsRoot = isCjsBuild ? absoluteDualOutDir : primaryOutDir

          await generateExports({
            mode: exportsOpt,
            pkg,
            pkgDir,
            esmRoot,
            cjsRoot,
            mainDefaultKind,
            mainPath,
          })
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
