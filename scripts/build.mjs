import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')

await run('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.json'])
await run('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.server.json'])
await run('node_modules/vite/bin/vite.js', ['build'])

function run(relativePath, args = []) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(projectRoot, relativePath), ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
      } else {
        reject(
          new Error(
            `${relativePath} が${signal ?? `終了コード ${code}`}で失敗しました。`,
          ),
        )
      }
    })
  })
}
