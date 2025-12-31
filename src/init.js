import { parseArgs } from 'node:util'
import { resolve, join, dirname } from 'node:path'
import { stat } from 'node:fs/promises'

import { parseTsconfig } from 'get-tsconfig'
import { readPackageUp } from 'read-package-up'

import { logError, log, logWarn } from './util.js'

const cliOptions = [
  {
    long: 'project',
    short: 'p',
    value: '[path]',
    desc: "Compile the project given the path to its configuration file, or to a folder with a 'tsconfig.json'.",
  },
  {
    long: 'pkg-dir',
    short: 'k',
    value: '[path]',
    desc: 'Directory to start looking for package.json; defaults to --project.',
  },
  {
    long: 'modules',
    short: 'm',
    desc: 'Transform module globals for dual build target. (deprecated; use --mode globals/full).',
  },
  {
    long: 'dirs',
    short: 'd',
    desc: 'Output both builds to directories inside of outDir. [esm, cjs].',
  },
  {
    long: 'exports',
    short: 'e',
    value: '[mode]',
    desc: 'Generate package.json exports. Values: wildcard | dir | name.',
  },
  {
    long: 'exports-config',
    value: '[path]',
    desc: 'Provide explicit exports config file.',
  },
  {
    long: 'exports-validate',
    desc: 'Validate exports without writing.',
  },
  {
    long: 'transform-syntax',
    short: 's',
    desc: 'Opt in to full syntax lowering via @knighted/module. (deprecated; use --mode full).',
  },
  {
    long: 'mode',
    value: '[none|globals|full]',
    desc: 'Optional shorthand for module transforms and syntax lowering.',
  },
  {
    long: 'rewrite-policy',
    value: '[safe|warn|skip]',
    desc: 'Control specifier rewriting behavior.',
  },
  {
    long: 'validate-specifiers',
    desc: 'Validate rewritten specifiers against outputs.',
  },
  {
    long: 'detect-dual-package-hazard',
    short: 'H',
    value: '[off|warn|error]',
    desc: 'Detect mixed import/require use of dual packages.',
  },
  {
    long: 'dual-package-hazard-scope',
    value: '[file|project]',
    desc: 'Scope for dual package hazard detection.',
  },
  {
    long: 'verbose',
    short: 'V',
    desc: 'Enable verbose logging.',
  },
  {
    long: 'help',
    short: 'h',
    desc: 'Print this message.',
  },
]

const printHelp = () => {
  const bare = { bare: true }
  const flags = cliOptions.map(opt => {
    const value = opt.value ? ` ${opt.value}` : ''
    const short = opt.short ? `-${opt.short}, ` : '    '
    const long = `--${opt.long}${value}`

    return { flag: `${short}${long}`, desc: opt.desc }
  })
  const maxFlag = Math.max(...flags.map(f => f.flag.length))

  log('Usage: duel [options]\n', 'info', bare)
  log('Options:', 'info', bare)

  for (const { flag, desc } of flags) {
    const pad = ' '.repeat(Math.max(2, maxFlag - flag.length + 2))
    log(`${flag}${pad}${desc}`, 'info', bare)
  }
}

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
        'detect-dual-package-hazard': {
          type: 'string',
          short: 'H',
          default: 'warn',
        },
        'dual-package-hazard-scope': {
          type: 'string',
          default: 'file',
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
    printHelp()
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
      'detect-dual-package-hazard': detectDualPackageHazard,
      'dual-package-hazard-scope': dualPackageHazardScope,
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

      if (!['off', 'warn', 'error'].includes(detectDualPackageHazard)) {
        logError('--detect-dual-package-hazard expects one of: off | warn | error')

        return false
      }

      if (!['file', 'project'].includes(dualPackageHazardScope)) {
        logError('--dual-package-hazard-scope expects one of: file | project')

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
        detectDualPackageHazard,
        dualPackageHazardScope,
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
