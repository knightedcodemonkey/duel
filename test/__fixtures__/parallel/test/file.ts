import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { getUser } from '../src/index.js'

describe('getUser', () => {
  it('is a function', () => {
    assert.ok(typeof getUser === 'function')
  })
})
