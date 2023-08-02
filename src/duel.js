#!/usr/bin/env node

import { argv, cwd } from 'node:process'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { writeFile, rm, rename } from 'node:fs/promises'
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
    const { projectDir, tsconfig, configPath, pkg } = ctx
    const startTime = performance.now()

    log('Starting primary build...')

    let success = runBuild(configPath)

    if (success) {
      const pkgDir = dirname(pkg.path)
      const originalType = pkg.packageJson.type ?? 'commonjs'
      const isCjsBuild = originalType !== 'commonjs'
      const targetExt = isCjsBuild ? '.cjs' : '.mjs'
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
          module: 'NodeNext',
        },
      }
      const pkgRename = 'package.json.bak'

      // Setup new package.json and tsconfig.json
      await rename(pkg.path, join(pkgDir, pkgRename))
      await writeFile(
        pkg.path,
        JSON.stringify({
          version: '0.0.0',
          type: isCjsBuild ? 'commonjs' : 'module',
        }),
      )
      await writeFile(dualConfigPath, JSON.stringify(tsconfigDual))

      // Build dual
      log('Starting dual build...')
      success = runBuild(dualConfigPath)

      // Cleanup and restore
      await rm(dualConfigPath, { force: true })
      await rm(pkg.path, { force: true })
      await rename(join(pkgDir, pkgRename), pkg.path)

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

        log(
          `Successfully created a dual ${
            isCjsBuild ? 'CJS' : 'ESM'
          } build in ${Math.round(performance.now() - startTime)}ms.`,
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
