import { resolve } from 'node:path'

export const DEFAULT_HOST = '127.0.0.1' as const
export const DEFAULT_PORT = 43172

export interface StartOptions {
  workspacePath: string
  requestedPort?: number
  openBrowser: boolean
  devMode: boolean
}

export function parseStartOptions(
  args: string[],
  projectRoot: string,
  cwd = process.cwd(),
): StartOptions {
  const options = parseOptions(
    args,
    new Set(['--workspace', '--port', '--no-open', '--dev']),
  )
  return {
    workspacePath: resolveWorkspace(options.get('--workspace'), projectRoot, cwd),
    ...(options.has('--port')
      ? { requestedPort: parsePort(options.get('--port')) }
      : {}),
    openBrowser: !options.has('--no-open'),
    devMode: options.has('--dev'),
  }
}

function parseOptions(
  args: string[],
  allowed: ReadonlySet<string>,
): Map<string, string | true> {
  const options = new Map<string, string | true>()
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    if (name === undefined || !allowed.has(name)) {
      throw new Error(`未対応のオプションです: ${name ?? ''}`)
    }
    if (options.has(name)) {
      throw new Error(`${name} は1回だけ指定してください。`)
    }
    if (name === '--no-open' || name === '--dev') {
      options.set(name, true)
      continue
    }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${name} の値が必要です。`)
    }
    options.set(name, value)
    index += 1
  }
  return options
}

function resolveWorkspace(
  value: string | true | undefined,
  projectRoot: string,
  cwd: string,
): string {
  if (typeof value !== 'string') {
    return resolve(projectRoot, 'workspace')
  }
  return resolve(cwd, value)
}

function parsePort(value: string | true | undefined): number {
  const port = typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('--port は1024から65535の整数で指定してください。')
  }
  return port
}
