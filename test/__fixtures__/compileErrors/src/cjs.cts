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
