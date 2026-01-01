import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { rm, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

import spawn from 'cross-spawn'

import { duel } from '../src/duel.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const plain = resolve(__dirname, '__fixtures__/plain')
const project = resolve(__dirname, '__fixtures__/project')
const esmProject = resolve(__dirname, '__fixtures__/esmProject')
const cjsProject = resolve(__dirname, '__fixtures__/cjsProject')
const extended = resolve(__dirname, '__fixtures__/extended')
const dualHazard = resolve(__dirname, '__fixtures__/dualHazard')
const dualError = resolve(__dirname, '__fixtures__/compileErrorsDual')
const plainDist = join(plain, 'dist')
const proDist = join(project, 'dist')
const esmDist = join(esmProject, 'dist')
const cjsDist = join(cjsProject, 'dist')
const extDist = join(extended, 'dist')
const hazardDist = join(dualHazard, 'dist')
const exportsRes = resolve(__dirname, '__fixtures__/exportsResolution')
const exportsResDist = join(exportsRes, 'dist')
const projectRefs = resolve(__dirname, '__fixtures__/projectRefs')
const projectRefsDist = join(projectRefs, 'dist')
let projectRefsInstalled = false
const itCI = process.env.CI ? it : it.skip

const ensureProjectRefsInstalled = () => {
  if (projectRefsInstalled) return

  const res = spawn.sync('npm', ['install', '--ignore-scripts', '--no-fund'], {
    cwd: projectRefs,
    stdio: 'inherit',
  })

  if (res.status !== 0) {
    throw new Error('projectRefs npm install failed')
  }

  projectRefsInstalled = true
}
const errDistDual = join(dualError, 'dist')
const errDist = resolve(__dirname, '__fixtures__/compileErrors/dist')
const rmDist = async distPath => {
  await rm(distPath, { recursive: true, force: true })
}
// eslint-disable-next-line no-control-regex
const ansiRegex = /\u001b\[[0-9;]*m/g
const stripBadge = str => str.replace(/^\[[^\]]+\]\s*/, '')
const stripAnsi = str => (typeof str === 'string' ? str.replace(ansiRegex, '') : '')
const runScript = (script, { cwd } = {}) => {
  const baseDir = cwd ?? tmpdir()
  const dir = mkdtempSync(join(baseDir, 'duel-resolve-'))
  const scriptPath = join(dir, 'script.mjs')

  try {
    writeFileSync(scriptPath, script)

    const res = spawnSync(process.execPath, [scriptPath], {
      cwd,
    })

    return res
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
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
    await rmDist(projectRefsDist)
    await rmDist(hazardDist)
  })

  it('prints options help', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['--help'])
    assert.ok(logged(spy, 1).startsWith('Options:'))
  })

  itCI('reports errors when passing invalid options', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['--invalid'])
    assert.equal(logged(spy, 0), "Unknown option '--invalid'")
  })

  itCI('reports errors for invalid copy modes', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['--copy-mode', 'nope'])
    assert.ok(logged(spy, 0).includes('--copy-mode expects'))
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

  itCI('reports errors for invalid dual hazard options', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['--dual-package-hazard-scope', 'nope'])
    assert.ok(logged(spy, 0).includes('--dual-package-hazard-scope expects'))

    await duel(['--detect-dual-package-hazard', 'nope'])
    assert.ok(logged(spy, 1).includes('--detect-dual-package-hazard expects'))
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
      { stdio: 'inherit' },
    )
    assert.equal(statusEsm, 0)
    const { status: statusCjs } = spawnSync(
      'node',
      ['test/__fixtures__/esmProject/dist/cjs/index.cjs'],
      { stdio: 'inherit' },
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
      { stdio: 'inherit' },
    )
    assert.equal(statusCjs, 0)
    const { status: statusEsm } = spawnSync(
      'node',
      ['test/__fixtures__/cjsProject/dist/esm/index.mjs'],
      { stdio: 'inherit' },
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

  it('builds with full copy mode when requested', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(plainDist)
    })

    await duel(['-p', 'test/__fixtures__/plain/tsconfig.json', '--copy-mode', 'full'])

    assert.ok(logged(spy, 2).startsWith('Successfully created a dual CJS build'))
    assert.ok(existsSync(resolve(plainDist, 'index.js')))
    assert.ok(existsSync(resolve(plainDist, 'cjs/index.cjs')))
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

  it('builds project references with hoisted deps via temp dir', async t => {
    const pkgPath = resolve(projectRefs, 'package.json')
    const originalPkg = await readFile(pkgPath, 'utf8')

    t.after(async () => {
      await writeFile(pkgPath, originalPkg)
      await rmDist(projectRefsDist)
    })

    ensureProjectRefsInstalled()

    await duel([
      '-p',
      'test/__fixtures__/projectRefs/packages/lib/tsconfig.json',
      '--mode',
      'globals',
    ])

    await duel([
      '-p',
      'test/__fixtures__/projectRefs/packages/app/tsconfig.json',
      '--mode',
      'globals',
    ])

    assert.ok(existsSync(join(projectRefsDist, 'app', 'index.js')))
    assert.ok(existsSync(join(projectRefsDist, 'app', 'cjs', 'index.cjs')))
    assert.ok(existsSync(join(projectRefsDist, 'lib', 'index.js')))

    const { status: esmStatus } = spawnSync(
      'node',
      [join(projectRefsDist, 'app', 'index.js')],
      {
        cwd: projectRefs,
        stdio: 'inherit',
      },
    )
    assert.equal(esmStatus, 0)

    const { status: cjsStatus } = spawnSync(
      'node',
      [join(projectRefsDist, 'app', 'cjs', 'index.cjs')],
      {
        cwd: projectRefs,
        stdio: 'inherit',
      },
    )
    assert.equal(cjsStatus, 0)
  })

  it('builds multi-hop project references (sources copy)', async t => {
    t.after(async () => {
      await rmDist(projectRefsDist)
    })

    ensureProjectRefsInstalled()

    await duel([
      '-p',
      'test/__fixtures__/projectRefs/packages/chain-a/tsconfig.json',
      '--mode',
      'globals',
    ])

    assert.ok(existsSync(join(projectRefsDist, 'chain-a', 'index.js')))
    assert.ok(existsSync(join(projectRefsDist, 'chain-b', 'index.js')))
    assert.ok(existsSync(join(projectRefsDist, 'chain-c', 'index.js')))
    assert.ok(existsSync(join(projectRefsDist, 'chain-a', 'cjs', 'index.cjs')))

    const { status: esmStatus } = spawnSync(
      'node',
      [join(projectRefsDist, 'chain-a', 'index.js')],
      {
        cwd: projectRefs,
        stdio: 'inherit',
      },
    )
    assert.equal(esmStatus, 0)

    const { status: cjsStatus } = spawnSync(
      'node',
      [join(projectRefsDist, 'chain-a', 'cjs', 'index.cjs')],
      {
        cwd: projectRefs,
        stdio: 'inherit',
      },
    )
    assert.equal(cjsStatus, 0)
  })

  it('honors explicit tsconfig filenames in references', async t => {
    t.after(async () => {
      await rmDist(projectRefsDist)
    })

    ensureProjectRefsInstalled()

    await duel([
      '-p',
      'test/__fixtures__/projectRefs/packages/custom-app/tsconfig.json',
      '--mode',
      'globals',
    ])

    assert.ok(existsSync(join(projectRefsDist, 'custom-app', 'index.js')))
    assert.ok(existsSync(join(projectRefsDist, 'custom-lib', 'index.js')))
    assert.ok(existsSync(join(projectRefsDist, 'custom-app', 'cjs', 'index.cjs')))

    const { status: esmStatus } = spawnSync(
      'node',
      [join(projectRefsDist, 'custom-app', 'index.js')],
      {
        cwd: projectRefs,
        stdio: 'inherit',
      },
    )
    assert.equal(esmStatus, 0)

    const { status: cjsStatus } = spawnSync(
      'node',
      [join(projectRefsDist, 'custom-app', 'cjs', 'index.cjs')],
      {
        cwd: projectRefs,
        stdio: 'inherit',
      },
    )
    assert.equal(cjsStatus, 0)
  })

  it('surfaces project dual package hazards', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(hazardDist)
    })

    await duel(['-p', dualHazard, '--dual-package-hazard-scope', 'project'])

    const hazards = spy.mock.calls
      .map((_, i) => logged(spy, i))
      .filter(line => line.includes('dual-package-mixed-specifiers'))

    assert.ok(hazards.length >= 1)
    assert.ok(hazards[0].includes('hazard-lib'))
  })

  it('exits on dual package hazards when requested', async t => {
    const spyExit = t.mock.method(process, 'exit')
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(hazardDist)
    })

    class ExitError extends Error {
      constructor(code) {
        super('process.exit')
        this.code = code
      }
    }

    spyExit.mock.mockImplementation(code => {
      throw new ExitError(code)
    })

    await assert.rejects(
      async () => {
        await duel([
          '-p',
          dualHazard,
          '--dual-package-hazard-scope',
          'project',
          '--detect-dual-package-hazard',
          'error',
        ])
      },
      err => err instanceof ExitError && err.code === 1,
    )

    const hazards = spy.mock.calls
      .map((_, i) => logged(spy, i))
      .filter(line => line.includes('dual-package-mixed-specifiers'))

    assert.ok(hazards.length >= 1)
  })

  it('validates exports-config without writing exports', async t => {
    const pkgPath = resolve(project, 'package.json')
    const originalPkg = await readFile(pkgPath, 'utf8')

    t.after(async () => {
      await writeFile(pkgPath, originalPkg)
      await rmDist(proDist)
    })

    await duel([
      '-p',
      'test/__fixtures__/project/tsconfig.json',
      '--exports-config',
      'test/__fixtures__/project/exports.config.json',
      '--exports-validate',
    ])

    const updatedPkg = JSON.parse(await readFile(pkgPath, 'utf8'))

    assert.ok(!updatedPkg.exports)
  })

  it('fails on invalid exports-config JSON', async t => {
    const spyExit = t.mock.method(process, 'exit')
    const spy = t.mock.method(global.console, 'log')

    class ExitError extends Error {
      constructor(code) {
        super('process.exit')
        this.code = code
      }
    }

    spyExit.mock.mockImplementation(code => {
      throw new ExitError(code)
    })

    await assert.rejects(
      async () => {
        await duel([
          '-p',
          'test/__fixtures__/project/tsconfig.json',
          '--exports-config',
          'test/__fixtures__/project/exports.invalid.json',
        ])
      },
      err => err instanceof ExitError && err.code === 1,
    )

    const messages = spy.mock.calls.map((_, i) => logged(spy, i))
    assert.ok(messages.some(m => m.includes('Invalid JSON in --exports-config')))
  })

  it('fails on invalid exports-config entries shape', async t => {
    const spyExit = t.mock.method(process, 'exit')
    const spy = t.mock.method(global.console, 'log')

    class ExitError extends Error {
      constructor(code) {
        super('process.exit')
        this.code = code
      }
    }

    spyExit.mock.mockImplementation(code => {
      throw new ExitError(code)
    })

    await assert.rejects(
      async () => {
        await duel([
          '-p',
          'test/__fixtures__/project/tsconfig.json',
          '--exports-config',
          'test/__fixtures__/project/exports.bad-entries.json',
        ])
      },
      err => err instanceof ExitError && err.code === 1,
    )

    const messages = spy.mock.calls.map((_, i) => logged(spy, i))
    assert.ok(
      messages.some(m =>
        m.includes('--exports-config expects an object with an "entries"'),
      ),
    )
  })

  it('filters exports to configured entries', async t => {
    const pkgPath = resolve(project, 'package.json')
    const originalPkg = await readFile(pkgPath, 'utf8')

    t.after(async () => {
      await writeFile(pkgPath, originalPkg)
      await rmDist(proDist)
    })

    await duel([
      '-p',
      'test/__fixtures__/project/tsconfig.json',
      '--exports-config',
      'test/__fixtures__/project/exports.config.json',
      '--exports',
      'name',
    ])

    const updatedPkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    const exp = updatedPkg.exports

    assert.ok(exp)
    assert.deepEqual(Object.keys(exp).sort(), ['.', './folder/module', './index'].sort())
    assert.equal(exp['./folder/module']?.import, './dist/folder/module.js')
    assert.equal(exp['./folder/module']?.require, './dist/cjs/folder/module.cjs')
    assert.equal(exp['./folder/module']?.types, './dist/folder/module.d.ts')
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
        const pkgRoot = ${JSON.stringify(exportsRes)};
        process.chdir(pkgRoot);
        const req = createRequire(import.meta.url);
        const esmRoot = await import('exports-resolution');
        const { root: cr } = req('exports-resolution');
        console.log([esmRoot.root, cr].join(','));
      `

      return runScript(cmd, { cwd: exportsRes })
    }

    await duel(['-p', exportsRes, '--exports', 'name'])
    const res = runResolve()
    assert.equal(res.status, 0, res.stderr?.toString() || res.stdout?.toString())
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
        const pkgRoot = ${JSON.stringify(exportsRes)};
        process.chdir(pkgRoot);
        const req = createRequire(import.meta.url);
        const esmA = await import('exports-resolution/utils/a');
        const esmB = await import('exports-resolution/utils/b');
        const { a: ar } = req('exports-resolution/utils/a');
        const { b: br } = req('exports-resolution/utils/b');
        console.log([esmA.a, esmB.b, ar, br].join(','));
      `

      return runScript(cmd, { cwd: exportsRes })
    }

    await duel(['-p', exportsRes, '--exports', 'dir'])
    let res = runResolve()
    assert.equal(res.status, 0, res.stderr?.toString() || res.stdout?.toString())
    assert.equal(res.stdout.toString().trim(), 'a,b,a,b')

    await duel(['-p', exportsRes, '--exports', 'wildcard'])
    res = runResolve()
    assert.equal(res.status, 0, res.stderr?.toString() || res.stdout?.toString())
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
        const pkgRoot = ${JSON.stringify(exportsRes)};
        process.chdir(pkgRoot);
        const req = createRequire(import.meta.url);
        const esmFoo = await import('exports-resolution/utils/foo.bar');
        const { fooBar: cr } = req('exports-resolution/utils/foo.bar');
        console.log([esmFoo.fooBar, cr].join(','));
      `

      return runScript(cmd, { cwd: exportsRes })
    }

    const res = runResolve()
    assert.equal(res.status, 0, res.stderr?.toString() || res.stdout?.toString())
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
      stdio: 'inherit',
    })
    const { status: statusCjs } = spawnSync('node', [join(plainDist, 'cjs/index.cjs')], {
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
      stdio: 'inherit',
    })
    const { status: statusCjs } = spawnSync(
      'node',
      [join(errDistDual, 'cjs/index.cjs')],
      {
        stdio: 'inherit',
      },
    )

    assert.equal(statusEsm, 0)
    assert.equal(statusCjs, 0)
  })

  it('works as a cli script', () => {
    const { stdout } = spawnSync(process.execPath, [
      resolve(__dirname, '..', 'src', 'duel.js'),
      '-h',
    ])

    assert.ok(stdout.toString().indexOf('Options:') > -1)
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
      stdio: 'inherit',
    }).status
    let statusCjs = spawnSync('node', [join(errDistDual, 'cjs/index.cjs')], {
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
      stdio: 'inherit',
    }).status
    statusCjs = spawnSync('node', [join(errDistDual, 'cjs/index.cjs')], {
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
      { stdio: 'inherit' },
    )
    assert.equal(statusEsm, 0)
    const { status: statusCjs } = spawnSync(
      'node',
      ['test/__fixtures__/extended/dist/cjs/file.cjs'],
      { stdio: 'inherit' },
    )
    assert.equal(statusCjs, 0)
  })
})
