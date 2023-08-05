import { enforce } from './enforce.js'

import type { Plugin } from 'vite' assert { 'resolution-mode': 'import' }

export const plugin = (): Plugin => {
  return {
    name: 'plugin',
    enforce
  }
}
