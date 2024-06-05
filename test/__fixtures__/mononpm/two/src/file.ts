export function say(msg: string): string {
  return `${import.meta.url} ${msg}`
}
