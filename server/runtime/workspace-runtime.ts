import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import { atomicWriteJson } from '../storage/atomic-file.js'

const MIN_TOKEN_LENGTH = 32

const configSchema = z
  .object({ version: z.literal(1), token: z.string().min(MIN_TOKEN_LENGTH) })
  .strict()

const runtimeSchema = z
  .object({
    version: z.literal(1),
    serviceUrl: z.string().url(),
    port: z.number().int().min(1024).max(65535),
    pid: z.number().int().positive(),
    startedAt: z.string().datetime(),
  })
  .strict()

export interface WorkspaceRuntime {
  version: 1
  serviceUrl: string
  port: number
  pid: number
  startedAt: string
}

export function workspacePaths(workspacePath: string): {
  internal: string
  config: string
  runtime: string
  trash: string
} {
  const internal = join(workspacePath, '.fusen')
  return {
    internal,
    config: join(internal, 'config.json'),
    runtime: join(internal, 'runtime.json'),
    trash: join(internal, 'trash'),
  }
}

export async function loadOrCreateWorkspaceToken(
  workspacePath: string,
): Promise<string> {
  const paths = workspacePaths(workspacePath)
  await mkdir(paths.internal, { recursive: true })
  try {
    const config = configSchema.parse(
      JSON.parse(await readFile(paths.config, 'utf8')) as unknown,
    )
    return assertToken(config.token)
  } catch (error) {
    if (!isMissingFile(error)) {
      throw new Error(
        'ワークスペース設定を読み込めません。config.jsonを確認してください。',
        { cause: error },
      )
    }
  }
  const token = randomBytes(32).toString('base64url')
  await atomicWriteJson(paths.config, { version: 1, token })
  return token
}

export async function writeWorkspaceRuntime(
  workspacePath: string,
  runtime: WorkspaceRuntime,
): Promise<void> {
  const paths = workspacePaths(workspacePath)
  await mkdir(paths.internal, { recursive: true })
  await atomicWriteJson(paths.runtime, runtimeSchema.parse(runtime))
}

export async function removeOwnedWorkspaceRuntime(
  workspacePath: string,
  pid: number,
): Promise<void> {
  const path = workspacePaths(workspacePath).runtime
  try {
    const current = runtimeSchema.parse(
      JSON.parse(await readFile(path, 'utf8')) as unknown,
    )
    if (current.pid === pid) {
      await rm(path, { force: true })
    }
  } catch (error) {
    if (
      !isMissingFile(error) &&
      !(error instanceof z.ZodError) &&
      !(error instanceof SyntaxError)
    ) {
      throw error
    }
  }
}

function assertToken(value: string): string {
  if (
    value.length < MIN_TOKEN_LENGTH ||
    value.length > 4096 ||
    /[\r\n]/.test(value)
  ) {
    throw new Error(
      'Bearer token must be 32-4096 characters without line breaks.',
    )
  }
  return value
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
