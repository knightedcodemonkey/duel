import { pathToFileURL } from 'node:url'
import { realpath } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { cwd, platform } from 'node:process'
import { EOL } from 'node:os'

const COLORS = {
  reset: '\x1b[0m',
  info: '\x1b[36m',
  success: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
}

const log = (msg = '', level = 'info', opts = {}) => {
  const { bare = false } = opts
  const palette = {
    info: COLORS.info,
    success: COLORS.success,
    warn: COLORS.warn,
    error: COLORS.error,
  }
  const badge = {
    success: '[✓]',
    warn: '[!]',
    error: '[x]',
    info: '[i]',
  }[level]
  const color = palette[level] ?? COLORS.info
  const prefix = !bare && badge ? `${badge} ` : ''

  // eslint-disable-next-line no-console
  console.log(`${color}${prefix}%s${COLORS.reset}`, msg)
}

const logSuccess = msg => log(msg, 'success')
const logWarn = msg => log(msg, 'warn')
const logError = msg => log(msg, 'error')
const getRealPathAsFileUrl = async path => {
  const realPath = await realpath(path)
  const asFileUrl = pathToFileURL(realPath).href

  return asFileUrl
}
const getCompileFiles = (tscBinPath, wd = cwd()) => {
  const { stdout } = spawnSync(tscBinPath, ['--listFilesOnly'], {
    cwd: wd,
    shell: platform === 'win32',
  })

  // Exclude node_modules and empty strings.
  return stdout
    .toString()
    .split(EOL)
    .filter(path => !/node_modules|^$/.test(path))
}

export { log, logError, logSuccess, logWarn, getRealPathAsFileUrl, getCompileFiles }
