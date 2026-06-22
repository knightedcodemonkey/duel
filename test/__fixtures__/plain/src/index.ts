import { enforce } from './enforce.js'

import type { Plugin } from 'vite' with { 'resolution-mode': 'import' }

export const plugin = (): Plugin => {
  return {
    name: 'plugin',
    enforce,
  }
}
