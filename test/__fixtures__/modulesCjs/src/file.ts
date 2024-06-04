import { argv, stdout } from 'node:process'
import { pathToFileURL } from 'node:url'
import { realpath } from 'node:fs/promises'

const detectCalledFromCli = async (path: string) => {
  const realPath = await realpath(path)

  if (__filename === pathToFileURL(realPath).href) {
    stdout.write('invoked as cli')
  }
}

detectCalledFromCli(argv[1])

require.resolve(`${__dirname}/other.js`)
