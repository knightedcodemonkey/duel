import { parseArgs } from 'node:util'
import { resolve, join, dirname } from 'node:path'
import { stat, readFile } from 'node:fs/promises'

import { logError, log } from './util.js'

const init = async args => {
  const validTargetExts = ['.cjs', '.mjs']
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
          default: '.cjs',
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
      "--project, -p \t\t Compile the project given the path to its configuration file, or to a folder with a 'tsconfig.json'.",
    )
    log(
      '--target-extension, -x \t Sets the file extension for the dual build. [.cjs,.mjs]',
    )
    log('--help, -h \t\t Print this message.')
  } else {
    const { project, 'target-extension': targetExt } = parsed
    let configPath = resolve(project)
    let stats = null

    if (!validTargetExts.includes(targetExt)) {
      logError(
        `Invalid arg '${targetExt}' for --target-extension. Must be one of ${validTargetExts.toString()}`,
      )

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
        tsconfig,
        targetExt,
        projectDir,
        configPath,
        absoluteOutDir: resolve(projectDir, tsconfig.compilerOptions.outDir),
      }
    }
  }

  return false
}

export { init }
