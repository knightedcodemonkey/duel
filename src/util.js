import { pathToFileURL } from 'node:url'
import { realpath, readFile, writeFile, symlink } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { cwd, platform } from 'node:process'
import {
  join,
  resolve,
  relative,
  parse as parsePath,
  posix,
  isAbsolute,
  sep,
  normalize as normalizePath,
} from 'node:path'

import { glob } from 'glob'
import { findUp } from 'find-up'

const COLORS = {
  reset: '\x1b[0m',
  info: '\x1b[36m',
  success: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
}
const log = (msg = '', level = 'info', opts = {}) => {
  const { bare = false } = opts
  const palette = {
    info: COLORS.info,
    success: COLORS.success,
    warn: COLORS.warn,
    error: COLORS.error,
  }
  const badge = {
    success: '[✓]',
    warn: '[!]',
    error: '[x]',
    info: '[i]',
  }[level]
  const color = palette[level] ?? COLORS.info
  const prefix = !bare && badge ? `${badge} ` : ''

  // eslint-disable-next-line no-console
  console.log(`${color}${prefix}%s${COLORS.reset}`, msg)
}
const logSuccess = msg => log(msg, 'success')
const logWarn = msg => log(msg, 'warn')
const logError = msg => log(msg, 'error')
const getRealPathAsFileUrl = async path => {
  const realPath = await realpath(path)
  const asFileUrl = pathToFileURL(realPath).href

  return asFileUrl
}
const getCompileFiles = (tscPath, options = {}) => {
  const { cwd: workingDir = cwd(), project = null } =
    typeof options === 'string' ? { cwd: options, project: null } : options
  const args = [tscPath]

  if (project) {
    args.push('-p', project)
  }

  args.push('--listFilesOnly')

  const { stdout } = spawnSync(process.execPath, args, {
    cwd: workingDir,
  })

  const root = normalizePath(resolve(workingDir))
  const normalize = candidate =>
    normalizePath(isAbsolute(candidate) ? candidate : resolve(workingDir, candidate))
  // Normalize casing only on Windows; POSIX stays case-sensitive to match fs semantics.
  const toComparable = path => (platform === 'win32' ? path.toLowerCase() : path)
  const rootComparable = toComparable(root)
  const isInsideRoot = candidate => {
    const comparable = toComparable(candidate)

    return (
      comparable === rootComparable || comparable.startsWith(`${rootComparable}${sep}`)
    )
  }
  const isNodeModules = candidate => candidate.split(sep).includes('node_modules')
  const allPaths = stdout
    .toString()
    // tsc may emit LF or CRLF depending on shell/platform; accept both.
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(normalize)
    .filter(path => !isNodeModules(path))
  const insideRoot = allPaths.filter(isInsideRoot)

  // Prefer paths within the project root. On Windows, edge cases (UNC paths, junctions, etc.)
  // can cause all paths to be filtered out. Fall back to unbounded list. See docs/faq.md.
  return insideRoot.length ? insideRoot : allPaths
}
const stripKnownExt = path => {
  return path.replace(/(\.d\.(?:ts|mts|cts)|\.(?:mjs|cjs|js))$/, '')
}
const ensureDotSlash = path => {
  return path.startsWith('./') ? path : `./${path}`
}
const readExportsConfig = async (configPath, pkgDir) => {
  const abs = isAbsolute(configPath)
    ? configPath
    : configPath.startsWith('.')
      ? resolve(pkgDir, configPath)
      : resolve(cwd(), configPath)
  const raw = await readFile(abs, 'utf8')

  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Invalid JSON in --exports-config (${configPath}): ${err.message}`)
  }

  const { entries, main } = parsed

  if (
    !entries ||
    !Array.isArray(entries) ||
    entries.some(item => typeof item !== 'string')
  ) {
    throw new Error(
      '--exports-config expects an object with an "entries" array of strings',
    )
  }

  if (main && typeof main !== 'string') {
    throw new Error('--exports-config "main" must be a string when provided')
  }

  const normalize = value => ensureDotSlash(value.replace(/\\/g, '/'))
  const normalizedEntries = [...new Set(entries.map(normalize))]
  const normalizedMain = main ? normalize(main) : null

  return { entries: normalizedEntries, main: normalizedMain }
}
const getSubpath = (mode, relFromRoot) => {
  const parsed = parsePath(relFromRoot)
  const segments = parsed.dir.split('/').filter(Boolean)

  if (mode === 'name') {
    return parsed.name ? `./${parsed.name}` : null
  }

  if (mode === 'dir') {
    const last = segments.at(-1)
    return last ? `./${last}/*` : null
  }

  if (mode === 'wildcard') {
    const first = segments[0]
    return first ? `./${first}/*` : null
  }

  return null
}
const generateExports = async options => {
  const { mode, pkg, pkgDir, esmRoot, cjsRoot, mainDefaultKind, mainPath, entries } =
    options
  const toPosix = path => path.replace(/\\/g, '/')
  const esmRootPosix = toPosix(esmRoot)
  const cjsRootPosix = toPosix(cjsRoot)
  const esmPrefix = toPosix(relative(pkgDir, esmRoot))
  const cjsPrefix = toPosix(relative(pkgDir, cjsRoot))
  const esmIgnore = ['node_modules/**']
  const cjsIgnore = ['node_modules/**']
  const baseMap = new Map()
  const subpathMap = new Map()
  const baseToSubpath = new Map()

  if (cjsRootPosix.startsWith(`${esmRootPosix}/`)) {
    esmIgnore.push(`${cjsRootPosix}/**`)
  }

  if (esmRootPosix.startsWith(`${cjsRootPosix}/`)) {
    cjsIgnore.push(`${esmRootPosix}/**`)
  }

  const toWildcardValue = value => {
    const dir = posix.dirname(value)
    const file = posix.basename(value)
    const dtsMatch = file.match(/(\.d\.(?:ts|mts|cts))$/i)

    if (dtsMatch) {
      const ext = dtsMatch[1]
      return dir === '.' ? `./*${ext}` : `${dir}/*${ext}`
    }

    const ext = posix.extname(file)
    return dir === '.' ? `./*${ext}` : `${dir}/*${ext}`
  }

  const expandEntriesBase = base => {
    const variants = [base]

    if (esmPrefix && cjsPrefix && esmPrefix !== cjsPrefix) {
      const esmPrefixWithSlash = `${esmPrefix}/`
      const cjsPrefixWithSlash = `${cjsPrefix}/`

      if (base.startsWith(esmPrefixWithSlash)) {
        variants.push(base.replace(esmPrefixWithSlash, cjsPrefixWithSlash))
      }

      if (base.startsWith(cjsPrefixWithSlash)) {
        variants.push(base.replace(cjsPrefixWithSlash, esmPrefixWithSlash))
      }
    }

    return variants
  }

  const entriesBase = entries?.length
    ? new Set(
        entries.flatMap(entry => {
          const normalized = stripKnownExt(entry.replace(/^\.\//, ''))
          return expandEntriesBase(normalized)
        }),
      )
    : null

  const recordPath = (kind, filePath, root) => {
    const relPkg = toPosix(relative(pkgDir, filePath))
    const relFromRoot = toPosix(relative(root, filePath))
    const withDot = ensureDotSlash(relPkg)
    const baseKey = stripKnownExt(relPkg)
    const useEntriesSubpaths = Boolean(entriesBase)

    if (entriesBase && !entriesBase.has(baseKey)) {
      return
    }
    const baseEntry = baseMap.get(baseKey) ?? {}

    baseEntry[kind] = withDot
    baseMap.set(baseKey, baseEntry)

    const subpath = useEntriesSubpaths
      ? ensureDotSlash(stripKnownExt(relFromRoot))
      : getSubpath(mode, relFromRoot)
    const useWildcard = subpath?.includes('*')

    if (kind === 'types') {
      const mappedSubpath = baseToSubpath.get(baseKey)

      if (mappedSubpath) {
        const subEntry = subpathMap.get(mappedSubpath) ?? {}
        subEntry.types = useWildcard ? toWildcardValue(withDot) : withDot
        subpathMap.set(mappedSubpath, subEntry)
      }

      return
    }

    if (subpath && subpath !== '.') {
      const subEntry = subpathMap.get(subpath) ?? {}
      subEntry[kind] = useWildcard ? toWildcardValue(withDot) : withDot
      subpathMap.set(subpath, subEntry)
      baseToSubpath.set(baseKey, subpath)
    }
  }

  const esmFiles = await glob(`${esmRootPosix}/**/*.{js,mjs,d.ts,d.mts}`, {
    ignore: esmIgnore,
  })

  for (const file of esmFiles) {
    if (/\.d\.(ts|mts)$/.test(file)) {
      recordPath('types', file, esmRoot)
    } else {
      recordPath('import', file, esmRoot)
    }
  }

  const cjsFiles = await glob(`${cjsRootPosix}/**/*.{js,cjs,d.ts,d.cts}`, {
    ignore: cjsIgnore,
  })

  for (const file of cjsFiles) {
    if (/\.d\.(ts|cts)$/.test(file)) {
      recordPath('types', file, cjsRoot)
    } else {
      recordPath('require', file, cjsRoot)
    }
  }

  const exportsMap = {}
  const mainBase = mainPath ? stripKnownExt(mainPath.replace(/^\.\//, '')) : null
  const mainEntry = mainBase ? (baseMap.get(mainBase) ?? {}) : {}

  if (mainPath) {
    const rootEntry = {}

    if (mainEntry.types) {
      rootEntry.types = mainEntry.types
    }

    if (mainDefaultKind === 'import') {
      rootEntry.import = mainEntry.import ?? ensureDotSlash(mainPath)
      if (mainEntry.require) {
        rootEntry.require = mainEntry.require
      }
    } else {
      rootEntry.require = mainEntry.require ?? ensureDotSlash(mainPath)
      if (mainEntry.import) {
        rootEntry.import = mainEntry.import
      }
    }

    rootEntry.default = ensureDotSlash(mainPath)

    exportsMap['.'] = rootEntry
  }

  const defaultKind = mainDefaultKind ?? 'import'

  for (const [subpath, entry] of subpathMap.entries()) {
    const out = {}

    if (entry.types) {
      out.types = entry.types
    }
    if (entry.import) {
      out.import = entry.import
    }
    if (entry.require) {
      out.require = entry.require
    }

    const def =
      defaultKind === 'import'
        ? (entry.import ?? entry.require)
        : (entry.require ?? entry.import)

    if (def) {
      out.default = def
    }

    if (Object.keys(out).length) {
      exportsMap[subpath] = out
    }
  }

  if (!exportsMap['.']) {
    const firstNonWildcard = [...subpathMap.entries()].find(([key]) => !key.includes('*'))

    if (firstNonWildcard) {
      const [subpath, entry] = firstNonWildcard
      const out = {}

      if (entry.types) {
        out.types = entry.types
      }
      if (entry.import) {
        out.import = entry.import
      }
      if (entry.require) {
        out.require = entry.require
      }

      const def =
        defaultKind === 'import'
          ? (entry.import ?? entry.require)
          : (entry.require ?? entry.import)

      if (def) {
        out.default = def
      }

      if (Object.keys(out).length) {
        exportsMap['.'] = out

        /* c8 ignore next 3 -- subpath is always set above; keep as guard */
        if (!exportsMap[subpath]) {
          exportsMap[subpath] = out
        }
      }
    }
  }

  if (Object.keys(exportsMap).length) {
    if (options.validateOnly) {
      return { exportsMap }
    }

    const pkgJson = {
      ...pkg.packageJson,
      exports: exportsMap,
    }

    await writeFile(pkg.path, `${JSON.stringify(pkgJson, null, 2)}\n`)
  }

  return { exportsMap }
}
const processDiagnosticsForFile = (diagnostics, projectDir, logDiagnosticsFn) => {
  if (!diagnostics.length) return false
  return logDiagnosticsFn(diagnostics, projectDir)
}
const exitOnDiagnostics = (hasError, exitFn = process.exit) => {
  if (hasError) {
    exitFn(1)
  }
}
const maybeLinkNodeModules = async (
  projectRoot,
  subDir,
  symlinkFn = symlink,
  findUpFn = findUp,
) => {
  const nodeModules = await findUpFn('node_modules', {
    cwd: projectRoot,
    type: 'directory',
  })

  if (nodeModules) {
    try {
      await symlinkFn(nodeModules, join(subDir, 'node_modules'), 'junction')
    } catch {
      /* If symlink fails, fall back to existing resolution. */
    }
  }
}
const runExportsValidationBlock = async options => {
  const {
    exportsOpt,
    exportsConfigData,
    exportsValidate,
    pkg,
    pkgDir,
    esmRoot,
    cjsRoot,
    mainDefaultKind,
    mainPath,
    logWarnFn = logWarn,
    logFn = log,
    generateExportsFn = generateExports,
  } = options

  if (!exportsOpt && !exportsConfigData && !exportsValidate) {
    return { exportsMap: null }
  }

  if (exportsValidate && !exportsOpt && !exportsConfigData) {
    logWarnFn('--exports-validate has no effect without --exports or --exports-config')
  }

  const result = await generateExportsFn({
    mode: exportsOpt,
    pkg,
    pkgDir,
    esmRoot,
    cjsRoot,
    mainDefaultKind,
    mainPath: exportsConfigData?.main ?? mainPath,
    entries: exportsConfigData?.entries,
    validateOnly: exportsValidate,
  })

  if (exportsValidate) {
    logFn('Exports validation successful.')
    if (!exportsOpt && !exportsConfigData) {
      logWarnFn(
        'No exports were written; use --exports or --exports-config to emit exports.',
      )
    }
  }

  return result
}

export {
  log,
  logError,
  logSuccess,
  logWarn,
  getRealPathAsFileUrl,
  getCompileFiles,
  readExportsConfig,
  getSubpath,
  generateExports,
  stripKnownExt,
  ensureDotSlash,
  processDiagnosticsForFile,
  exitOnDiagnostics,
  maybeLinkNodeModules,
  runExportsValidationBlock,
}
