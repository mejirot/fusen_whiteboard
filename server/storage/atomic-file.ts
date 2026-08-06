import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const RETRYABLE_RENAME_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])

export async function atomicWriteText(
  filePath: string,
  content: string,
): Promise<void> {
  await atomicWriteBuffer(filePath, Buffer.from(content, 'utf8'))
}

export async function atomicWriteBuffer(
  filePath: string,
  content: Uint8Array,
): Promise<void> {
  const directory = dirname(filePath)
  await mkdir(directory, { recursive: true })
  const temporaryPath = join(
    directory,
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  let handle: Awaited<ReturnType<typeof open>> | undefined

  try {
    handle = await open(temporaryPath, 'wx')
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = undefined
    await renameWithRetry(temporaryPath, filePath)
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export async function atomicWriteJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  await atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export async function movePathAtomically(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  try {
    await renameWithRetry(sourcePath, targetPath)
  } catch (error) {
    // Windows can fail directory rename when a handle is briefly held; fall back.
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : ''
    if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') {
      throw error
    }
    const { cp, rm } = await import('node:fs/promises')
    await cp(sourcePath, targetPath, { recursive: true, force: true })
    await rm(sourcePath, { recursive: true, force: true })
  }
}

async function renameWithRetry(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(sourcePath, targetPath)
      return
    } catch (error) {
      lastError = error
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : ''
      if (!RETRYABLE_RENAME_CODES.has(code) || attempt === 4) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
  throw lastError
}
