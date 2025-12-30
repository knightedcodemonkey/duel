import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { basename, dirname, resolve } from 'node:path'

const req = createRequire(import.meta.url)
const from = dirname(fileURLToPath(import.meta.url))
let distRoot = from

// Locate the built dual-output dist root so the app consumes the emitted CJS lib, not TS sources.
while (basename(distRoot) !== 'dist') {
  const parent = dirname(distRoot)
  if (parent === distRoot) break
  distRoot = parent
}

const libPath = resolve(distRoot, 'lib', 'cjs', 'index.cjs')
const { lib } = req(libPath)

export { lib }
