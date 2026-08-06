import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLocalServer } from './server.js'
import { DEFAULT_HOST, parseStartOptions } from './runtime/options.js'
import { choosePort, openBrowser } from './runtime/service-lifecycle.js'
import {
  loadOrCreateWorkspaceToken,
  removeOwnedWorkspaceRuntime,
  writeWorkspaceRuntime,
} from './runtime/workspace-runtime.js'
import { BoardWorkspaceStore } from './storage/workspace-store.js'

const entryPoint = fileURLToPath(import.meta.url)
const projectRoot = resolve(dirname(entryPoint), '..')

async function main(): Promise<void> {
  const [command = 'start', ...args] = process.argv.slice(2)
  if (command !== 'start') {
    throw new Error(`未対応のコマンドです: ${command}`)
  }
  await start(args)
}

async function start(args: string[]): Promise<void> {
  const options = parseStartOptions(args, projectRoot)
  const store = new BoardWorkspaceStore(options.workspacePath)
  await store.initialize()
  const token = await loadOrCreateWorkspaceToken(store.workspacePath)
  const port = await choosePort(options.requestedPort)
  const serviceUrl = `http://${DEFAULT_HOST}:${port}`
  const staticRoot = resolve(projectRoot, 'dist', 'web')
  const hasStatic = await isDirectory(staticRoot)
  const browserSessionToken = randomBytes(32).toString('base64url')

  const allowedOrigins = options.devMode
    ? [
        'http://127.0.0.1:5173',
        'http://localhost:5173',
        'http://127.0.0.1:5174',
        'http://localhost:5174',
      ]
    : undefined

  const app = createLocalServer({
    store,
    token,
    host: DEFAULT_HOST,
    port,
    browserSessionToken,
    ...(hasStatic ? { staticRoot } : {}),
    ...(allowedOrigins ? { allowedOrigins } : {}),
  })

  let closing: Promise<void> | undefined
  const shutdown = (): Promise<void> => {
    closing ??= (async () => {
      await app.close()
      await removeOwnedWorkspaceRuntime(store.workspacePath, process.pid)
    })()
    return closing
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())

  try {
    await app.listen({ host: DEFAULT_HOST, port })
    await writeWorkspaceRuntime(store.workspacePath, {
      version: 1,
      serviceUrl,
      port,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    })
  } catch (error) {
    await app.close().catch(() => undefined)
    await removeOwnedWorkspaceRuntime(store.workspacePath, process.pid).catch(
      () => undefined,
    )
    throw error
  }

  process.stderr.write(`fusen-whiteboard: ${serviceUrl}\n`)
  process.stderr.write(`workspace: ${store.workspacePath}\n`)
  if (!hasStatic) {
    process.stderr.write(
      'static UI 未ビルド: Vite 開発時は `npm run dev` を併用してください。\n',
    )
  }
  if (options.openBrowser && hasStatic) {
    openBrowser(`${serviceUrl}/`)
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : '起動に失敗しました。'}\n`,
  )
  process.exitCode = 1
})
