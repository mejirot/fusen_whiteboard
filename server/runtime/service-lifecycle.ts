import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

import { DEFAULT_HOST, DEFAULT_PORT } from './options.js'

export async function choosePort(
  requestedPort: number | undefined,
): Promise<number> {
  if (requestedPort !== undefined) {
    if (!(await isPortAvailable(requestedPort))) {
      throw new Error(`指定ポート ${requestedPort} は使用中です。`)
    }
    return requestedPort
  }
  for (let port = DEFAULT_PORT; port <= DEFAULT_PORT + 100; port += 1) {
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error('利用可能なlocalhostポートを確保できませんでした。')
}

export function openBrowser(url: string): void {
  const command =
    process.platform === 'win32'
      ? 'explorer.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open'
  const child = spawn(command, [url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('error', (error) => {
    process.stderr.write(
      `ブラウザを自動で開けませんでした: ${error.message}\nURLを手動で開いてください: ${url}\n`,
    )
  })
  child.unref()
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolveAvailable) => {
    const server = createServer()
    server.once('error', () => resolveAvailable(false))
    server.listen(port, DEFAULT_HOST, () => {
      server.close(() => resolveAvailable(true))
    })
  })
}
