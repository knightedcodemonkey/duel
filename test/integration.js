import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { rm, readFile, rename } from 'node:fs/promises'
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
const errDistDual = join(dualError, 'dist')
const errDist = resolve(__dirname, '__fixtures__/compileErrors/dist')
const rmDist = async distPath => {
  await rm(distPath, { recursive: true, force: true })
}
const shell = platform === 'win32'

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
    assert.ok(spy.mock.calls[1].arguments[0].startsWith('Options:'))
  })

  it('reports errors when passing invalid options', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['--invalid'])
    assert.equal(spy.mock.calls[0].arguments[1], "Unknown option '--invalid'")
  })

  it('uses default --project value of "tsconfig.json"', async t => {
    const spy = t.mock.method(global.console, 'log')
    const tsConfigPath = resolve('./tsconfig.json')
    const tsConfigPathTemp = tsConfigPath.replace('tsconfig', 'tsconfig.temp')

    await rename(tsConfigPath, tsConfigPathTemp)
    await duel()
    assert.ok(spy.mock.calls[0].arguments[1].endsWith('is not a file or directory.'))
    await rename(tsConfigPathTemp, tsConfigPath)
  })

  it('reports errors when --project is a directory with no tsconfig.json', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['-p', 'test/__fixtures__'])
    assert.ok(spy.mock.calls[0].arguments[1].endsWith('no tsconfig.json.'))
  })

  it('reports errors when using deprecated --target-extension', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['-x', '.mjs'])
    assert.ok(
      spy.mock.calls[0].arguments[1].startsWith('--target-extension is deprecated'),
    )
  })

  it('creates a dual CJS build while transforming module globals', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(esmDist)
    })
    await duel(['--project', 'test/__fixtures__/esmProject', '-m'])

    // Third call because of logging for starting each build.
    assert.ok(
      spy.mock.calls[2].arguments[0].startsWith('Successfully created a dual CJS build'),
    )
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
    await duel(['-p', 'test/__fixtures__/cjsProject/tsconfig.json', '-m'])

    assert.ok(
      spy.mock.calls[2].arguments[0].startsWith('Successfully created a dual ESM build'),
    )
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
    assert.ok(spy.mock.calls[0].arguments[0].startsWith('No outDir defined'))
    assert.ok(
      spy.mock.calls[3].arguments[0].startsWith('Successfully created a dual CJS build'),
    )
    assert.ok(existsSync(resolve(proDist, 'esm/index.js')))
    assert.ok(existsSync(resolve(proDist, 'cjs/index.cjs')))
  })

  it('supports import attributes and ts import assertion resolution mode', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(plainDist)
    })
    await duel(['-p', plain, '-k', plain])

    assert.ok(
      spy.mock.calls[2].arguments[0].startsWith('Successfully created a dual CJS build'),
    )
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
    assert.equal(spy.mock.calls[1].arguments[1], 'Compilation errors found.')
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
    assert.ok(spy.mock.calls[1].arguments[0].includes('Starting dual build...'))
    assert.equal(spy.mock.calls[2].arguments[1], 'Compilation errors found.')
  })

  it('reports an error when no package.json file found', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(esmDist)
    })
    await duel(['-p', 'test/__fixtures__/esmProject/tsconfig.json', '--pkg-dir', '/'])
    assert.equal(spy.mock.calls[0].arguments[1], 'No package.json file found.')
  })

  it('supports extended configs', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(extDist)
    })
    await duel(['-p', join(extended, 'src')])

    assert.ok(!spy.mock.calls[0].arguments[0].startsWith('No outDir defined'))
    assert.ok(
      spy.mock.calls[2].arguments[0].startsWith('Successfully created a dual CJS build'),
    )

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
