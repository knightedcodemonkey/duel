import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { platform } from 'node:process'

import { duel } from '../src/duel.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const plain = resolve(__dirname, '__fixtures__/plain')
const project = resolve(__dirname, '__fixtures__/project')
const esmProject = resolve(__dirname, '__fixtures__/esmProject')
const plainDist = join(plain, 'dist')
const proDist = join(project, 'dist')
const esmDist = join(esmProject, 'dist')
const errDist = resolve(__dirname, '__fixtures__/compileErrors/dist')
const rmDist = async distPath => {
  await rm(distPath, { recursive: true, force: true })
}
const shell = platform === 'win32'

describe('duel', () => {
  before(async () => {
    await rmDist(proDist)
    await rmDist(esmDist)
    await rmDist(errDist)
    await rmDist(plainDist)
  })

  it('supports both builds output to directories', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(proDist)
    })
    await duel(['-p', 'test/__fixtures__/project/tsconfig.json', '-k', project, '-d'])

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

  it.skip('works as a cli script', () => {
    const resp = execSync(`${resolve('./src/duel.js')} -h`, {
      shell,
      cwd: resolve(__dirname, '..'),
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

  it.skip('reports an error when no package.json file found', async t => {
    const spy = t.mock.method(global.console, 'log')

    t.after(async () => {
      await rmDist(esmDist)
    })
    await duel(['-p', 'test/__fixtures__/esmProject/tsconfig.json', '--pkg-dir', '/'])
    assert.equal(spy.mock.calls[0].arguments[1], 'No package.json file found.')
  })
})
