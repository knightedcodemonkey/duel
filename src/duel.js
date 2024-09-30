#!/usr/bin/env node

import { argv, platform } from 'node:process'
import { join, dirname, resolve, relative, parse } from 'node:path'
import { spawn } from 'node:child_process'
import { writeFile, rm, rename, mkdir, copyFile, lstat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import { glob } from 'glob'
import { findUp, pathExists } from 'find-up'
import { specifier } from '@knighted/specifier'
import { transform } from '@knighted/module'

import { init } from './init.js'
import { getRealPathAsFileUrl, getCompileFiles, logError, log } from './util.js'

const handleErrorAndExit = message => {
  const exitCode = Number(message)

  if (isNaN(exitCode)) {
    logError(message)
    process.exit(1)
  } else {
    logError('Compilation errors found.')
    process.exit(exitCode)
  }
}
const duel = async args => {
  const ctx = await init(args)

  if (ctx) {
    const { projectDir, tsconfig, configPath, modules, dirs, pkg } = ctx
    const tsc = await findUp(
      async dir => {
        const tscBin = join(dir, 'node_modules', '.bin', 'tsc')

        if (await pathExists(tscBin)) {
          return tscBin
        }
      },
      { cwd: projectDir },
    )
    const runBuild = (project, outDir) => {
      return new Promise((resolve, reject) => {
        const args = outDir ? ['-p', project, '--outDir', outDir] : ['-p', project]
        const build = spawn(tsc, args, { stdio: 'inherit', shell: platform === 'win32' })

        build.on('error', err => {
          reject(new Error(`Failed to compile: ${err.message}`))
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
    const outDir = tsconfig.compilerOptions?.outDir ?? 'dist'
    const absoluteOutDir = resolve(projectDir, outDir)
    const originalType = pkg.packageJson.type ?? 'commonjs'
    const isCjsBuild = originalType !== 'commonjs'
    const targetExt = isCjsBuild ? '.cjs' : '.mjs'
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
      return runBuild(
        configPath,
        dirs
          ? isCjsBuild
            ? join(absoluteOutDir, 'esm')
            : join(absoluteOutDir, 'cjs')
          : absoluteOutDir,
      )
    }
    const updateSpecifiersAndFileExtensions = async filenames => {
      for (const filename of filenames) {
        const dts = /(\.d\.ts)$/
        const outFilename = dts.test(filename)
          ? filename.replace(dts, isCjsBuild ? '.d.cts' : '.d.mts')
          : filename.replace(/\.js$/, targetExt)
        const { code, error } = await specifier.update(filename, ({ value }) => {
          // Collapse any BinaryExpression or NewExpression to test for a relative specifier
          const collapsed = value.replace(/['"`+)\s]|new String\(/g, '')
          const relative = /^(?:\.|\.\.)\//

          if (relative.test(collapsed)) {
            // $2 is for any closing quotation/parens around BE or NE
            return value.replace(/(.+)\.js([)'"`]*)?$/, `$1${targetExt}$2`)
          }
        })

        if (code && !error) {
          await writeFile(outFilename, code)
          await rm(filename, { force: true })
        }
      }
    }
    const logSuccess = start => {
      log(
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
          compileFiles.map(
            async file => {
              const dest = join(
                subDir,
                relative(projectDir, file).replace(/^(\.\.\/)*/, ''),
              )
              const { dir } = parse(dest)

              try {
                await lstat(dir)
              } catch (err) {
                if (err.code === 'ENOENT') {
                  await mkdir(dir, { recursive: true })
                }
              }

              return copyFile(file, dest)
            },
            //cp(file, join(subDir, relative(projectDir, file).replace(/^(\.\.\/)*/, ''))),
          ),
        )

        /**
         * Transform ambiguous modules for the target dual build.
         * @see https://github.com/microsoft/TypeScript/issues/58658
         */
        const toTransform = await glob(`${subDir}/**/*{.js,.jsx,.ts,.tsx}`, {
          ignore: 'node_modules/**',
        })

        for (const file of toTransform) {
          /**
           * Maybe include the option to transform modules implicitly
           * (modules: true) so that `exports` are correctly converted
           * when targeting a CJS dual build. Depends on @knighted/module
           * supporting he `modules` option.
           *
           * @see https://github.com/microsoft/TypeScript/issues/58658
           */
          await transform(file, { out: file, type: isCjsBuild ? 'commonjs' : 'module' })
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
        const filenames = await glob(`${absoluteDualOutDir}/**/*{.js,.d.ts}`, {
          ignore: 'node_modules/**',
        })

        await updateSpecifiersAndFileExtensions(filenames)
        logSuccess(startTime)
      }
    }
  }
}
const realFileUrlArgv1 = await getRealPathAsFileUrl(argv[1])

if (import.meta.url === realFileUrlArgv1) {
  await duel()
}

export { duel }
