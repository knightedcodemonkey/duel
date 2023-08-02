import MagicString from "magic-string"

interface CJS {
  cjs: boolean;
  magic: MagicString;
}

const cjs: CJS = {
  cjs: true,
  magic: new MagicString('magic')
}

export { cjs }

export type { CJS }
