import { readFile, writeFile, rm } from 'node:fs/promises'
import { accessSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { transform } from '@knighted/module'

/**
 * Rewrites specifiers and file extensions for dual builds.
 * Currently mirrors existing behavior and provides hooks for future validation.
 */
const rewriteSpecifiersAndExtensions = async (filenames, options = {}) => {
  const {
    target,
    ext,
    syntaxMode,
    rewritePolicy = 'safe',
    validateSpecifiers = false,
    onRewrite = () => {},
    onWarn = () => {},
  } = options

  const rewrites = []

  for (const filename of filenames) {
    const dts = /(\.d\.ts)$/
    const isDts = dts.test(filename)
    const outFilename = isDts
      ? filename.replace(dts, target === 'commonjs' ? '.d.cts' : '.d.mts')
      : filename.replace(/\.js$/, ext)

    if (isDts) {
      const source = await readFile(filename, 'utf8')
      const rewritten = source.replace(
        /(?<=["'])(\.\.?(?:\/[\w.-]+)*)\.js(?=["'])/g,
        `$1${ext}`,
      )

      if (rewritten !== source) {
        rewrites.push({ file: filename, kind: 'dts' })
      }

      await writeFile(outFilename, rewritten)

      if (outFilename !== filename) {
        await rm(filename, { force: true })
      }

      continue
    }

    const rewriteSpecifier = (value = '') => {
      const collapsed = value.replace(/['"`+)\s]|new String\(/g, '')

      // Only consider relative specifiers and .js endings.
      if (!/^(?:\.|\.\.)\//.test(collapsed) || !/\.js$/.test(collapsed)) {
        return null
      }

      if (rewritePolicy === 'skip') {
        return null
      }

      const next = value.replace(/(.+)\.js([)"'`]*)?$/, `$1${ext}$2`)

      if (validateSpecifiers) {
        const fileDir = dirname(filename)
        const base = collapsed.replace(/\.js$/, '')
        const candidates = []
        const exts = [ext, '.js', '.mjs', '.cjs']

        for (const variant of exts) {
          candidates.push(resolve(fileDir, `${base}${variant}`))
          candidates.push(resolve(fileDir, `${base}/index${variant}`))
        }

        const exists = candidates.some(path => {
          try {
            accessSync(path)
            return true
          } catch {
            return false
          }
        })

        if (!exists) {
          const target = `${collapsed} -> ${base}{${exts.join(',')}}`

          if (rewritePolicy === 'safe') {
            onWarn(`Skipped rewrite for missing target: ${target}`)
            return null
          }

          if (rewritePolicy === 'warn') {
            onWarn(`Rewriting specifier with missing target: ${target}`)
          }
        }
      }

      return next
    }

    const writeOptions = {
      target,
      rewriteSpecifier,
      transformSyntax: syntaxMode,
      ...(outFilename === filename ? { inPlace: true } : { out: outFilename }),
    }

    await transform(filename, writeOptions)

    if (outFilename !== filename) {
      await rm(filename, { force: true })
    }

    rewrites.push({ file: filename, kind: 'source' })
    onRewrite(filename, outFilename)
  }

  return { rewrites }
}

export { rewriteSpecifiersAndExtensions }
