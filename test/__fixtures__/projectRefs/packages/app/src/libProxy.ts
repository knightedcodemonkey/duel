import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { basename, dirname, resolve } from 'node:path'
type LibModule = typeof import('../../lib/index.js')

const req = createRequire(import.meta.url)
const from = dirname(fileURLToPath(import.meta.url))
let distRoot = from

while (basename(distRoot) !== 'dist') {
	const parent = dirname(distRoot)
	if (parent === distRoot) break
	distRoot = parent
}

const libPath = resolve(distRoot, 'lib', 'cjs', 'index.cjs')
const { lib } = req(libPath) as LibModule

export { lib }
