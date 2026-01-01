import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const req = createRequire(import.meta.url)
const from = dirname(fileURLToPath(import.meta.url))
const findDistRoot = start => {
  // Walk up until we find the emitted CJS lib; tolerates alternate outDir names and nested dist folders.
  let dir = start

  while (true) {
    const candidate = resolve(dir, 'lib', 'cjs', 'index.cjs')
    if (existsSync(candidate)) return dir

    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Fallback to the default relative dist path used in fixtures.
  return resolve(start, '..', '..', 'dist')
}

const distRoot = findDistRoot(from)

const libPath = resolve(distRoot, 'lib', 'cjs', 'index.cjs')
const { lib } = req(libPath)

export { lib }
