import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import { duel } from '../src/duel.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const esmProject = resolve(__dirname, '__fixtures__/esmProject')
const cjsProject = resolve(__dirname, '__fixtures__/cjsProject')
const esmDist = join(esmProject, 'dist')
const cjsDist = join(cjsProject, 'dist')
const errDist = resolve(__dirname, '__fixtures__/compileErrors/dist')
const rmDist = async distPath => {
  await rm(distPath, { recursive: true, force: true })
}

describe('duel', () => {
  before(async () => {
    await rmDist(esmDist)
    await rmDist(cjsDist)
    await rmDist(errDist)
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
    /**
     * Should error due to the cwd of this processs not being
     * within test/__fixtures__/esmProject.
     */
    await duel()
    assert.ok(spy.mock.calls[0].arguments[1].endsWith('is not a file or directory.'))
  })

  it('reports errors when --project is a directory with no tsconfig.json', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['-p', 'test/__fixtures__'])
    assert.ok(spy.mock.calls[0].arguments[1].endsWith('no tsconfig.json.'))
  })

  it('reports errors when --project is not valid json', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['-p', 'test/__fixtures__/esmProject/tsconfig.not.json'])
    assert.ok(spy.mock.calls[0].arguments[1].endsWith('not parsable as JSON.'))
  })

  it('reports errors when the config in --project has no outDir', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['-p', 'test/__fixtures__/esmProject/tsconfig.noOutDir.json'])
    assert.equal(
      spy.mock.calls[0].arguments[1],
      'You must define an `outDir` in your project config.',
    )
  })

  it('reports errors when using deprecated --target-extension', async t => {
    const spy = t.mock.method(global.console, 'log')

    await duel(['-x', '.mjs'])
    assert.ok(
      spy.mock.calls[0].arguments[1].startsWith('--target-extension is deprecated'),
    )
  })

  it('creates a dual CJS build', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(esmDist)
    })
    await duel(['--project', 'test/__fixtures__/esmProject', '--pkg-dir', esmProject])

    // Third call because of logging for starting each build.
    assert.ok(
      spy.mock.calls[2].arguments[0].startsWith('Successfully created a dual CJS build'),
    )
    // Check that the expected files and extensions are there
    assert.ok(existsSync(resolve(esmDist, 'index.js')))
    assert.ok(existsSync(resolve(esmDist, 'index.d.ts')))
    assert.ok(existsSync(resolve(esmDist, 'cjs.cjs')))
    assert.ok(existsSync(resolve(esmDist, 'cjs/index.cjs')))
    assert.ok(existsSync(resolve(esmDist, 'cjs/index.d.cts')))
    assert.ok(existsSync(resolve(esmDist, 'cjs/esm.mjs')))

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

  it('creates a dual ESM build', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(cjsDist)
    })
    await duel(['-p', 'test/__fixtures__/cjsProject/tsconfig.json', '-k', cjsProject])

    assert.ok(
      spy.mock.calls[2].arguments[0].startsWith('Successfully created a dual ESM build'),
    )
    assert.ok(existsSync(resolve(cjsDist, 'index.js')))
    assert.ok(existsSync(resolve(cjsDist, 'index.d.ts')))
    assert.ok(existsSync(resolve(cjsDist, 'mjs/index.mjs')))

    // Check that the files are using the correct module system
    const mjs = (await readFile(resolve(cjsDist, 'esm.mjs'))).toString()
    const cjs = (await readFile(resolve(cjsDist, 'mjs/cjs.cjs'))).toString()

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
      ['test/__fixtures__/cjsProject/dist/mjs/index.mjs'],
      { stdio: 'inherit' },
    )
    assert.equal(statusEsm, 0)
  })

  it('reports compilation errors during a build', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(errDist)
    })
    await duel(['-p', 'test/__fixtures__/compileErrors/tsconfig.json'])
    assert.equal(spy.mock.calls[1].arguments[1], 'Compilation errors found.')
  })

  it('reports an error when no package.json file found', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(esmDist)
    })
    await duel(['-p', 'test/__fixtures__/esmProject/tsconfig.json', '--pkg-dir', '/'])
    assert.equal(spy.mock.calls[0].arguments[1], 'No package.json file found.')
  })
})
