import { mod } from "./folder/module.js"
import { cjs } from './cjs.cjs'

import type { Mod } from "./folder/module.js"
import type { CJS } from "./cjs.cjs"

interface User {
  name: string;
  id: number;
  mod: Mod;
  esm: any;
  cjs: CJS;
}

class UserAccount {
  name: string;
  id: number;
  mod: Mod;
  esm: any;
  cjs: CJS;

  constructor(name: string, id: number, mod: Mod, esm: any, cjs: CJS) {
    this.name = name;
    this.id = id;
    this.mod = mod;
    this.esm = esm;
    this.cjs = cjs;
  }
}

const getUser = async () => {
  const { esm } = await import('./esm.mjs')

  return new UserAccount("Murphy", 1, mod, esm, cjs)
}

export type { User }

export { getUser }
