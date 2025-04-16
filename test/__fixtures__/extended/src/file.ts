import assert from 'node:assert'
import { moduleType } from 'node-module-type'
import { other } from './other.js'

const importOther = () => {
  import(`./${other}.js`).then(module => {
    /**
     * Conversion to CommonJS wraps the default export in a `default` property.
     * This is a workaround to make the test work in both ESM and CommonJS.
     * Another example of how default exports are an anti pattern.
     */
    assert.deepStrictEqual(
      module.default,
      moduleType() === 'module' ? 'stuff' : { default: 'stuff' },
    )
  })
}

importOther()
