import { parseArgs } from 'node:util'
import { resolve, join, dirname } from 'node:path'
import { stat } from 'node:fs/promises'

import { parseTsconfig } from 'get-tsconfig'
import { readPackageUp } from 'read-package-up'

import { logError, log, logWarn } from './util.js'

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
        'exports-config': {
          type: 'string',
        },
        'exports-validate': {
          type: 'boolean',
          default: false,
        },
        'transform-syntax': {
          type: 'boolean',
          short: 's',
          default: false,
        },
        'rewrite-policy': {
          type: 'string',
          default: 'safe',
        },
        'validate-specifiers': {
          type: 'boolean',
          default: false,
        },
        verbose: {
          type: 'boolean',
          short: 'V',
          default: false,
        },
        mode: {
          type: 'string',
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
      "--project, -p [path] \t\t Compile the project given the path to its configuration file, or to a folder with a 'tsconfig.json'.",
      'info',
      bare,
    )
    log(
      '--pkg-dir, -k [path] \t\t The directory to start looking for a package.json file. Defaults to --project directory.',
      'info',
      bare,
    )
    log(
      '--modules, -m \t\t\t Transform module globals for dual build target. Defaults to false. (deprecated; use --mode globals/full).',
      'info',
      bare,
    )
    log(
      '--dirs, -d \t\t\t Output both builds to directories inside of outDir. [esm, cjs].',
      'info',
      bare,
    )
    log(
      '--exports, -e \t\t\t Generate package.json exports. Values: wildcard | dir | name.',
      'info',
      bare,
    )
    log(
      '--exports-config [path] \t\t Provide explicit exports config file.',
      'info',
      bare,
    )
    log('--exports-validate \t\t\t Validate exports without writing.', 'info', bare)
    log(
      '--transform-syntax, -s \t\t Opt in to full syntax lowering via @knighted/module (default is globals-only). (deprecated; use --mode full).',
      'info',
      bare,
    )
    log(
      '--mode [none|globals|full] \t Optional shorthand for module transforms and syntax lowering.',
      'info',
      bare,
    )
    log(
      '--rewrite-policy [safe|warn|skip] \t Control specifier rewriting behavior.',
      'info',
      bare,
    )
    log(
      '--validate-specifiers \t\t Validate rewritten specifiers against outputs.',
      'info',
      bare,
    )
    log('--verbose, -V \t\t\t Enable verbose logging.', 'info', bare)
    log('--help, -h \t\t\t Print this message.', 'info', bare)
  } else {
    const {
      project,
      'target-extension': targetExt,
      'pkg-dir': pkgDir,
      modules,
      dirs,
      exports: exportsOpt,
      'exports-config': exportsConfig,
      'exports-validate': exportsValidate,
      'transform-syntax': transformSyntax,
      'rewrite-policy': rewritePolicy,
      'validate-specifiers': validateSpecifiers,
      verbose,
      mode,
    } = parsed

    if (modules) {
      logWarn('--modules is deprecated; prefer --mode globals or --mode full.')
    }

    if (transformSyntax) {
      logWarn('--transform-syntax is deprecated; prefer --mode full.')
    }
    let configPath = resolve(project)
    let stats = null
    let pkg = null

    if (mode && !['none', 'globals', 'full'].includes(mode)) {
      logError('--mode expects one of: none | globals | full')

      return false
    }

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

      if (!['safe', 'warn', 'skip'].includes(rewritePolicy)) {
        logError('--rewrite-policy expects one of: safe | warn | skip')

        return false
      }

      let modulesFinal = modules
      let transformSyntaxFinal = transformSyntax
      const validateSpecifiersFinal = rewritePolicy === 'safe' ? true : validateSpecifiers

      if (mode) {
        if (mode === 'none') {
          modulesFinal = false
          transformSyntaxFinal = false
        } else if (mode === 'globals') {
          modulesFinal = true
          transformSyntaxFinal = false
        } else if (mode === 'full') {
          modulesFinal = true
          transformSyntaxFinal = true
        }
      } else if (transformSyntax && !modules) {
        modulesFinal = true
      }

      return {
        pkg,
        dirs,
        modules: modulesFinal,
        transformSyntax: transformSyntaxFinal,
        exports: exportsOpt,
        exportsConfig,
        exportsValidate,
        rewritePolicy,
        validateSpecifiers: validateSpecifiersFinal,
        verbose,
        tsconfig,
        projectDir,
        configPath,
      }
    }
  }

  return false
}

export { init }
