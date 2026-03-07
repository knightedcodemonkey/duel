import { rm, glob } from 'node:fs/promises'

const roots = ['test/__fixtures__']

const run = async () => {
  const targets = new Set()

  const collect = async pattern => {
    const matches = []

    for await (const entry of glob(pattern)) {
      matches.push(entry)
    }

    return matches
  }

  for (const root of roots) {
    const caches = await collect(`${root}/**/.duel-cache`)
    const dists = await collect(`${root}/**/dist`)

    for (const dir of [...caches, ...dists]) {
      targets.add(dir)
    }
  }

  await Promise.all(
    [...targets].map(dir =>
      rm(dir, {
        recursive: true,
        force: true,
        // Windows can hold open handles; allow a few retries before failing.
        maxRetries: 5,
        retryDelay: 50,
      }).catch(err => {
        // eslint-disable-next-line no-console
        console.warn(`Failed to remove ${dir}: ${err?.message ?? err}`)
      }),
    ),
  )
}

run().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
