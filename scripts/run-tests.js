import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const c8Bin = require.resolve('c8/bin/c8.js')

const parseShardPair = value => {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? '')

  if (!match) return null

  const index = Number.parseInt(match[1], 10)
  const total = Number.parseInt(match[2], 10)

  if (!Number.isInteger(index) || !Number.isInteger(total)) return null
  if (index < 1 || total < 1 || index > total) return null

  return `${index}/${total}`
}

const parseInteger = value => {
  if (value === undefined) return undefined

  const parsed = Number.parseInt(value, 10)

  return Number.isInteger(parsed) ? parsed : undefined
}

const parseCliArgs = args => {
  const passthrough = []
  let shard
  let shardIndex
  let totalShards

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]

    if (arg.startsWith('--shard=')) {
      shard = arg.slice('--shard='.length)
      continue
    }

    if (arg === '--shard') {
      const next = args[i + 1]

      if (!next || next.startsWith('-')) {
        throw new Error('--shard expects a value like 1/2')
      }

      shard = next
      i += 1
      continue
    }

    if (arg.startsWith('--shard-index=')) {
      shardIndex = parseInteger(arg.slice('--shard-index='.length))
      continue
    }

    if (arg === '--shard-index') {
      const next = args[i + 1]

      if (!next || next.startsWith('-')) {
        throw new Error('--shard-index expects a positive integer')
      }

      shardIndex = parseInteger(next)
      i += 1
      continue
    }

    if (arg.startsWith('--total-shards=')) {
      totalShards = parseInteger(arg.slice('--total-shards='.length))
      continue
    }

    if (arg === '--total-shards') {
      const next = args[i + 1]

      if (!next || next.startsWith('-')) {
        throw new Error('--total-shards expects a positive integer')
      }

      totalShards = parseInteger(next)
      i += 1
      continue
    }

    passthrough.push(arg)
  }

  return { passthrough, shard, shardIndex, totalShards }
}

const resolveShard = ({ shard, shardIndex, totalShards }) => {
  const envShard = process.env.DUEL_TEST_SHARD ?? process.env.TEST_SHARD
  const envShardIndex = parseInteger(
    process.env.DUEL_TEST_SHARD_INDEX ?? process.env.TEST_SHARD_INDEX,
  )
  const envTotalShards = parseInteger(
    process.env.DUEL_TEST_TOTAL_SHARDS ?? process.env.TEST_TOTAL_SHARDS,
  )

  const pair = parseShardPair(shard ?? envShard)

  if (pair) return pair

  const index = shardIndex ?? envShardIndex
  const total = totalShards ?? envTotalShards

  if (index === undefined && total === undefined) {
    return null
  }

  if (!Number.isInteger(index) || !Number.isInteger(total)) {
    throw new Error(
      'Invalid shard config. Provide --shard <index>/<total> or both --shard-index and --total-shards.',
    )
  }

  const combined = parseShardPair(`${index}/${total}`)

  if (!combined) {
    throw new Error('Shard values must be positive integers with index <= total.')
  }

  return combined
}

const main = () => {
  const { passthrough, shard, shardIndex, totalShards } = parseCliArgs(
    process.argv.slice(2),
  )
  const resolvedShard = resolveShard({ shard, shardIndex, totalShards })

  const nodeArgs = ['--trace-deprecation', '--test', '--test-reporter=spec']

  if (resolvedShard) {
    nodeArgs.push(`--test-shard=${resolvedShard}`)
  }

  const hasExplicitTarget = passthrough.some(arg => !arg.startsWith('-'))

  if (!hasExplicitTarget) {
    passthrough.push('test/*.js')
  }

  const c8Args = [
    '--reporter=text',
    '--reporter=text-summary',
    '--reporter=lcov',
    'node',
    ...nodeArgs,
    ...passthrough,
  ]

  const child = spawn(process.execPath, [c8Bin, ...c8Args], {
    stdio: 'inherit',
    env: process.env,
  })

  const writeError = message => {
    process.stderr.write(`${message}\n`)
  }

  child.on('error', error => {
    writeError(error instanceof Error ? error.message : `${error}`)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(code ?? 1)
  })
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
}
