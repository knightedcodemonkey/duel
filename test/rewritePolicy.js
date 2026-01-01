import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { rewriteSpecifiersAndExtensions } from '../src/resolver.js'

const makeTempFile = content => {
  const dir = mkdtempSync(join(tmpdir(), 'duel-rewrite-'))
  const file = join(dir, 'entry.js')
  writeFileSync(file, content)
  return { dir, file }
}

const cleanup = dir => rmSync(dir, { recursive: true, force: true })
const readOut = file => {
  const out = file.replace(/\.js$/, '.cjs')
  try {
    return readFileSync(out, 'utf8')
  } catch {
    return readFileSync(file, 'utf8')
  }
}

describe('rewrite-policy', () => {
  it('safe skips missing targets and warns', async () => {
    const { dir, file } = makeTempFile("import './missing.js'\n")
    const warnings = []

    await rewriteSpecifiersAndExtensions([file], {
      target: 'commonjs',
      ext: '.cjs',
      rewritePolicy: 'safe',
      validateSpecifiers: true,
      onWarn: msg => warnings.push(msg),
    })

    const output = readOut(file)
    assert.equal(output, "import './missing.js'\n")
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /Skipped rewrite for missing target/)

    cleanup(dir)
  })

  it('warn rewrites missing targets and warns', async () => {
    const { dir, file } = makeTempFile("import './missing.js'\n")
    const warnings = []

    await rewriteSpecifiersAndExtensions([file], {
      target: 'commonjs',
      ext: '.cjs',
      rewritePolicy: 'warn',
      validateSpecifiers: true,
      onWarn: msg => warnings.push(msg),
    })

    const output = readOut(file)
    assert.equal(output, "import './missing.cjs'\n")
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /Rewriting specifier with missing target/)

    cleanup(dir)
  })

  it('skip leaves specifiers untouched and quiet', async () => {
    const { dir, file } = makeTempFile("import './missing.js'\n")
    const warnings = []

    await rewriteSpecifiersAndExtensions([file], {
      target: 'commonjs',
      ext: '.cjs',
      rewritePolicy: 'skip',
      validateSpecifiers: true,
      onWarn: msg => warnings.push(msg),
    })

    const output = readOut(file)
    assert.equal(output, "import './missing.js'\n")
    assert.equal(warnings.length, 0)

    cleanup(dir)
  })
})
