import { pathToFileURL } from 'node:url'
import { realpath } from 'node:fs/promises'

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

export { log, logError, getRealPathAsFileUrl }
