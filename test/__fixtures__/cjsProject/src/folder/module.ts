import MagicString from "magic-string";
import { cjs } from "../cjs.cjs";

import type { CJS } from "../cjs.cjs";

interface Mod {
  prop: string;
  cjs: CJS
}

const mod: Mod = {
  prop: 'foobar',
  cjs: {
    cjs: true,
    magic: new MagicString('module')
  }
}

require.resolve('../esm.mjs')

export { mod, cjs }
export type { Mod }
