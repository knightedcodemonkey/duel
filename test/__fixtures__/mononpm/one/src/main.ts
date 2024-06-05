import { say } from 'two'

import { talk } from './file.js'
import { oneOther } from './other.js'

const main = () => {
  talk(`Welcome ${oneOther}`)
  say(`Hello from ${import.meta.url}`)
}

main()
