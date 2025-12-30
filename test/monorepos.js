import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, join, dirname } from 'node:path'
import { rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import spawn from 'cross-spawn'

import { duel } from '../src/duel.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(__dirname, '__fixtures__')
const npm = join(fixtures, 'mononpm')
const npmOne = join(npm, 'one')
const npmTwo = join(npm, 'two')
const rmDist = async distPath => {
  await rm(distPath, { recursive: true, force: true })
}

describe('duel monorepos', () => {
  before(async () => {
    await rmDist(join(npmOne, 'dist'))
    await rmDist(join(npmTwo, 'dist'))
  })

  it('works with npm monorepos (workspaces)', async t => {
    t.after(async () => {
      await rmDist(join(npmOne, 'dist'))
      await rmDist(join(npmTwo, 'dist'))
    })

    // cross-spawn handles Windows .cmd files without needing shell
    spawn.sync('npm', ['install'], { cwd: npm })

    // Build the packages (dependency first)
    await duel(['-p', npmTwo, '-k', npmTwo, '--mode', 'globals'])
    await duel(['-p', npmOne, '-k', npmOne, '--mode', 'globals'])

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
