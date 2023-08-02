import { cwd } from 'node:process'
import { parseArgs } from 'node:util'
import { resolve, join, dirname } from 'node:path'
import { stat, readFile } from 'node:fs/promises'

import { readPackageUp } from 'read-pkg-up'

import { logError, log } from './util.js'

const init = async args => {
  let parsed = null

  try {
    const { values } = parseArgs({
      args,
      options: {
        project: {
          type: 'string',
          short: 'p',
          default: 'tsconfig.json',
        },
        'target-extension': {
          type: 'string',
          short: 'x',
          default: '',
        },
        'pkg-dir': {
          type: 'string',
          short: 'k',
          default: cwd(),
        },
        help: {
          type: 'boolean',
          short: 'h',
          default: false,
        },
      },
    })

    parsed = values
  } catch (err) {
    logError(err.message)

    return false
  }

  if (parsed.help) {
    log('Usage: duel [options]\n')
    log('Options:')
    log(
      "--project, -p \t Compile the project given the path to its configuration file, or to a folder with a 'tsconfig.json'.",
    )
    log(
      '--pkg-dir, -k \t The directory to start looking for a package.json file. Defaults to cwd.',
    )
    log('--help, -h \t Print this message.')
  } else {
    const { project, 'target-extension': targetExt, 'pkg-dir': pkgDir } = parsed
    let configPath = resolve(project)
    let stats = null
    let pkg = null

    if (targetExt) {
      logError(
        '--target-extension is deprecated. Define "type" in your package.json instead and the dual build will be inferred from that.',
      )

      return false
    }

    pkg = await readPackageUp({ cwd: pkgDir })

    if (!pkg) {
      logError('No package.json file found.')

      return false
    }

    try {
      stats = await stat(configPath)
    } catch {
      logError(
        `Provided --project '${project}' resolves to ${configPath} which is not a file or directory.`,
      )

      return false
    }

    if (stats.isDirectory()) {
      configPath = join(configPath, 'tsconfig.json')

      try {
        stats = await stat(configPath)
      } catch {
        logError(
          `Provided --project '${project}' resolves to a directory ${dirname(
            configPath,
          )} with no tsconfig.json.`,
        )

        return false
      }
    }

    if (stats.isFile()) {
      let tsconfig = null

      try {
        tsconfig = JSON.parse((await readFile(configPath)).toString())
      } catch (err) {
        logError(`The config file found at ${configPath} is not parsable as JSON.`)

        return false
      }

      if (!tsconfig.compilerOptions?.outDir) {
        logError('You must define an `outDir` in your project config.')

        return false
      }

      const projectDir = dirname(configPath)

      return {
        pkg,
        tsconfig,
        projectDir,
        configPath,
      }
    }
  }

  return false
}

export { init }
