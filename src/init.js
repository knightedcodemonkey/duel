import { parseArgs } from 'node:util'
import { resolve, join, dirname } from 'node:path'
import { stat } from 'node:fs/promises'

import { parseTsconfig } from 'get-tsconfig'
import { readPackageUp } from 'read-package-up'

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
        },
        modules: {
          type: 'boolean',
          short: 'm',
          default: false,
        },
        dirs: {
          type: 'boolean',
          short: 'd',
          default: false,
        },
        exports: {
          type: 'string',
          short: 'e',
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
    const bare = { bare: true }
    log('Usage: duel [options]\n', 'info', bare)
    log('Options:', 'info', bare)
    log(
      "--project, -p [path] \t Compile the project given the path to its configuration file, or to a folder with a 'tsconfig.json'.",
      'info',
      bare,
    )
    log(
      '--pkg-dir, -k [path] \t The directory to start looking for a package.json file. Defaults to --project directory.',
      'info',
      bare,
    )
    log(
      '--modules, -m \t\t Transform module globals for dual build target. Defaults to false.',
      'info',
      bare,
    )
    log(
      '--dirs, -d \t\t Output both builds to directories inside of outDir. [esm, cjs].',
      'info',
      bare,
    )
    log(
      '--exports, -e \t Generate package.json exports. Values: wildcard | dir | name.',
      'info',
      bare,
    )
    log('--help, -h \t\t Print this message.', 'info', bare)
  } else {
    const {
      project,
      'target-extension': targetExt,
      'pkg-dir': pkgDir,
      modules,
      dirs,
      exports: exportsOpt,
    } = parsed
    let configPath = resolve(project)
    let stats = null
    let pkg = null

    if (targetExt) {
      logError(
        '--target-extension is deprecated. Define "type" in your package.json instead and the dual build will be inferred from that.',
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

    pkg = await readPackageUp({ cwd: pkgDir ?? configPath })

    if (!pkg) {
      logError('No package.json file found.')

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
      const tsconfig = parseTsconfig(configPath)
      const projectDir = dirname(configPath)

      if (!tsconfig.compilerOptions?.outDir) {
        log('No outDir defined in tsconfig.json. Build output will be in "dist".')
      }

      if (exportsOpt && !['wildcard', 'dir', 'name'].includes(exportsOpt)) {
        logError('--exports expects one of: wildcard | dir | name')

        return false
      }

      return {
        pkg,
        dirs,
        modules,
        exports: exportsOpt,
        tsconfig,
        projectDir,
        configPath,
      }
    }
  }

  return false
}

export { init }
