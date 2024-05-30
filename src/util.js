import { pathToFileURL } from 'node:url'
import { realpath } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { cwd } from 'node:process'

const log = (color = '\x1b[30m', msg = '') => {
  // eslint-disable-next-line no-console
  console.log(`${color}%s\x1b[0m`, msg)
}
const logError = log.bind(null, '\x1b[31m')
const getRealPathAsFileUrl = async path => {
  const realPath = await realpath(path)
  const asFileUrl = pathToFileURL(realPath).href

  return asFileUrl
}
const getCompileFiles = (tscBinPath, wd = cwd()) => {
  const { stdout } = spawnSync(tscBinPath, ['--listFilesOnly'], { cwd: wd })

  // Exclude node_modules and empty strings.
  return stdout
    .toString()
    .split('\n')
    .filter(path => !/node_modules|^$/.test(path))
}

export { log, logError, getRealPathAsFileUrl, getCompileFiles }
