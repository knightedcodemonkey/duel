#!/usr/bin/env node

import { argv, cwd } from 'node:process'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { writeFile, copyFile, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import { glob } from 'glob'
import { specifier } from '@knighted/specifier'

import { init } from './init.js'
import { getRealPathAsFileUrl, logError, log } from './util.js'

const tsc = join(cwd(), 'node_modules', '.bin', 'tsc')
const runBuild = project => {
  const { status, error } = spawnSync(tsc, ['-p', project], { stdio: 'inherit' })

  if (error) {
    logError(`Failed to compile: ${error.message}`)

    return false
  }

  if (status === null) {
    logError(`Failed to compile. The process was terminated.`)

    return false
  }

  if (status > 0) {
    logError('Compilation errors found.')

    return false
  }

  return true
}
const duel = async args => {
  const ctx = await init(args)

  if (ctx) {
    const { projectDir, tsconfig, targetExt, configPath, absoluteOutDir } = ctx
    const startTime = performance.now()

    log('Starting primary build...\n')

    let success = runBuild(configPath)

    if (success) {
      const isCjsBuild = targetExt === '.cjs'
      const hex = randomBytes(4).toString('hex')
      const { outDir } = tsconfig.compilerOptions
      const dualConfigPath = join(projectDir, `tsconfig.${hex}.json`)
      const dualOutDir = isCjsBuild ? join(outDir, 'cjs') : join(outDir, 'mjs')
      // Using structuredClone() would require node >= 17.0.0
      const tsconfigDual = {
        ...tsconfig,
        compilerOptions: {
          ...tsconfig.compilerOptions,
          outDir: dualOutDir,
          module: isCjsBuild ? 'CommonJS' : 'ESNext',
          // Best way to make this work given how tsc works
          moduleResolution: 'Node',
        },
      }

      await writeFile(dualConfigPath, JSON.stringify(tsconfigDual, null, 2))
      log('Starting dual build...\n')
      success = runBuild(dualConfigPath)
      await rm(dualConfigPath, { force: true })

      if (success) {
        const absoluteDualOutDir = join(projectDir, dualOutDir)
        const filenames = await glob(`${absoluteDualOutDir}/**/*{.js,.d.ts}`, {
          ignore: 'node_modules/**',
        })

        for (const filename of filenames) {
          const dts = /(\.d\.ts)$/
          const outFilename = dts.test(filename)
            ? filename.replace(dts, isCjsBuild ? '.d.cts' : '.d.mts')
            : filename.replace(/\.js$/, targetExt)
          const code = await specifier.update(filename, ({ value }) => {
            // Collapse any BinaryExpression or NewExpression to test for a relative specifier
            const collapsed = value.replace(/['"`+)\s]|new String\(/g, '')
            const relative = /^(?:\.|\.\.)\//i

            if (relative.test(collapsed)) {
              // $2 is for any closing quotation/parens around BE or NE
              return value.replace(/(.+)\.js([)'"`]*)?$/, `$1${targetExt}$2`)
            }
          })

          await writeFile(outFilename, code)
          await rm(filename, { force: true })
        }

        /**
         * This is a fix for tsc compiler which doesn't seem to support
         * converting an arbitrary `.ts` file, into another module system,
         * while also preserving the module systems of `.mts` and `.cts` files.
         *
         * Hopefully it can be removed when TS updates their supported options,
         * or at least how the combination of `--module` and `--moduleResolution`
         * currently work.
         *
         * @see https://github.com/microsoft/TypeScript/pull/50985#issuecomment-1656991606
         */
        if (isCjsBuild) {
          const mjsFiles = await glob(`${absoluteOutDir}/**/*.mjs`, {
            ignore: ['node_modules/**', `${absoluteDualOutDir}/**`],
          })

          for (const filename of mjsFiles) {
            const relativeFn = relative(absoluteOutDir, filename)

            await copyFile(filename, join(absoluteDualOutDir, relativeFn))
          }
        } else {
          const cjsFiles = await glob(`${absoluteOutDir}/**/*.cjs`, {
            ignore: ['node_modules/**', `${absoluteDualOutDir}/**`],
          })

          for (const filename of cjsFiles) {
            const relativeFn = relative(absoluteOutDir, filename)

            await copyFile(filename, join(absoluteDualOutDir, relativeFn))
          }

          /**
           * Now copy the good .mjs files from the dual out dir
           * to the original out dir, but build the file path
           * from the original out dir to distinguish from the
           * dual build .mjs files.
           */
          const mjsFiles = await glob(`${absoluteOutDir}/**/*.mjs`, {
            ignore: ['node_modules/**', `${absoluteDualOutDir}/**`],
          })

          for (const filename of mjsFiles) {
            const relativeFn = relative(absoluteOutDir, filename)

            await copyFile(join(absoluteDualOutDir, relativeFn), filename)
          }
        }

        log(
          `Successfully created a dual ${targetExt
            .replace('.', '')
            .toUpperCase()} build in ${Math.round(performance.now() - startTime)}ms.`,
        )
      }
    }
  }
}
const realFileUrlArgv1 = await getRealPathAsFileUrl(argv[1])

if (import.meta.url === realFileUrlArgv1) {
  await duel()
}

export { duel }
