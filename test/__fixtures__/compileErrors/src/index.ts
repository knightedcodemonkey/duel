import { esm } from './esm.mjs'
import { func } from './cjs.cjs'

import type { ESM } from './esm.mjs'
import type { CJS } from "./cjs.cjs";

interface User {
  name: string;
  id: number;
  esm: ESM;
  cjs: CJS;
}

class UserAccount {
  name: string;
  id: number;
  esm: ESM;
  cjs: CJS;

  constructor(name: string, id: number, esm: ESM, cjs: CJS) {
    this.name = name;
    this.id = id;
    this.esm = esm;
    this.cjs = cjs;
  }
}

const cjs = await func()
const user: User = new UserAccount("Murphy", 1, esm, cjs);

export type { User }

export { user }
