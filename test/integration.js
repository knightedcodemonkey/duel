import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { rm, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync, execSync } from 'node:child_process'
import { platform } from 'node:process'

import { duel } from '../src/duel.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const plain = resolve(__dirname, '__fixtures__/plain')
const project = resolve(__dirname, '__fixtures__/project')
const esmProject = resolve(__dirname, '__fixtures__/esmProject')
const cjsProject = resolve(__dirname, '__fixtures__/cjsProject')
const extended = resolve(__dirname, '__fixtures__/extended')
const dualError = resolve(__dirname, '__fixtures__/compileErrorsDual')
const plainDist = join(plain, 'dist')
const proDist = join(project, 'dist')
const esmDist = join(esmProject, 'dist')
const cjsDist = join(cjsProject, 'dist')
const extDist = join(extended, 'dist')
const exportsRes = resolve(__dirname, '__fixtures__/exportsResolution')
const exportsResDist = join(exportsRes, 'dist')
const errDistDual = join(dualError, 'dist')
const errDist = resolve(__dirname, '__fixtures__/compileErrors/dist')
const rmDist = async distPath => {
  await rm(distPath, { recursive: true, force: true })
}
const shell = platform === 'win32'
// eslint-disable-next-line no-control-regex
const ansiRegex = /\u001b\[[0-9;]*m/g
const stripBadge = str => str.replace(/^\[[^\]]+\]\s*/, '')
const stripAnsi = str => (typeof str === 'string' ? str.replace(ansiRegex, '') : '')
const logged = (spy, index) => {
  const call = spy.mock.calls[index] ?? { arguments: [] }
  const strings = call.arguments.filter(arg => typeof arg === 'string')

  return stripBadge(stripAnsi(strings.at(-1) ?? ''))
}

