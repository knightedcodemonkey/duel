#!/usr/bin/env node

import { argv, cwd } from 'node:process'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { writeFile, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import { glob } from 'glob'
import { specifier } from '@knighted/specifier'

import { init } from './init.js'
import { getRealPathAsFileUrl, logError, log } from './util.js'

// TypeScript is defined as a peer dependency.
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
    const { projectDir, tsconfig, targetExt, configPath } = ctx
    const startTime = performance.now()

    log('Starting primary build...\n')

    let success = runBuild(configPath)

    if (success) {
      const isCjsBuild = targetExt === '.cjs'
      const hex = randomBytes(4).toString('hex')
      const { outDir } = tsconfig.compilerOptions
      const dualConfigPath = join(projectDir, `tsconfig.${hex}.json`)
      const dualOutDir = isCjsBuild ? join(outDir, 'cjs') : join(outDir, 'mjs')
      const tsconfigDual = {
        ...tsconfig,
        compilerOptions: {
          ...tsconfig.compilerOptions,
          outDir: dualOutDir,
          module: isCjsBuild ? 'CommonJS' : 'NodeNext',
          moduleResolution: isCjsBuild ? 'Node' : 'NodeNext',
        },
      }

      await writeFile(dualConfigPath, JSON.stringify(tsconfigDual, null, 2))
      log('Starting dual build...\n')
      success = runBuild(dualConfigPath)
      await rm(dualConfigPath, { force: true })

      if (success) {
        const filenames = await glob(`${join(projectDir, dualOutDir)}/**/*{.js,.d.ts}`, {
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
