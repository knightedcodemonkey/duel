#!/usr/bin/env node

import { argv, cwd } from 'node:process'
import { join, dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { writeFile, rm, cp, rename, stat, access, constants } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import { glob } from 'glob'
import { specifier } from '@knighted/specifier'

import { init } from './init.js'
import { getRealPathAsFileUrl, logError, log } from './util.js'

const tsc = join(cwd(), 'node_modules', '.bin', 'tsc')
const runBuild = (project, outDir) => {
  return new Promise((resolve, reject) => {
    const args = outDir ? ['-p', project, '--outDir', outDir] : ['-p', project]
    const build = spawn(tsc, args, { stdio: 'inherit' })

    build.on('error', err => {
      reject(new Error(`Failed to compile: ${err.message}`))
    })

    build.on('close', code => {
      if (code === null) {
        return reject(new Error('Failed to compile.'))
      }

      if (code > 0) {
        return reject(new Error('Compilation errors found.'))
      }

      resolve(code)
    })
  })
}
const duel = async args => {
  const ctx = await init(args)

  if (ctx) {
    const { projectDir, tsconfig, configPath, parallel, dirs, pkg } = ctx
    const pkgDir = dirname(pkg.path)
    const outDir = tsconfig.compilerOptions?.outDir ?? 'dist'
    const absoluteOutDir = resolve(projectDir, outDir)
    const originalType = pkg.packageJson.type ?? 'commonjs'
    const isCjsBuild = originalType !== 'commonjs'
    const targetExt = isCjsBuild ? '.cjs' : '.mjs'
    const hex = randomBytes(4).toString('hex')
    const getOverrideTsConfig = dualOutDir => {
      return {
        ...tsconfig,
        compilerOptions: {
          ...tsconfig.compilerOptions,
          outDir: dualOutDir,
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
            ? join(projectDir, outDir, 'esm')
            : join(projectDir, outDir, 'cjs')
          : undefined,
      )
    }
    const updateSpecifiersAndFileExtensions = async filenames => {
      for (const filename of filenames) {
        const dts = /(\.d\.ts)$/
        const outFilename = dts.test(filename)
          ? filename.replace(dts, isCjsBuild ? '.d.cts' : '.d.mts')
          : filename.replace(/\.js$/, targetExt)
        const code = await specifier.update(filename, ({ value }) => {
          // Collapse any BinaryExpression or NewExpression to test for a relative specifier
          const collapsed = value.replace(/['"`+)\s]|new String\(/g, '')
          const relative = /^(?:\.|\.\.)\//

          if (relative.test(collapsed)) {
            // $2 is for any closing quotation/parens around BE or NE
            return value.replace(/(.+)\.js([)'"`]*)?$/, `$1${targetExt}$2`)
          }
        })

        await writeFile(outFilename, code)
        await rm(filename, { force: true })
      }
    }
    const logSuccess = start => {
      log(
        `Successfully created a dual ${isCjsBuild ? 'CJS' : 'ESM'} build in ${Math.round(
          performance.now() - start,
        )}ms.`,
      )
    }

    if (parallel) {
      const paraName = `_${hex}_`
      const paraParent = join(projectDir, '..')
      const paraTempDir = join(paraParent, paraName)
      let isDirWritable = true

      try {
        const stats = await stat(paraParent)

        if (stats.isDirectory()) {
          await access(paraParent, constants.W_OK)
        } else {
          isDirWritable = false
        }
      } catch {
        isDirWritable = false
      }

      if (!isDirWritable) {
        logError('No writable directory to prepare parallel builds. Exiting.')
        return
      }

      log('Preparing parallel build...')

      const prepStart = performance.now()

      await cp(projectDir, paraTempDir, {
        recursive: true,
        /**
         * Ignore common .gitignored directories in Node.js projects.
         * Except node_modules.
         *
         * @see https://github.com/github/gitignore/blob/main/Node.gitignore
         */
        filter: src =>
          !/logs|pids|lib-cov|coverage|bower_components|build|dist|jspm_packages|web_modules|out|\.next|\.tsbuildinfo|\.npm|\.node_repl_history|\.tgz|\.yarn|\.pnp|\.nyc_output|\.grunt/i.test(
            src,
          ),
      })

      const dualConfigPath = join(paraTempDir, 'tsconfig.json')
      const dualOutDir = isCjsBuild ? join(outDir, 'cjs') : join(outDir, 'esm')
      const tsconfigDual = getOverrideTsConfig(dualOutDir)

      await writeFile(dualConfigPath, JSON.stringify(tsconfigDual))
      await writeFile(
        join(paraTempDir, 'package.json'),
        JSON.stringify({
          type: isCjsBuild ? 'commonjs' : 'module',
        }),
      )

      log(`Prepared in ${Math.round(performance.now() - prepStart)}ms.`)
      log('Starting parallel dual builds...')

      let success = false
      const startTime = performance.now()

      try {
        await Promise.all([runPrimaryBuild(), runBuild(dualConfigPath)])
        success = true
      } catch ({ message }) {
        logError(message)
      }

      if (success) {
        const absoluteDualOutDir = join(paraTempDir, dualOutDir)
        const filenames = await glob(`${absoluteDualOutDir}/**/*{.js,.d.ts}`, {
          ignore: 'node_modules/**',
        })

        await updateSpecifiersAndFileExtensions(filenames)
        // Copy over and cleanup
        await cp(absoluteDualOutDir, join(absoluteOutDir, isCjsBuild ? 'cjs' : 'esm'), {
          recursive: true,
        })
        await rm(paraTempDir, { force: true, recursive: true })

        logSuccess(startTime)
      }
    } else {
      log('Starting primary build...')

      let success = false
      const startTime = performance.now()

      try {
        await runPrimaryBuild()
        success = true
      } catch ({ message }) {
        logError(message)
      }

      if (success) {
        const dualConfigPath = join(projectDir, `tsconfig.${hex}.json`)
        const dualOutDir = isCjsBuild ? join(outDir, 'cjs') : join(outDir, 'esm')
        const tsconfigDual = getOverrideTsConfig(dualOutDir)
        const pkgRename = 'package.json.bak'

        /**
         * Create a new package.json with updated `type` field.
         * Create a new tsconfig.json.
         *
         * The need to create a new package.json makes doing
         * the builds in parallel difficult.
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
          await runBuild(dualConfigPath)
        } catch ({ message }) {
          success = false
          logError(message)
        }

        // Cleanup and restore
        await rm(dualConfigPath, { force: true })
        await rm(pkg.path, { force: true })
        await rename(join(pkgDir, pkgRename), pkg.path)

        if (success) {
          const absoluteDualOutDir = join(projectDir, dualOutDir)
          const filenames = await glob(`${absoluteDualOutDir}/**/*{.js,.d.ts}`, {
            ignore: 'node_modules/**',
          })

          await updateSpecifiersAndFileExtensions(filenames)
          logSuccess(startTime)
        }
      }
    }
  }
}
const realFileUrlArgv1 = await getRealPathAsFileUrl(argv[1])

if (import.meta.url === realFileUrlArgv1) {
  await duel()
}

export { duel }
