import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import os from 'node:os'

const makeTmp = () => mkdtempSync(join(os.tmpdir(), 'duel-cleanup-integration-'))

describe('cleanup integration (guarded)', () => {
  it('cleans temp workspace via exit handler in child process', () => {
    const tmp = makeTmp()
    const subDir = join(tmp, '_duel_integration_')
    const dualConfigPath = join(subDir, 'tsconfig.dual.json')

    mkdirSync(subDir, { recursive: true })
    writeFileSync(dualConfigPath, '{}')

    const utilUrl = new URL('../src/util.js', import.meta.url).href
    const script = `
      import { writeFileSync, mkdirSync } from 'node:fs';
      import { dirname } from 'node:path';

      const subDir = ${JSON.stringify(subDir)};
      const dualConfigPath = ${JSON.stringify(dualConfigPath)};
      const utilUrl = ${JSON.stringify(utilUrl)};
      const { createTempCleanup, registerCleanupHandlers } = await import(utilUrl);

      mkdirSync(dirname(dualConfigPath), { recursive: true });
      writeFileSync(dualConfigPath, '{}');
      const { cleanupTempSync } = createTempCleanup({ subDir, dualConfigPath, keepTemp: false, logWarnFn: () => {} });
      registerCleanupHandlers(cleanupTempSync);
      process.exit(0);
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      stdio: 'inherit',
      cwd: new URL('..', import.meta.url).pathname,
    })

    assert.equal(result.status, 0)
    assert.equal(false, existsSync(subDir))

    rmSync(tmp, { recursive: true, force: true })
  })
})
