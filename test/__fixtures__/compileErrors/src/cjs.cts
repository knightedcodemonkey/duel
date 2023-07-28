/**
 * More TS fun, oh joy.
 * Importing types across module systems requires a `resolution-mode` assertion,
 * which happens to be only part of the 'nightly' build.
 * 
 * @see https://github.com/microsoft/TypeScript/issues/49055
 */
import type { ESM } from './esm.mjs' assert { 'resolution-mode': 'import' };

interface CJS {
  cjs: boolean,
  esm: ESM;
}

const func = async () => {
  const { esm } = await import('./esm.mjs')

  const cjs: CJS = {
    cjs: true,
    esm
  }

  return cjs
}

export { func }

export type { CJS }
