import { mod } from "./folder/module.js";
import { esm } from './esm.mjs'
import { cjs } from './cjs.cjs'

import type { Mod } from "./folder/module.js";
import type { ESM } from './esm.mjs'
import type { CJS } from "./cjs.cjs";

interface User {
  name: string;
  id: number;
  mod: Mod;
  esm: ESM;
  cjs: CJS;
}

class UserAccount {
  name: string;
  id: number;
  mod: Mod;
  esm: ESM;
  cjs: CJS;

  constructor(name: string, id: number, mod: Mod, esm: ESM, cjs: CJS) {
    this.name = name;
    this.id = id;
    this.mod = mod;
    this.esm = esm;
    this.cjs = cjs;
  }
}

const user: User = new UserAccount("Murphy", 1, mod, esm, cjs);

export type { User }

export { user }
