import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'Usage:\n  npm start -- [--workspace <path>] [--port <1024-65535>] [--no-open] [--dev]\n',
    )
    return
  }

  const startArgs = args[0] === 'start' ? args.slice(1) : args
  await ensureBuild()
  await run(process.execPath, [
    resolve(projectRoot, 'dist', 'cli.js'),
    'start',
    ...startArgs,
  ])
}

async function ensureBuild() {
  const cliPath = resolve(projectRoot, 'dist', 'cli.js')
  const webIndex = resolve(projectRoot, 'dist', 'web', 'index.html')
  try {
    await access(cliPath)
    await access(webIndex)
  } catch {
    process.stderr.write('fusen-whiteboard: building...\n')
    await run(process.execPath, [resolve(projectRoot, 'scripts', 'build.mjs')])
  }
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
    })
    const forward = (signal) => {
      if (child.exitCode === null) child.kill(signal)
    }
    process.once('SIGINT', forward)
    process.once('SIGTERM', forward)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', forward)
      process.removeListener('SIGTERM', forward)
      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
        resolvePromise()
      } else {
        reject(
          new Error(
            `子プロセスが${signal ?? `終了コード ${code}`}で終了しました。`,
          ),
        )
      }
    })
  })
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : '起動に失敗しました。'}\n`,
  )
  process.exitCode = 1
})
