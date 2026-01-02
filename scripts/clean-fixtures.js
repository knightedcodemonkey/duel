import { rm } from 'node:fs/promises'

import { glob } from 'glob'

const roots = ['test/__fixtures__']

const run = async () => {
  const targets = new Set()
  const globOpts = { dot: true, windowsPathsNoEscape: true }

  for (const root of roots) {
    const caches = await glob(`${root}/**/.duel-cache`, globOpts)
    const dists = await glob(`${root}/**/dist`, globOpts)

    for (const dir of [...caches, ...dists]) {
      targets.add(dir)
    }
  }

  await Promise.all([...targets].map(dir => rm(dir, { recursive: true, force: true })))
}

run().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
