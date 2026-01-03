import { dep } from './lib/dep.js'

export const answer = dep
export function greet(name: string) {
  return `hello ${name}`
}
