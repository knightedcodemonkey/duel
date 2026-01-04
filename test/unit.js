import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

import {
  log,
  logWarn,
  logError,
  logSuccess,
  createTempCleanup,
  registerCleanupHandlers,
  getRealPathAsFileUrl,
  getCompileFiles,
  getSubpath,
  readExportsConfig,
  generateExports,
  stripKnownExt,
  ensureDotSlash,
  filterDualPackageDiagnostics,
  processDiagnosticsForFile,
  exitOnDiagnostics,
  maybeLinkNodeModules,
  runExportsValidationBlock,
} from '../src/util.js'
import { init } from '../src/init.js'
import { rewriteSpecifiersAndExtensions } from '../src/resolver.js'

const makeTmp = () => mkdtempSync(join(os.tmpdir(), 'duel-unit-'))

describe('duel internals', () => {
  it('computes subpaths for exports mapping', () => {
    assert.equal(getSubpath('name', 'foo/bar.js'), './bar')
    assert.equal(getSubpath('dir', 'foo/bar.js'), './foo/*')
    assert.equal(getSubpath('wildcard', 'foo/bar/baz.js'), './foo/*')
    assert.equal(getSubpath('unknown', 'foo/bar.js'), null)
  })

  it('throws on exports-config with non-string main', async () => {
    const tmp = makeTmp()
    const file = join(tmp, 'config.json')
    writeFileSync(file, JSON.stringify({ entries: ['./dist/index.js'], main: 123 }))

    await assert.rejects(async () => readExportsConfig(file, process.cwd()))

    rmSync(tmp, { recursive: true, force: true })
  })

  it('throws on exports-config with invalid json', async () => {
    const tmp = makeTmp()
    const file = join(tmp, 'config.json')
    writeFileSync(file, '{')

    await assert.rejects(async () => readExportsConfig(file, process.cwd()))

    rmSync(tmp, { recursive: true, force: true })
  })

  it('resolves exports-config from pkgDir and cwd', async () => {
    const tmp = makeTmp()
    const cfgName = 'config.json'
    writeFileSync(
      join(tmp, cfgName),
      JSON.stringify({ entries: ['dist/a.js'], main: 'dist/a.js' }),
    )

    // relative with leading dot uses pkgDir
    const relResult = await readExportsConfig('./config.json', tmp)
    assert.deepEqual(relResult.entries, ['./dist/a.js'])
    assert.equal(relResult.main, './dist/a.js')

    // relative without dot uses cwd
    const originalCwd = process.cwd()
    process.chdir(tmp)
    try {
      const cwdResult = await readExportsConfig('config.json', '/does-not-matter')
      assert.equal(cwdResult.main, './dist/a.js')
    } finally {
      process.chdir(originalCwd)
    }

    rmSync(tmp, { recursive: true, force: true })
  })

  it('throws on exports-config with invalid entries shape', async () => {
    const tmp = makeTmp()
    const file = join(tmp, 'config.json')
    writeFileSync(file, JSON.stringify({ entries: 'not-an-array' }))

    await assert.rejects(async () => readExportsConfig('./config.json', tmp))

    rmSync(tmp, { recursive: true, force: true })
  })

  it('falls back to root export when only subpaths exist', async () => {
    const tmp = makeTmp()
    const pkgDir = tmp
    const esmRoot = join(tmp, 'dist/esm')
    const cjsRoot = join(tmp, 'dist/cjs')
    const pkgPath = join(tmp, 'package.json')

    // create minimal file layout
    writeFileSync(pkgPath, JSON.stringify({ name: 'pkg' }))
    mkdirSync(esmRoot, { recursive: true })
    mkdirSync(cjsRoot, { recursive: true })
    writeFileSync(join(esmRoot, 'foo.js'), 'export {}')
    writeFileSync(join(cjsRoot, 'foo.cjs'), 'module.exports = {}')

    const { exportsMap } = await generateExports({
      mode: 'name',
      pkg: { packageJson: {}, path: pkgPath },
      pkgDir,
      esmRoot,
      cjsRoot,
      mainDefaultKind: 'import',
      mainPath: null,
      entries: null,
      dryRun: true,
    })

    assert.ok(exportsMap['.'])
    assert.ok(exportsMap['./foo'])
    assert.deepEqual(exportsMap['.'], exportsMap['./foo'])

    rmSync(tmp, { recursive: true, force: true })
  })

  it('ignores nested cjs output inside esm root', async () => {
    const tmp = makeTmp()
    const pkgPath = join(tmp, 'package.json')
    const esmRoot = join(tmp, 'dist/esm')
    const cjsRoot = join(esmRoot, 'cjs')

    writeFileSync(pkgPath, JSON.stringify({ name: 'pkg' }))
    mkdirSync(join(esmRoot, 'foo'), { recursive: true })
    mkdirSync(join(cjsRoot, 'foo'), { recursive: true })
    writeFileSync(join(esmRoot, 'foo/index.js'), 'export const esm = 1')
    writeFileSync(join(cjsRoot, 'foo/index.cjs'), 'module.exports = 1')

    const { exportsMap } = await generateExports({
      mode: 'dir',
      pkg: { packageJson: {}, path: pkgPath },
      pkgDir: tmp,
      esmRoot,
      cjsRoot,
      mainDefaultKind: 'import',
      mainPath: null,
      entries: null,
      dryRun: true,
    })

    const entry = exportsMap['./foo/*']
    assert.ok(entry.import)
    assert.ok(entry.require)

    rmSync(tmp, { recursive: true, force: true })
  })

  it('ignores nested esm output inside cjs root', async () => {
    const tmp = makeTmp()
    const pkgPath = join(tmp, 'package.json')
    const cjsRoot = join(tmp, 'dist/cjs')
    const esmRoot = join(cjsRoot, 'esm')

    writeFileSync(pkgPath, JSON.stringify({ name: 'pkg' }))
    mkdirSync(join(esmRoot, 'bar'), { recursive: true })
    mkdirSync(join(cjsRoot, 'bar'), { recursive: true })
    writeFileSync(join(esmRoot, 'bar/index.js'), 'export const esm = 1')
    writeFileSync(join(cjsRoot, 'bar/index.cjs'), 'module.exports = 1')

    const { exportsMap } = await generateExports({
      mode: 'dir',
      pkg: { packageJson: {}, path: pkgPath },
      pkgDir: tmp,
      esmRoot,
      cjsRoot,
      mainDefaultKind: 'import',
      mainPath: null,
      entries: null,
      dryRun: true,
    })

    const entry = exportsMap['./bar/*']
    assert.ok(entry.import)
    assert.ok(entry.require)

    rmSync(tmp, { recursive: true, force: true })
  })

  it('expands entries across esm and cjs prefixes', async () => {
    const tmp = makeTmp()
    const pkgPath = join(tmp, 'package.json')
    const esmRoot = join(tmp, 'dist/esm')
    const cjsRoot = join(tmp, 'dist/cjs')

    writeFileSync(pkgPath, JSON.stringify({ name: 'pkg' }))
    mkdirSync(join(esmRoot, 'baz'), { recursive: true })
    mkdirSync(join(cjsRoot, 'baz'), { recursive: true })
    writeFileSync(join(esmRoot, 'baz/index.js'), 'export const esm = 1')
    writeFileSync(join(cjsRoot, 'baz/index.js'), 'module.exports = 1')

    const { exportsMap } = await generateExports({
      mode: 'dir',
      pkg: { packageJson: {}, path: pkgPath },
      pkgDir: tmp,
      esmRoot,
      cjsRoot,
      mainDefaultKind: 'import',
      mainPath: null,
      entries: ['./dist/cjs/baz/index.js'],
      dryRun: true,
    })

    const entry = exportsMap['./baz/index']
    assert.equal(entry.import, './dist/esm/baz/index.js')
    assert.equal(entry.require, './dist/cjs/baz/index.js')

    rmSync(tmp, { recursive: true, force: true })
  })

  it('includes require when main default is import but cjs exists', async () => {
    const tmp = makeTmp()
    const pkgPath = join(tmp, 'package.json')
    const esmRoot = join(tmp, 'dist')
    const cjsRoot = esmRoot

    writeFileSync(pkgPath, JSON.stringify({ name: 'pkg' }))
    mkdirSync(esmRoot, { recursive: true })
    writeFileSync(join(esmRoot, 'index.js'), 'export const esm = 1')
    writeFileSync(join(cjsRoot, 'index.cjs'), 'module.exports = 1')

    const { exportsMap } = await generateExports({
      mode: 'name',
      pkg: { packageJson: {}, path: pkgPath },
      pkgDir: tmp,
      esmRoot,
      cjsRoot,
      mainDefaultKind: 'import',
      mainPath: './dist/index.js',
      entries: null,
      dryRun: true,
    })

    assert.equal(exportsMap['.'].import, './dist/index.js')
    assert.equal(exportsMap['.'].require, './dist/index.cjs')

    rmSync(tmp, { recursive: true, force: true })
  })

  it('preserves import when main default is require', async () => {
    const tmp = makeTmp()
    const pkgPath = join(tmp, 'package.json')
    const root = join(tmp, 'dist')

    writeFileSync(pkgPath, JSON.stringify({ name: 'pkg' }))
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'index.js'), 'export const esm = 1')

    const { exportsMap } = await generateExports({
      mode: 'name',
      pkg: { packageJson: {}, path: pkgPath },
      pkgDir: tmp,
      esmRoot: root,
      cjsRoot: root,
      mainDefaultKind: 'require',
      mainPath: './dist/index.js',
      entries: null,
      dryRun: true,
    })

    assert.equal(exportsMap['.'].require, './dist/index.js')
    assert.equal(exportsMap['.'].import, './dist/index.js')
    assert.equal(exportsMap['.'].default, './dist/index.js')

    rmSync(tmp, { recursive: true, force: true })
  })

  it('logs with badges and bare option', () => {
    const calls = []
    const orig = console.log
    console.log = (...args) => calls.push(args)

    log('info message')
    logWarn('warn message')
    logError('error message')
    logSuccess('success message')
    log('bare message', 'info', { bare: true })

    console.log = orig
    assert.ok(calls.length >= 5)
  })

  it('reads exports config and normalizes paths', async () => {
    const tmp = makeTmp()
    const cfgPath = join(tmp, 'config.json')
    writeFileSync(
      cfgPath,
      JSON.stringify({
        entries: ['dist/one.js', '.\\dist/two.js'],
        main: 'dist/main.js',
      }),
    )

    const result = await readExportsConfig(cfgPath, tmp)
    assert.deepEqual(result.entries.sort(), ['./dist/one.js', './dist/two.js'])
    assert.equal(result.main, './dist/main.js')

    rmSync(tmp, { recursive: true, force: true })
  })

  it('converts real path to file URL', async () => {
    const tmp = makeTmp()
    const file = join(tmp, 'file.txt')
    writeFileSync(file, 'data')

    const url = await getRealPathAsFileUrl(file)
    assert.ok(url.startsWith('file://'))

    rmSync(tmp, { recursive: true, force: true })
  })

  it('wildcards types and js entries when subpath uses dir mode', async () => {
    const tmp = makeTmp()
    const pkgPath = join(tmp, 'package.json')
    const esmRoot = join(tmp, 'dist/esm')
    const cjsRoot = join(tmp, 'dist/cjs')

    writeFileSync(pkgPath, JSON.stringify({ name: 'pkg' }))
    mkdirSync(join(esmRoot, 'foo'), { recursive: true })
    mkdirSync(join(cjsRoot, 'foo'), { recursive: true })
    writeFileSync(join(esmRoot, 'foo/index.js'), 'export const esm = 1')
    writeFileSync(join(esmRoot, 'foo/index.d.ts'), 'export declare const esm: number')
    writeFileSync(join(cjsRoot, 'foo/index.cjs'), 'module.exports = 1')

    const { exportsMap } = await generateExports({
      mode: 'dir',
      pkg: { packageJson: {}, path: pkgPath },
      pkgDir: tmp,
      esmRoot,
      cjsRoot,
      mainDefaultKind: 'import',
      mainPath: null,
      entries: null,
      dryRun: true,
    })

    const entry = exportsMap['./foo/*']
    assert.ok(entry.import.includes('*.js'))
    assert.ok(entry.require.includes('*.cjs'))
    assert.ok(entry.types.includes('*.d.ts'))

    rmSync(tmp, { recursive: true, force: true })
  })

  it('expands entries across esm/cjs prefixes when entries are provided', async () => {
    const tmp = makeTmp()
    const pkgPath = join(tmp, 'package.json')
    const esmRoot = join(tmp, 'dist/esm')
    const cjsRoot = join(tmp, 'dist/cjs')

    writeFileSync(pkgPath, JSON.stringify({ name: 'pkg' }))
    mkdirSync(join(esmRoot, 'foo'), { recursive: true })
    mkdirSync(join(cjsRoot, 'foo'), { recursive: true })
    writeFileSync(join(esmRoot, 'foo/index.js'), 'export const esm = 1')
    writeFileSync(join(cjsRoot, 'foo/index.js'), 'module.exports = 1')

    const { exportsMap } = await generateExports({
      mode: 'dir',
      pkg: { packageJson: {}, path: pkgPath },
      pkgDir: tmp,
      esmRoot,
      cjsRoot,
      mainDefaultKind: 'import',
      mainPath: null,
      entries: ['./dist/esm/foo/index.js'],
      dryRun: true,
    })

    const entry = exportsMap['./foo/index']
    assert.equal(entry.import, './dist/esm/foo/index.js')
    assert.equal(entry.require, './dist/cjs/foo/index.js')

    rmSync(tmp, { recursive: true, force: true })
  })

  it('skips entries not listed in exports-config entries', async () => {
    const tmp = makeTmp()
    const pkgPath = join(tmp, 'package.json')
    const esmRoot = join(tmp, 'dist/esm')
    const cjsRoot = join(tmp, 'dist/cjs')

    writeFileSync(pkgPath, JSON.stringify({ name: 'pkg' }))
    mkdirSync(join(esmRoot, 'foo'), { recursive: true })
    writeFileSync(join(esmRoot, 'foo/index.js'), 'export const esm = 1')

    const { exportsMap } = await generateExports({
      mode: 'dir',
      pkg: { packageJson: {}, path: pkgPath },
      pkgDir: tmp,
      esmRoot,
      cjsRoot,
      mainDefaultKind: 'import',
      mainPath: null,
      entries: ['./dist/cjs/only.js'],
      dryRun: true,
    })

    assert.deepEqual(exportsMap, {})

    rmSync(tmp, { recursive: true, force: true })
  })

  it('falls back to first non-wildcard entry for default export', async () => {
    const tmp = makeTmp()
    const pkgPath = join(tmp, 'package.json')
    const esmRoot = join(tmp, 'dist/esm')
    const cjsRoot = join(tmp, 'dist/cjs')

    writeFileSync(pkgPath, JSON.stringify({ name: 'pkg' }))
    mkdirSync(join(esmRoot, 'foo'), { recursive: true })
    writeFileSync(join(esmRoot, 'foo/index.js'), 'export const esm = 1')

    const { exportsMap } = await generateExports({
      mode: 'name',
      pkg: { packageJson: {}, path: pkgPath },
      pkgDir: tmp,
      esmRoot,
      cjsRoot,
      mainDefaultKind: 'import',
      mainPath: null,
      entries: null,
      dryRun: true,
    })

    assert.ok(exportsMap['.'])
    assert.equal(exportsMap['.'].default, './dist/esm/foo/index.js')

    rmSync(tmp, { recursive: true, force: true })
  })

  it('includes types when falling back to first entry', async () => {
    const tmp = makeTmp()
    const pkgPath = join(tmp, 'package.json')
    const esmRoot = join(tmp, 'dist/esm')
    const cjsRoot = join(tmp, 'dist/cjs')

    writeFileSync(pkgPath, JSON.stringify({ name: 'pkg' }))
    mkdirSync(join(esmRoot, 'foo'), { recursive: true })
    writeFileSync(join(esmRoot, 'foo/index.js'), 'export const esm = 1')
    writeFileSync(join(esmRoot, 'foo/index.d.ts'), 'export declare const esm: number')

    const { exportsMap } = await generateExports({
      mode: 'name',
      pkg: { packageJson: {}, path: pkgPath },
      pkgDir: tmp,
      esmRoot,
      cjsRoot,
      mainDefaultKind: 'import',
      mainPath: null,
      entries: null,
      dryRun: true,
    })

    assert.equal(exportsMap['.'].types, './dist/esm/foo/index.d.ts')

    rmSync(tmp, { recursive: true, force: true })
  })

  it('writes exports to package.json when not validating only', async () => {
    const tmp = makeTmp()
    const pkgPath = join(tmp, 'package.json')
    const root = join(tmp, 'dist')

    writeFileSync(pkgPath, JSON.stringify({ name: 'pkg' }))
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'index.js'), 'export const esm = 1')
    writeFileSync(join(root, 'index.cjs'), 'module.exports = 1')
    writeFileSync(join(root, 'index.d.ts'), 'export declare const esm: number')

    await generateExports({
      mode: 'name',
      pkg: { packageJson: {}, path: pkgPath },
      pkgDir: tmp,
      esmRoot: root,
      cjsRoot: root,
      mainDefaultKind: 'import',
      mainPath: './dist/index.js',
      entries: null,
      dryRun: false,
    })

    const updated = JSON.parse(readFileSync(pkgPath, 'utf8'))
    assert.ok(updated.exports)
    assert.ok(updated.exports['.'].types)

    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns exports map when validation and emit options are provided', async () => {
    const called = []
    const result = await runExportsValidationBlock({
      exportsOpt: 'name',
      exportsConfigData: { entries: ['./dist/index.js'], main: './dist/index.js' },
      exportsValidate: true,
      pkg: { packageJson: {}, path: '/tmp/pkg.json' },
      pkgDir: '/tmp',
      esmRoot: '/tmp/esm',
      cjsRoot: '/tmp/cjs',
      mainDefaultKind: 'import',
      mainPath: './dist/index.js',
      logWarnFn: () => called.push('warn'),
      logFn: () => called.push('log'),
      generateExportsFn: async () => ({
        exportsMap: { '.': { import: './dist/index.js' } },
      }),
    })

    assert.deepEqual(result.exportsMap['.'].import, './dist/index.js')
    assert.ok(called.includes('log'))
  })

  it('lists compile files (command may be empty)', () => {
    const files = getCompileFiles(process.execPath)
    assert.ok(Array.isArray(files))
  })

  it('returns early when no exports or validation options provided', async () => {
    const result = await runExportsValidationBlock({
      exportsOpt: null,
      exportsConfigData: null,
      exportsValidate: false,
      pkg: { packageJson: {}, path: '/tmp/pkg.json' },
      pkgDir: '/tmp',
      esmRoot: '/tmp/esm',
      cjsRoot: '/tmp/cjs',
      mainDefaultKind: 'import',
      mainPath: './dist/index.js',
      logWarnFn: () => {},
      logFn: () => {},
      generateExportsFn: async () => ({ exportsMap: {} }),
    })

    assert.deepEqual(result, { exportsMap: null })
  })

  it('normalizes dot slash and strips extensions helpers', () => {
    assert.equal(ensureDotSlash('dist/index.js'), './dist/index.js')
    assert.equal(ensureDotSlash('./dist/index.js'), './dist/index.js')
    assert.equal(stripKnownExt('dist/index.js'), 'dist/index')
    assert.equal(stripKnownExt('dist/index.d.mts'), 'dist/index')
  })

  it('handles symlink failures gracefully when linking node_modules', async () => {
    let attempts = 0
    const symlinkStub = async () => {
      attempts += 1
      throw new Error('fail')
    }
    const findUpStub = async () => '/tmp/fake-node_modules'

    await maybeLinkNodeModules('/tmp/project', '/tmp/sub', symlinkStub, findUpStub)

    assert.equal(attempts, 1)
  })

  it('propagates transform diagnostics and exits on error', () => {
    const diagnostics = [{ code: 'X', message: 'bad', level: 'error' }]
    let exitCode = null

    const errored = processDiagnosticsForFile(diagnostics, process.cwd(), () => true)
    assert.equal(errored, true)

    assert.throws(() =>
      exitOnDiagnostics(true, code => {
        exitCode = code
        throw new Error('exit')
      }),
    )
    assert.equal(exitCode, 1)
  })

  it('warns when validating exports without emit config', async () => {
    const warnings = []
    const infos = []

    await runExportsValidationBlock({
      exportsOpt: null,
      exportsConfigData: null,
      exportsValidate: true,
      pkg: { packageJson: {}, path: '/tmp/pkg.json' },
      pkgDir: '/tmp',
      esmRoot: '/tmp/esm',
      cjsRoot: '/tmp/cjs',
      mainDefaultKind: 'import',
      mainPath: './dist/index.js',
      logWarnFn: msg => warnings.push(msg),
      logFn: msg => infos.push(msg),
      generateExportsFn: async () => ({}),
    })

    assert.ok(warnings.some(msg => msg.includes('--exports-validate has no effect')))
    assert.ok(warnings.some(msg => msg.includes('No exports were written')))
    assert.ok(infos.some(msg => msg.includes('Exports validation successful.')))
  })

  describe('cleanup helpers', () => {
    it('cleans temp workspace and honors keep flag', async () => {
      const tmp = makeTmp()
      const subDir = join(tmp, 'shadow')
      const dualConfigPath = join(subDir, 'tsconfig.dual.json')
      mkdirSync(subDir, { recursive: true })
      writeFileSync(dualConfigPath, '{}')

      const { cleanupTemp, cleanupTempSync } = createTempCleanup({
        subDir,
        keepTemp: false,
        logWarnFn: () => {},
      })

      await cleanupTemp()
      assert.equal(existsSync(subDir), false)

      // idempotent
      cleanupTempSync()

      const keepDir = join(tmp, 'keep')
      const keepConfig = join(keepDir, 'tsconfig.dual.json')
      mkdirSync(keepDir, { recursive: true })
      writeFileSync(keepConfig, '{}')

      const { cleanupTemp: keepCleanup } = createTempCleanup({
        subDir: keepDir,
        keepTemp: true,
        logWarnFn: () => {},
      })

      await keepCleanup()
      assert.equal(existsSync(keepDir), true)

      rmSync(tmp, { recursive: true, force: true })
    })

    it('registers and unregisters process handlers', () => {
      const originalOnce = process.once
      const originalRemove = process.removeListener
      const originalExit = process.exit
      const events = {}
      const removed = []
      const exitCodes = []

      try {
        process.once = (event, handler) => {
          events[event] = handler
        }
        process.removeListener = (event, handler) => {
          removed.push([event, handler])
        }
        process.exit = code => {
          exitCodes.push(code)
        }

        let syncCalls = 0
        const cleanupTempSync = () => {
          syncCalls += 1
        }

        const unregister = registerCleanupHandlers(cleanupTempSync)

        events.exit?.()
        events.SIGINT?.()
        events.SIGTERM?.()
        assert.equal(syncCalls, 3)
        assert.deepEqual(exitCodes, [1, 1])

        assert.throws(() => events.uncaughtException?.(new Error('boom')))
        assert.throws(() => events.unhandledRejection?.('fail'))
        assert.equal(syncCalls, 5)

        unregister()

        const removedEvents = removed.map(([event]) => event)
        assert.ok(removedEvents.includes('exit'))
        assert.ok(removedEvents.includes('SIGINT'))
        assert.ok(removedEvents.includes('SIGTERM'))
        assert.ok(removedEvents.includes('uncaughtException'))
        assert.ok(removedEvents.includes('unhandledRejection'))
      } finally {
        process.once = originalOnce
        process.removeListener = originalRemove
        process.exit = originalExit
      }
    })

    it('rewrites js maps when present and keeps sourceMappingURL in sync', async () => {
      const tmp = makeTmp()
      const file = join(tmp, 'a.js')
      const dep = join(tmp, 'dep.js')
      const mapFile = `${file}.map`
      const source = 'import "./dep.js"\n//# sourceMappingURL=a.js.map\n'
      writeFileSync(file, source)
      writeFileSync(dep, 'export const y = 1;')
      writeFileSync(
        mapFile,
        JSON.stringify({
          version: 3,
          file: 'a.js',
          sources: ['a.ts'],
          sourcesContent: ['export const x = 1;'],
          names: [],
          mappings: 'AAAA',
        }),
      )

      await rewriteSpecifiersAndExtensions([file], {
        target: 'module',
        ext: '.mjs',
        syntaxMode: false,
      })

      const outFile = join(tmp, 'a.mjs')
      const outMap = `${outFile}.map`
      assert.ok(existsSync(outFile))
      assert.ok(existsSync(outMap))

      const rewritten = readFileSync(outFile, 'utf8')
      assert.ok(rewritten.includes('./dep.mjs'))
      assert.ok(rewritten.includes('a.mjs.map'))

      const map = JSON.parse(readFileSync(outMap, 'utf8'))
      assert.equal(map.file, 'a.mjs')
      assert.deepEqual(map.sources, ['a.ts'])

      rmSync(tmp, { recursive: true, force: true })
    })

    it('does not create maps when none exist', async () => {
      const tmp = makeTmp()
      const file = join(tmp, 'b.js')
      writeFileSync(file, 'import "./dep.js"\n')

      await rewriteSpecifiersAndExtensions([file], {
        target: 'module',
        ext: '.mjs',
        syntaxMode: false,
      })

      const outFile = join(tmp, 'b.mjs')
      const outMap = `${outFile}.map`
      assert.ok(existsSync(outFile))
      assert.equal(existsSync(outMap), false)

      rmSync(tmp, { recursive: true, force: true })
    })

    it('rewrites declaration maps alongside .d.ts outputs', async () => {
      const tmp = makeTmp()
      const file = join(tmp, 'types.d.ts')
      const mapFile = `${file}.map`
      const source =
        'export declare const x: typeof import("./dep.js")\n//# sourceMappingURL=types.d.ts.map\n'
      writeFileSync(file, source)
      writeFileSync(
        mapFile,
        JSON.stringify({
          version: 3,
          file: 'types.d.ts',
          sources: ['types.ts'],
          sourcesContent: ['export declare const x: number'],
          names: [],
          mappings: 'AAAA',
        }),
      )

      await rewriteSpecifiersAndExtensions([file], {
        target: 'module',
        ext: '.mjs',
        syntaxMode: false,
      })

      const outFile = join(tmp, 'types.d.mts')
      const outMap = `${outFile}.map`
      assert.ok(existsSync(outFile))
      assert.ok(existsSync(outMap))

      const rewritten = readFileSync(outFile, 'utf8')
      assert.ok(rewritten.includes('./dep.mjs'))
      assert.ok(rewritten.includes('types.d.mts.map'))

      const map = JSON.parse(readFileSync(outMap, 'utf8'))
      assert.equal(map.file, 'types.d.mts')

      rmSync(tmp, { recursive: true, force: true })
    })
  })

  it('filters dual-package diagnostics via allowlist', () => {
    const allowlist = new Set(['react'])
    const diagnostics = [
      {
        level: 'warning',
        code: 'dual-package-subpath',
        message:
          "Package 'react' is referenced via root specifier 'react' and subpath(s) react/jsx-runtime; mixing them loads separate module instances.",
      },
      {
        level: 'warning',
        code: 'dual-package-subpath',
        message:
          "Package 'vue' is referenced via root specifier 'vue' and subpath(s) vue/jsx-runtime; mixing them loads separate module instances.",
      },
      {
        level: 'warning',
        code: 'idiomatic-exports-fallback',
        message: 'Unrelated diagnostic stays.',
      },
    ]

    const filtered = filterDualPackageDiagnostics(diagnostics, allowlist)

    assert.equal(filtered.length, 2)
    assert.ok(filtered.some(diag => diag.message.includes("Package 'vue'")))
    assert.ok(filtered.some(diag => diag.code === 'idiomatic-exports-fallback'))
  })

  it('returns original diagnostics when allowlist is empty', () => {
    const diagnostics = [{ code: 'dual-package-subpath', message: "Package 'react'" }]
    const filtered = filterDualPackageDiagnostics(diagnostics, new Set())

    assert.strictEqual(filtered, diagnostics)
  })

  it('accepts array allowlists', () => {
    const diagnostics = [
      {
        level: 'warning',
        code: 'dual-package-subpath',
        message:
          "Package 'react' is referenced via root specifier 'react' and subpath(s) react/jsx-runtime; mixing them loads separate module instances.",
      },
      {
        level: 'warning',
        code: 'dual-package-subpath',
        message:
          "Package 'vue' is referenced via root specifier 'vue' and subpath(s) vue/jsx-runtime; mixing them loads separate module instances.",
      },
    ]

    const filtered = filterDualPackageDiagnostics(diagnostics, ['react'])

    assert.equal(filtered.length, 1)
    assert.ok(filtered.every(diag => diag.message.includes("Package 'vue'")))
  })

  it('keeps diagnostics when package name cannot be extracted', () => {
    const allowlist = new Set(['react'])
    const diagnostics = [
      {
        level: 'warning',
        code: 'dual-package-subpath',
        message: 'A dual-package hazard occurred somewhere.',
      },
    ]

    const filtered = filterDualPackageDiagnostics(diagnostics, allowlist)

    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].message, diagnostics[0].message)
  })

  it('handles diagnostics with missing messages gracefully', () => {
    const allowlist = new Set(['react'])
    const diagnostics = [
      {
        level: 'warning',
        code: 'dual-package-subpath',
        message: null,
      },
      {
        level: 'warning',
        code: 'dual-package-subpath',
        message: undefined,
      },
    ]

    const filtered = filterDualPackageDiagnostics(diagnostics, allowlist)

    assert.equal(filtered.length, 2)
  })

  it('returns empty array for null or undefined diagnostics input', () => {
    assert.deepEqual(filterDualPackageDiagnostics(null), [])
    assert.deepEqual(filterDualPackageDiagnostics(undefined), [])
  })

  it('rejects disabling validation when rewrite-policy is safe', async () => {
    const tmp = makeTmp()
    const tsconfigPath = join(tmp, 'tsconfig.json')
    writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { outDir: 'dist' } }))

    try {
      const result = await init([
        '--project',
        tsconfigPath,
        '--rewrite-policy',
        'safe',
        '--no-validate-specifiers',
      ])

      assert.equal(result, false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('prints help and returns false when --help is passed', async () => {
    const result = await init(['--help'])

    assert.equal(result, false)
  })

  it('errors on invalid rewrite-policy value', async () => {
    const result = await init(['--rewrite-policy', 'invalid'])

    assert.equal(result, false)
  })

  it('errors on invalid hazard detection value', async () => {
    const result = await init(['--detect-dual-package-hazard', 'nope'])

    assert.equal(result, false)
  })

  it('errors on invalid copy-mode value', async () => {
    const result = await init(['--copy-mode', 'weird'])

    assert.equal(result, false)
  })

  it('errors on invalid mode value', async () => {
    const result = await init(['--mode', 'super'])

    assert.equal(result, false)
  })

  it('errors on empty hazard allowlist string', async () => {
    const result = await init([
      '--project',
      'tsconfig.json',
      '--dual-package-hazard-allowlist',
      ' , , ',
    ])

    assert.equal(result, false)
  })

  it('errors when project directory lacks tsconfig', async () => {
    const tmp = makeTmp()

    try {
      const result = await init(['--project', tmp])
      assert.equal(result, false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('errors when project file is missing', async () => {
    const missing = join(makeTmp(), 'missing', 'tsconfig.json')

    const result = await init(['--project', missing])

    assert.equal(result, false)
  })

  it('errors when no package.json can be found', async () => {
    const tmp = makeTmp()
    const tsconfigPath = join(tmp, 'tsconfig.json')
    writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { outDir: 'dist' } }))

    try {
      const result = await init(['--project', tsconfigPath])
      assert.equal(result, false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