describe('duel', () => {
  before(async () => {
    await rmDist(proDist)
    await rmDist(esmDist)
    await rmDist(cjsDist)
    await rmDist(errDist)
    await rmDist(plainDist)
    await rmDist(extDist)
  })

  it('prints options help', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['--help'])
    assert.ok(logged(spy, 1).startsWith('Options:'))
  })

  it('reports errors when passing invalid options', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['--invalid'])
    assert.equal(logged(spy, 0), "Unknown option '--invalid'")
  })

  it('uses default --project value of "tsconfig.json"', async t => {
    const spy = t.mock.method(global.console, 'log')
    const tsConfigPath = resolve('./tsconfig.json')
    const tsConfigPathTemp = tsConfigPath.replace('tsconfig', 'tsconfig.temp')

    await rename(tsConfigPath, tsConfigPathTemp)
    await duel()
    assert.ok(logged(spy, 0).endsWith('is not a file or directory.'))
    await rename(tsConfigPathTemp, tsConfigPath)
  })

  it('reports errors when --project is a directory with no tsconfig.json', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['-p', 'test/__fixtures__'])
    assert.ok(logged(spy, 0).endsWith('no tsconfig.json.'))
  })

  it('reports errors when using deprecated --target-extension', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['-x', '.mjs'])
    assert.ok(logged(spy, 0).startsWith('--target-extension is deprecated'))
  })

  it('warns when legacy module flags are used', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['-m', '-p', 'test/__fixtures__'])
    assert.ok(logged(spy, 0).startsWith('--modules is deprecated'))

    await duel(['-s', '-p', 'test/__fixtures__'])
    assert.ok(logged(spy, 2).startsWith('--transform-syntax is deprecated'))
  })

  it('creates a dual CJS build while transforming module globals', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(esmDist)
    })
    await duel(['--project', 'test/__fixtures__/esmProject', '--mode', 'globals'])

    // Third call because of logging for starting each build.
    assert.ok(logged(spy, 2).startsWith('Successfully created a dual CJS build'))
    // Check that the expected files and extensions are there
    assert.ok(existsSync(resolve(esmDist, 'index.js')))
    assert.ok(existsSync(resolve(esmDist, 'index.d.ts')))
    assert.ok(existsSync(resolve(esmDist, 'folder/module.js')))
    assert.ok(existsSync(resolve(esmDist, 'folder/module.d.ts')))
    assert.ok(existsSync(resolve(esmDist, 'cjs.cjs')))
    assert.ok(existsSync(resolve(esmDist, 'cjs/index.cjs')))
    assert.ok(existsSync(resolve(esmDist, 'cjs/index.d.cts')))
    assert.ok(existsSync(resolve(esmDist, 'cjs/esm.mjs')))
    assert.ok(existsSync(resolve(esmDist, 'cjs/folder/module.cjs')))
    assert.ok(existsSync(resolve(esmDist, 'cjs/folder/module.d.cts')))

    // Check that there are no `exports.esm` statements in the .mjs file
    const mjs = (await readFile(resolve(esmDist, 'cjs/esm.mjs'))).toString()
    const anotherMjs = (
      await readFile(resolve(esmDist, 'cjs/folder/another.mjs'))
    ).toString()

    assert.ok(mjs.indexOf('exports.esm') === -1)
    assert.ok(anotherMjs.indexOf('exports') === -1)

    // Check for runtime errors against Node.js
    const { status: statusEsm } = spawnSync(
      'node',
      ['test/__fixtures__/esmProject/dist/index.js'],
      { shell, stdio: 'inherit' },
    )
    assert.equal(statusEsm, 0)
    const { status: statusCjs } = spawnSync(
      'node',
      ['test/__fixtures__/esmProject/dist/cjs/index.cjs'],
      { shell, stdio: 'inherit' },
    )
    assert.equal(statusCjs, 0)
  })

  it('creates a dual ESM build while transforming module globals', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(cjsDist)
    })
    await duel(['-p', 'test/__fixtures__/cjsProject/tsconfig.json', '--mode', 'globals'])

    assert.ok(logged(spy, 2).startsWith('Successfully created a dual ESM build'))
    assert.ok(existsSync(resolve(cjsDist, 'index.js')))
    assert.ok(existsSync(resolve(cjsDist, 'index.d.ts')))
    assert.ok(existsSync(resolve(cjsDist, 'esm.mjs')))
    assert.ok(existsSync(resolve(cjsDist, 'folder/module.js')))
    assert.ok(existsSync(resolve(cjsDist, 'folder/module.d.ts')))
    assert.ok(existsSync(resolve(cjsDist, 'esm/index.mjs')))
    assert.ok(existsSync(resolve(cjsDist, 'esm/index.d.mts')))
    assert.ok(existsSync(resolve(cjsDist, 'esm/cjs.cjs')))
    assert.ok(existsSync(resolve(cjsDist, 'esm/folder/module.mjs')))
    assert.ok(existsSync(resolve(cjsDist, 'esm/folder/module.d.mts')))

    // Check that the files are using the correct module system
    const mjs = (await readFile(resolve(cjsDist, 'esm.mjs'))).toString()
    const cjs = (await readFile(resolve(cjsDist, 'esm/cjs.cjs'))).toString()

    assert.ok(mjs.indexOf('exports.esm') === -1)
    assert.ok(mjs.indexOf('export const esm') > -1)
    assert.ok(cjs.indexOf('exports.cjs') > -1)

    // Check for runtime errors against Node.js
    const { status: statusCjs } = spawnSync(
      'node',
      ['test/__fixtures__/cjsProject/dist/index.js'],
      { shell, stdio: 'inherit' },
    )
    assert.equal(statusCjs, 0)
    const { status: statusEsm } = spawnSync(
      'node',
      ['test/__fixtures__/cjsProject/dist/esm/index.mjs'],
      { shell, stdio: 'inherit' },
    )
    assert.equal(statusEsm, 0)
  })

  it('supports both builds output to directories', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(proDist)
    })
    await duel(['-p', 'test/__fixtures__/project/tsconfig.json', '-d'])

    // tsconfig.json omits outDir, so it should be set to the default value of "dist"
    assert.ok(logged(spy, 0).startsWith('No outDir defined'))
    assert.ok(logged(spy, 3).startsWith('Successfully created a dual CJS build'))
    assert.ok(existsSync(resolve(proDist, 'esm/index.js')))
    assert.ok(existsSync(resolve(proDist, 'cjs/index.cjs')))
  })

  it('supports dirs when original package type is CJS', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(cjsDist)
    })

    await duel(['-p', 'test/__fixtures__/cjsProject/tsconfig.json', '-d'])

    assert.ok(logged(spy, 0).startsWith('Starting primary build'))
    assert.ok(logged(spy, 2).startsWith('Successfully created a dual ESM build'))
    assert.ok(existsSync(resolve(cjsDist, 'cjs/index.cjs')))
    assert.ok(existsSync(resolve(cjsDist, 'cjs/index.d.cts')))
    assert.ok(existsSync(resolve(cjsDist, 'esm/index.js')))
    assert.ok(existsSync(resolve(cjsDist, 'esm/index.d.mts')))
  })

  it('generates exports when requested', async t => {
    const pkgPath = resolve(project, 'package.json')
    const originalPkg = await readFile(pkgPath, 'utf8')

    t.after(async () => {
      await writeFile(pkgPath, originalPkg)
      await rmDist(proDist)
    })

    await duel(['-p', 'test/__fixtures__/project/tsconfig.json', '--exports', 'name'])

    const updatedPkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    const exp = updatedPkg.exports

    assert.ok(exp)
    assert.equal(exp['.']?.import, './dist/index.js')
    assert.equal(exp['.']?.require, './dist/cjs/index.cjs')
    assert.equal(exp['.']?.types, './dist/index.d.ts')
    assert.equal(exp['.']?.default, './dist/index.js')
    assert.equal(exp['./index']?.import, './dist/index.js')
    assert.equal(exp['./index']?.require, './dist/cjs/index.cjs')
    assert.equal(exp['./index']?.types, './dist/index.d.ts')
    assert.equal(exp['./index']?.default, './dist/index.js')
  })

  it('uses extensionless subpaths with dir exports', async t => {
    const pkgPath = resolve(project, 'package.json')
    const originalPkg = await readFile(pkgPath, 'utf8')

    t.after(async () => {
      await writeFile(pkgPath, originalPkg)
      await rmDist(proDist)
    })

    await duel(['-p', 'test/__fixtures__/project/tsconfig.json', '--exports', 'dir'])

    const updatedPkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    const exp = updatedPkg.exports

    assert.ok(exp?.['./folder/*'])

    const folder = exp['./folder/*']

    assert.ok(folder.import || folder.require)
    if (folder.import) {
      assert.match(folder.import, /\*\.m?js$/)
    }
    assert.match(folder.require ?? '', /\*\.cjs$/)
    assert.match(folder.types ?? '', /\*\.d\.(ts|mts|cts)$/)
    assert.equal(folder.default, folder.import ?? folder.require)
  })

  it('uses extensionless subpaths with wildcard exports', async t => {
    const pkgPath = resolve(project, 'package.json')
    const originalPkg = await readFile(pkgPath, 'utf8')

    t.after(async () => {
      await writeFile(pkgPath, originalPkg)
      await rmDist(proDist)
    })

    await duel(['-p', 'test/__fixtures__/project/tsconfig.json', '--exports', 'wildcard'])

    const updatedPkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    const exp = updatedPkg.exports

    assert.ok(exp?.['./folder/*'])

    const folder = exp['./folder/*']

    assert.ok(folder.import || folder.require)
    if (folder.import) {
      assert.match(folder.import, /\*\.m?js$/)
    }
    assert.match(folder.require ?? '', /\*\.cjs$/)
    assert.match(folder.types ?? '', /\*\.d\.(ts|mts|cts)$/)
    assert.equal(folder.default, folder.import ?? folder.require)
  })

  it('resolves name exports via node', async t => {
    const pkgPath = resolve(exportsRes, 'package.json')
    const originalPkg = await readFile(pkgPath, 'utf8')

    t.after(async () => {
      await writeFile(pkgPath, originalPkg)
      await rmDist(exportsResDist)
    })

    await writeFile(pkgPath, originalPkg)

    const runResolve = () => {
      const cmd = `
        import { createRequire } from 'node:module';
        import { pathToFileURL } from 'node:url';
        import path from 'node:path';
        const pkgRoot = ${JSON.stringify(exportsRes)};
        const pkgUrl = pathToFileURL(path.join(pkgRoot, 'package.json'));
        const req = createRequire(pkgUrl);
        const resolveEsm = spec => req.resolve(spec);
        const esmRoot = await import(resolveEsm('exports-resolution'));
        const { root: cr } = req('exports-resolution');
        console.log([esmRoot.root, cr].join(','));
      `

      return spawnSync('node', ['--input-type=module', '-e', cmd], {
        shell,
      })
    }

    await duel(['-p', exportsRes, '--exports', 'name'])
    const res = runResolve()
    assert.equal(res.status, 0)
    assert.equal(res.stdout.toString().trim(), 'root,root')
  })

  it('resolves dir and wildcard exports via node', async t => {
    const pkgPath = resolve(exportsRes, 'package.json')
    const originalPkg = await readFile(pkgPath, 'utf8')

    t.after(async () => {
      await writeFile(pkgPath, originalPkg)
      await rmDist(exportsResDist)
    })

    // Ensure starting from clean package.json before duel mutates exports
    await writeFile(pkgPath, originalPkg)

    const runResolve = () => {
      const cmd = `
        import { createRequire } from 'node:module';
        import { pathToFileURL } from 'node:url';
        import path from 'node:path';
        const pkgRoot = ${JSON.stringify(exportsRes)};
        const pkgUrl = pathToFileURL(path.join(pkgRoot, 'package.json'));
        const req = createRequire(pkgUrl);
        const resolveEsm = spec => req.resolve(spec);
        const esmA = await import(resolveEsm('exports-resolution/utils/a'));
        const esmB = await import(resolveEsm('exports-resolution/utils/b'));
        const { a: ar } = req('exports-resolution/utils/a');
        const { b: br } = req('exports-resolution/utils/b');
        console.log([esmA.a, esmB.b, ar, br].join(','));
      `

      return spawnSync('node', ['--input-type=module', '-e', cmd], {
        shell,
      })
    }

    await duel(['-p', exportsRes, '--exports', 'dir'])
    let res = runResolve()
    assert.equal(res.status, 0)
    assert.equal(res.stdout.toString().trim(), 'a,b,a,b')

    await duel(['-p', exportsRes, '--exports', 'wildcard'])
    res = runResolve()
    assert.equal(res.status, 0)
    assert.equal(res.stdout.toString().trim(), 'a,b,a,b')
  })

  it('wildcard exports handle multi-dot filenames', async t => {
    const pkgPath = resolve(exportsRes, 'package.json')
    const originalPkg = await readFile(pkgPath, 'utf8')

    t.after(async () => {
      await writeFile(pkgPath, originalPkg)
      await rmDist(exportsResDist)
    })

    await writeFile(pkgPath, originalPkg)
    await duel(['-p', exportsRes, '--exports', 'wildcard'])

    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    const folder = pkg.exports?.['./utils/*']

    assert.ok(folder)
    assert.ok(folder.import?.endsWith('/*.js'))
    assert.ok(folder.require?.endsWith('/*.cjs'))
    assert.ok(/\/\*\.d\.(ts|cts|mts)$/.test(folder.types ?? ''))
    assert.ok(!folder.import?.includes('*.bar.js'))
    assert.ok(!folder.types?.includes('*.bar.d.'))

    const runResolve = () => {
      const cmd = `
        import { createRequire } from 'node:module';
        import { pathToFileURL } from 'node:url';
        import path from 'node:path';
        const pkgRoot = ${JSON.stringify(exportsRes)};
        const pkgUrl = pathToFileURL(path.join(pkgRoot, 'package.json'));
        const req = createRequire(pkgUrl);
        const resolveEsm = spec => req.resolve(spec);
        const esmFoo = await import(resolveEsm('exports-resolution/utils/foo.bar'));
        const { fooBar: cr } = req('exports-resolution/utils/foo.bar');
        console.log([esmFoo.fooBar, cr].join(','));
      `

      return spawnSync('node', ['--input-type=module', '-e', cmd], {
        shell,
      })
    }

    const res = runResolve()
    assert.equal(res.status, 0)
    assert.equal(res.stdout.toString().trim(), 'foo.bar,foo.bar')
  })

  it('generates exports with --dirs', async t => {
    const fixture = resolve(__dirname, '__fixtures__/exportsDirs')
    const pkgPath = resolve(fixture, 'package.json')
    const originalPkg = await readFile(pkgPath, 'utf8')
    const distPath = resolve(fixture, 'dist')

    t.after(async () => {
      await writeFile(pkgPath, originalPkg)
      await rmDist(distPath)
    })

    await writeFile(pkgPath, originalPkg)
    await duel(['-p', fixture, '--dirs', '--exports', 'wildcard'])

    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    const exp = pkg.exports

    assert.ok(exp?.['.'])
    assert.equal(exp['.'].import, './dist/esm/index.js')
    assert.equal(exp['.'].default, './dist/esm/index.js')
    assert.ok(exp['.'].types?.includes('/dist/esm/index.d.ts'))
    if (exp['.'].require) {
      assert.ok(exp['.'].require.endsWith('/dist/cjs/index.cjs'))
    }

    const folder = exp['./utils/*']
    assert.ok(folder)
    assert.ok(folder.import?.endsWith('/dist/esm/utils/*.js'))
    assert.ok(folder.require?.endsWith('/dist/cjs/utils/*.cjs'))
    assert.ok(/\/dist\/(cjs|esm)\/utils\/\*\.d\.(ts|cts)$/.test(folder.types ?? ''))
    assert.equal(folder.default, folder.import)
  })

  it('supports import attributes and ts import assertion resolution mode', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(plainDist)
    })
    await duel(['-p', plain, '-k', plain])

    const logs = spy.mock.calls.map((_, i) => logged(spy, i))
    const normalize = str => str.replace(/\r\n/g, '\n')
    const indexEsm = normalize(await readFile(resolve(plainDist, 'index.js'), 'utf8'))
    const indexCjs = normalize(
      await readFile(resolve(plainDist, 'cjs/index.cjs'), 'utf8'),
    )

    assert.match(logs[0], /^Starting primary build/)
    assert.match(logs[1], /^Starting dual build/)
    assert.match(logs[2], /^Successfully created a dual CJS build in \d+ms\./)
    assert.equal(
      indexEsm,
      [
        "import { enforce } from './enforce.js';",
        'export const plugin = () => {',
        '    return {',
        "        name: 'plugin',",
        '        enforce',
        '    };',
        '};',
        '',
      ].join('\n'),
    )
    assert.equal(
      indexCjs,
      [
        '"use strict";',
        'Object.defineProperty(exports, "__esModule", { value: true });',
        'exports.plugin = void 0;',
        'const enforce_js_1 = require("./enforce.cjs");',
        'const plugin = () => {',
        '    return {',
        "        name: 'plugin',",
        '        enforce: enforce_js_1.enforce',
        '    };',
        '};',
        'exports.plugin = plugin;',
        '',
      ].join('\n'),
    )
  })

  it('supports full syntax transforms when requested', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(plainDist)
    })

    await duel(['-p', plain, '-k', plain, '--mode', 'full'])

    const logs = spy.mock.calls.map((_, i) => logged(spy, i))

    assert.match(logs[0], /^Starting primary build/)
    assert.match(logs[1], /^Starting dual build/)
    assert.match(logs[2], /^Successfully created a dual CJS build in \d+ms\./)
    assert.ok(existsSync(resolve(plainDist, 'index.js')))
    assert.ok(existsSync(resolve(plainDist, 'cjs/index.cjs')))

    const { status: statusEsm } = spawnSync('node', [join(plainDist, 'index.js')], {
      shell,
      stdio: 'inherit',
    })
    const { status: statusCjs } = spawnSync('node', [join(plainDist, 'cjs/index.cjs')], {
      shell,
      stdio: 'inherit',
    })

    assert.equal(statusEsm, 0)
    assert.equal(statusCjs, 0)
  })

  it('enables module transforms when --mode full is set', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(errDistDual)
    })

    await duel(['-p', dualError, '--mode', 'full'])

    assert.match(logged(spy, 0), /^Starting primary build/)
    assert.match(logged(spy, 1), /^Starting dual build/)
    assert.match(logged(spy, 2), /^Successfully created a dual CJS build/)
    assert.ok(existsSync(resolve(errDistDual, 'index.js')))
    assert.ok(existsSync(resolve(errDistDual, 'cjs/index.cjs')))

    const { status: statusEsm } = spawnSync('node', [join(errDistDual, 'index.js')], {
      shell,
      stdio: 'inherit',
    })
    const { status: statusCjs } = spawnSync(
      'node',
      [join(errDistDual, 'cjs/index.cjs')],
      {
        shell,
        stdio: 'inherit',
      },
    )

    assert.equal(statusEsm, 0)
    assert.equal(statusCjs, 0)
  })

  it('works as a cli script', { skip: shell }, () => {
    const resp = execSync(`${resolve(__dirname, '..', 'src', 'duel.js')} -h`, {
      shell,
    })

    assert.ok(resp.toString().indexOf('Options:') > -1)
  })

  it('reports compilation errors during a build', async t => {
    const spy = t.mock.method(global.console, 'log')
    const spyExit = t.mock.method(process, 'exit')

    t.after(async () => {
      await rmDist(errDist)
    })
    spyExit.mock.mockImplementation(number => {
      throw new Error(`Mocked process.exit: ${number}`)
    })
    await assert.rejects(
      async () => {
        await duel(['-p', 'test/__fixtures__/compileErrors/tsconfig.json'])
      },
      { message: /Mocked process\.exit/ },
    )

    assert.ok(spyExit.mock.calls[0].arguments > 0)
    assert.equal(logged(spy, 1), 'Compilation errors found.')
  })

  /**
   * Check for compilation errors in the dual build.
   * `The 'import.meta' meta-property is not allowed in files which will build into CommonJS output.`
   * This test targets unexpected behavior by tsc:
   * @see https://github.com/microsoft/TypeScript/issues/58658
   */
  it('reports compile errors for the dual build', async t => {
    const spy = t.mock.method(global.console, 'log')
    const spyExit = t.mock.method(process, 'exit')

    t.after(async () => {
      await rmDist(errDistDual)
    })
    spyExit.mock.mockImplementation(number => {
      throw new Error(`Mocked process.exit: ${number}`)
    })
    await assert.rejects(
      async () => {
        await duel(['-p', dualError])
      },
      { message: /Mocked process\.exit/ },
    )

    assert.ok(spyExit.mock.calls[0].arguments > 0)
    assert.ok(logged(spy, 1).includes('Starting dual build...'))
    assert.equal(logged(spy, 2), 'Compilation errors found.')
  })

  it('mitigates import.meta errors when using --mode full', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(errDistDual)
    })

    await duel(['-p', dualError, '--mode', 'full'])

    assert.match(logged(spy, 0), /^Starting primary build/)
    assert.match(logged(spy, 1), /^Starting dual build/)
    assert.match(logged(spy, 2), /^Successfully created a dual CJS build/)
    assert.ok(existsSync(resolve(errDistDual, 'index.js')))
    assert.ok(existsSync(resolve(errDistDual, 'cjs/index.cjs')))
  })

  it('supports --mode globals and --mode full', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(errDistDual)
    })

    await duel(['-p', dualError, '--mode', 'globals'])
    assert.match(logged(spy, 0), /^Starting primary build/)
    assert.match(logged(spy, 1), /^Starting dual build/)
    assert.match(logged(spy, 2), /^Successfully created a dual CJS build/)
    assert.ok(existsSync(resolve(errDistDual, 'index.js')))
    assert.ok(existsSync(resolve(errDistDual, 'cjs/index.cjs')))

    let statusEsm = spawnSync('node', [join(errDistDual, 'index.js')], {
      shell,
      stdio: 'inherit',
    }).status
    let statusCjs = spawnSync('node', [join(errDistDual, 'cjs/index.cjs')], {
      shell,
      stdio: 'inherit',
    }).status

    assert.equal(statusEsm, 0)
    assert.equal(statusCjs, 0)

    await rmDist(errDistDual)

    await duel(['-p', dualError, '--mode', 'full'])
    assert.match(logged(spy, 3), /^Starting primary build/)
    assert.match(logged(spy, 4), /^Starting dual build/)
    assert.match(logged(spy, 5), /^Successfully created a dual CJS build/)
    assert.ok(existsSync(resolve(errDistDual, 'index.js')))
    assert.ok(existsSync(resolve(errDistDual, 'cjs/index.cjs')))

    statusEsm = spawnSync('node', [join(errDistDual, 'index.js')], {
      shell,
      stdio: 'inherit',
    }).status
    statusCjs = spawnSync('node', [join(errDistDual, 'cjs/index.cjs')], {
      shell,
      stdio: 'inherit',
    }).status

    assert.equal(statusEsm, 0)
    assert.equal(statusCjs, 0)
  })

  it('reports an error when no package.json file found', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(esmDist)
    })
    await duel(['-p', 'test/__fixtures__/esmProject/tsconfig.json', '--pkg-dir', '/'])
    assert.equal(logged(spy, 0), 'No package.json file found.')
  })

  it('supports extended configs', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(extDist)
    })
    await duel(['-p', join(extended, 'src')])

    assert.ok(!logged(spy, 0).startsWith('No outDir defined'))
    assert.ok(logged(spy, 2).startsWith('Successfully created a dual CJS build'))

    // Check for runtime errors against Node.js
    const { status: statusEsm } = spawnSync(
      'node',
      ['test/__fixtures__/extended/dist/file.js'],
      { shell, stdio: 'inherit' },
    )
    assert.equal(statusEsm, 0)
    const { status: statusCjs } = spawnSync(
      'node',
      ['test/__fixtures__/extended/dist/cjs/file.cjs'],
      { shell, stdio: 'inherit' },
    )
    assert.equal(statusCjs, 0)
  })
})
