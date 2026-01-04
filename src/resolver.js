import { readFile, writeFile, rm } from 'node:fs/promises'
import { accessSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import MagicString from 'magic-string'
import { TraceMap, eachMapping, originalPositionFor } from '@jridgewell/trace-mapping'
import {
  GenMapping,
  addMapping,
  setSourceContent,
  toDecodedMap,
} from '@jridgewell/gen-mapping'
import { transform } from '@knighted/module'

const loadMapIfExists = async path => {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const updateSourceMappingUrl = (content, mapFile) => {
  const comment = `//# sourceMappingURL=${mapFile}`
  if (/\/\/# sourceMappingURL=/.test(content)) {
    return content.replace(/\/\/# sourceMappingURL=.*/g, comment)
  }
  return `${content}\n${comment}\n`
}

const composeSourceMaps = (rewriteMap, baseMap) => {
  const outer = new TraceMap(rewriteMap)
  const inner = new TraceMap(baseMap)
  const file = rewriteMap.file ?? baseMap.file
  const gen = new GenMapping({ file })

  eachMapping(outer, mapping => {
    if (mapping.originalLine == null || mapping.originalColumn == null) return

    const traced = originalPositionFor(inner, {
      line: mapping.originalLine,
      column: mapping.originalColumn,
    })

    if (traced.line == null || traced.column == null || traced.source == null) return

    addMapping(gen, {
      generated: { line: mapping.generatedLine, column: mapping.generatedColumn },
      original: { line: traced.line, column: traced.column },
      source: traced.source,
      name: traced.name ?? mapping.name ?? null,
    })
  })

  const sourcesContent = new Map()
  const baseSources = Array.isArray(baseMap.sources) ? baseMap.sources : []
  const baseContents = Array.isArray(baseMap.sourcesContent) ? baseMap.sourcesContent : []

  baseSources.forEach((source, idx) => {
    const content = baseContents[idx]
    if (content != null) {
      sourcesContent.set(source, content)
    }
  })

  for (const [source, content] of sourcesContent.entries()) {
    setSourceContent(gen, source, content)
  }

  const composed = toDecodedMap(gen)
  composed.file = file
  return composed
}

const rewriteSpecifiersAndExtensions = async (filenames, options = {}) => {
  const {
    target,
    ext,
    syntaxMode,
    detectDualPackageHazard,
    dualPackageHazardAllowlist,
    dualPackageHazardScope,
    onDiagnostics,
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
      const code = new MagicString(source)
      let mutated = false

      for (const match of source.matchAll(
        /(?<=['"`])(\.{1,2}(?:\/[\w.-]+)*)\.js(?=['"`])/g,
      )) {
        if (match.index == null) continue
        const start = match.index
        const end = start + match[0].length
        code.overwrite(start, end, `${match[1]}${ext}`)
        mutated = true
      }

      const existingMapPath = `${filename}.map`
      const existingMap = await loadMapIfExists(existingMapPath)

      if (mutated) {
        rewrites.push({ file: filename, kind: 'dts' })
      }

      const outMapPath = `${outFilename}.map`
      const mapFile = basename(outMapPath)
      let output = code.toString()
      let nextMap = null

      /*
       * If an upstream map exists, carry it forward when we rename the file,
       * and compose when the content was mutated. If no upstream map exists,
       * do not emit a new one.
       */
      if (existingMap) {
        if (mutated) {
          const rewriteMap = code.generateMap({
            hires: true,
            includeContent: true,
            file: outFilename,
            source: filename,
          })
          nextMap = composeSourceMaps(rewriteMap, existingMap)
        } else {
          nextMap = { ...existingMap }
        }
      }

      if (nextMap) {
        nextMap.file = basename(outFilename)
        output = updateSourceMappingUrl(output, mapFile)
        await writeFile(outMapPath, JSON.stringify(nextMap))
      }

      await writeFile(outFilename, output)

      if (outFilename !== filename) {
        await rm(filename, { force: true })
        if (existingMap) {
          await rm(existingMapPath, { force: true })
        }
      }

      continue
    }

    const rewriteSpecifier = (value = '') => {
      const collapsed = value.replace(/['"`+)\s]|new String\(/g, '')
      const hasTemplate = value.includes('${')

      // Only consider relative specifiers (POSIX or Windows) and .js endings.
      if (!/^\.{1,2}[\\/]/.test(collapsed) || !/\.js$/.test(collapsed)) {
        return null
      }

      if (rewritePolicy === 'skip') {
        return null
      }

      // Non-greedy to avoid over-consuming on values like "./foo.js.js".
      const next = value.replace(/(.+?)\.js([)"'`]*)?$/, `$1${ext}$2`)

      if (hasTemplate) {
        // Dynamic/template specifiers cannot be validated statically; still rewrite the
        // extension to keep CJS/ESM outputs aligned without emitting noisy warnings.
        return next
      }

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
          const missingTargetMessage = `${collapsed} -> ${base}{${exts.join(',')}}`

          if (rewritePolicy === 'safe') {
            onWarn(`Skipped rewrite for missing target: ${missingTargetMessage}`)
            return null
          }

          if (rewritePolicy === 'warn') {
            onWarn(`Rewriting specifier with missing target: ${missingTargetMessage}`)
          }
        }
      }

      return next
    }

    const writeOptions = {
      target,
      rewriteSpecifier,
      transformSyntax: syntaxMode,
      sourceMap: true,
      diagnostics: diag => onDiagnostics?.(diag, filename),
      ...(detectDualPackageHazard !== undefined ? { detectDualPackageHazard } : {}),
      ...(dualPackageHazardAllowlist !== undefined ? { dualPackageHazardAllowlist } : {}),
      ...(dualPackageHazardScope !== undefined ? { dualPackageHazardScope } : {}),
      ...(outFilename === filename ? { inPlace: true } : { out: outFilename }),
    }

    const result = await transform(filename, writeOptions)
    const nextCode = result?.code ?? result
    const rewriteMap = result?.map ?? null

    const existingMapPath = `${filename}.map`
    const existingMap = await loadMapIfExists(existingMapPath)
    const outMapPath = `${outFilename}.map`

    let output = typeof nextCode === 'string' ? nextCode : String(nextCode)
    let nextMap = null

    /*
     * Compose the rewrite map with the upstream map when present; if the
     * input had no map, we do not emit a new one.
     */
    if (rewriteMap && existingMap) {
      nextMap = composeSourceMaps(rewriteMap, existingMap)
    }

    if (nextMap) {
      const mapFile = basename(outMapPath)
      nextMap.file = basename(outFilename)
      output = updateSourceMappingUrl(output, mapFile)
      await writeFile(outMapPath, JSON.stringify(nextMap))
    }

    await writeFile(outFilename, output)

    if (outFilename !== filename) {
      await rm(filename, { force: true })
      if (existingMap) {
        await rm(existingMapPath, { force: true })
      }
    }

    rewrites.push({ file: filename, kind: 'source' })
    onRewrite(filename, outFilename)
  }

  return { rewrites }
}

export { rewriteSpecifiersAndExtensions }
