import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { platform } from 'node:process'

import { duel } from '../src/duel.js'

const fixtures = resolve(import.meta.dirname, '__fixtures__')
const npm = join(fixtures, 'mononpm')
const npmOne = join(npm, 'one')
const npmTwo = join(npm, 'two')
const shell = platform === 'win32'
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

    spawnSync('npm', ['install'], { shell, cwd: npm })

    // Build the packages (dependency first)
    await duel(['-p', npmTwo, '-k', npmTwo, '--mode', 'globals'])
    await duel(['-p', npmOne, '-k', npmOne, '--mode', 'globals'])

    // Check for runtime errors against Node.js
    const { status: twoEsm } = spawnSync('node', [join(npmTwo, 'dist', 'file.js')], {
      shell,
      stdio: 'inherit',
    })
    assert.equal(twoEsm, 0)
    const { status: twoCjs } = spawnSync(
      'node',
      [join(npmTwo, 'dist', 'cjs', 'file.cjs')],
      { shell, stdio: 'inherit' },
    )
    assert.equal(twoCjs, 0)
    const { status: oneEsm } = spawnSync('node', [join(npmOne, 'dist', 'main.js')], {
      shell,
      stdio: 'inherit',
    })
    assert.equal(oneEsm, 0)
    const { status: oneCjs } = spawnSync(
      'node',
      [join(npmOne, 'dist', 'cjs', 'main.cjs')],
      { shell, stdio: 'inherit' },
    )
    assert.equal(oneCjs, 0)
  })
})
