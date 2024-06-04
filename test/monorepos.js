import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { rm, readFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync, execSync } from 'node:child_process'

import { duel } from '../src/duel.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const fixtures = resolve(import.meta.dirname, '__fixtures__')
const npm = join(fixtures, 'mononpm')
const npmOne = join(npm, 'one')
const npmTwo = join(npm, 'two')

const cjsProject = resolve(__dirname, '__fixtures__/cjsProject')

const cjsDist = join(cjsProject, 'dist')
const rmDist = async distPath => {
  await rm(distPath, { recursive: true, force: true })
}

describe('duel monorepos', () => {
  before(async () => {
    await rmDist(join(npmOne, 'dist'))
    await rmDist(join(npmTwo, 'dist'))
  })

  it.skip('creates a dual ESM build', async t => {
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
    assert.ok(existsSync(resolve(cjsDist, 'esm/index.mjs')))

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

  it('works with npm monorepos (workspaces)', async t => {
    t.after(async () => {
      //await rmDist(join(npmOne, 'dist'))
      //await rmDist(join(npmTwo, 'dist'))
    })

    // Build the packages (dependency first)
    await duel(['-p', npmTwo, '-k', npmTwo])
    await duel(['-p', npmOne, '-k', npmOne])

    // Check for runtime errors against Node.js
    const { status: twoEsm } = spawnSync('node', [join(npmTwo, 'dist', 'file.js')], {
      stdio: 'inherit',
    })
    assert.equal(twoEsm, 0)
    const { status: twoCjs } = spawnSync(
      'node',
      [join(npmTwo, 'dist', 'cjs', 'file.cjs')],
      { stdio: 'inherit' },
    )
    assert.equal(twoCjs, 0)
    const { status: oneEsm } = spawnSync('node', [join(npmOne, 'dist', 'main.js')], {
      stdio: 'inherit',
    })
    assert.equal(oneEsm, 0)
    const { status: oneCjs } = spawnSync(
      'node',
      [join(npmOne, 'dist', 'cjs', 'main.cjs')],
      { stdio: 'inherit' },
    )
    assert.equal(oneCjs, 0)
  })
})
