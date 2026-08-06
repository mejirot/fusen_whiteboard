import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  conflictError,
  notFoundError,
  validationError,
} from '../domain/errors.js'
import {
  assertImageId,
  boardIdSchema,
  createEmptyStoredBoard,
  createStarterStoredBoard,
  nowIso,
  parseStoredBoard,
  toBoardSummary,
  type BoardSummary,
  type CreateBoardBody,
  type StoredBoard,
} from '../domain/model.js'
import { workspacePaths } from '../runtime/workspace-runtime.js'
import {
  atomicWriteBuffer,
  atomicWriteJson,
  movePathAtomically,
} from './atomic-file.js'

export class BoardWorkspaceStore {
  private readonly locks = new Map<string, Promise<void>>()
  private initialized = false
  public readonly workspacePath: string

  public constructor(workspacePath: string) {
    this.workspacePath = resolve(workspacePath)
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return
    await mkdir(this.workspacePath, { recursive: true })
    const paths = workspacePaths(this.workspacePath)
    await Promise.all([
      mkdir(paths.internal, { recursive: true }),
      mkdir(paths.trash, { recursive: true }),
    ])
    this.initialized = true
  }

  public async listBoards(): Promise<{
    boards: BoardSummary[]
    invalidDirs: string[]
  }> {
    await this.initialize()
    const entries = await readdir(this.workspacePath, { withFileTypes: true })
    const boards: BoardSummary[] = []
    const invalidDirs: string[] = []

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const idParse = boardIdSchema.safeParse(entry.name)
      if (!idParse.success) {
        invalidDirs.push(entry.name)
        continue
      }
      try {
        const board = await this.readBoardFile(this.boardJsonPath(entry.name))
        if (board.id !== entry.name) {
          throw validationError('ボードのディレクトリ名とIDが一致しません。')
        }
        boards.push(toBoardSummary(board))
      } catch {
        invalidDirs.push(entry.name)
      }
    }

    boards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { boards, invalidDirs }
  }

  public async listTrashedBoards(): Promise<BoardSummary[]> {
    await this.initialize()
    const trashRoot = workspacePaths(this.workspacePath).trash
    const entries = await readdir(trashRoot, { withFileTypes: true })
    const boards: BoardSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const board = await this.readBoardFile(
          join(trashRoot, entry.name, 'board.json'),
        )
        boards.push(toBoardSummary(board))
      } catch {
        // skip invalid trash entries
      }
    }
    return boards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  public async createBoard(
    input: CreateBoardBody,
    options?: { starter?: boolean },
  ): Promise<StoredBoard> {
    await this.initialize()
    let board: StoredBoard
    if (input.board) {
      const stamp = nowIso()
      board = parseStoredBoard({
        schemaVersion: 1,
        id: randomUUID(),
        title: input.title ?? input.board.title ?? '無題のボード',
        revision: 0,
        createdAt: stamp,
        updatedAt: stamp,
        notes: input.board.notes ?? [],
        images: input.board.images ?? [],
        edges: input.board.edges ?? [],
        viewport: input.board.viewport ?? { x: 0, y: 0, zoom: 1 },
      })
    } else if (options?.starter) {
      board = createStarterStoredBoard(input.title ?? 'はじめてのボード')
    } else {
      board = createEmptyStoredBoard(input.title ?? '無題のボード')
      if (input.title) board = { ...board, title: input.title }
    }

    await this.withLock(board.id, async () => {
      const dir = this.boardDir(board.id)
      await mkdir(join(dir, 'assets'), { recursive: true })
      await atomicWriteJson(this.boardJsonPath(board.id), board)
    })
    return board
  }

  public async getBoard(boardId: string): Promise<StoredBoard> {
    await this.initialize()
    const id = this.assertBoardId(boardId)
    return this.withLock(id, async () => this.readActiveBoard(id))
  }

  public async putBoard(
    boardId: string,
    expectedRevision: number,
    next: Omit<
      StoredBoard,
      'id' | 'revision' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<StoredBoard> {
    await this.initialize()
    const id = this.assertBoardId(boardId)
    return this.withLock(id, async () => {
      const current = await this.readActiveBoard(id)
      if (current.revision !== expectedRevision) {
        throw conflictError(
          'ボードのrevisionが一致しません。再読み込みしてください。',
          current.revision,
        )
      }
      const updated = parseStoredBoard({
        ...next,
        schemaVersion: 1,
        id: current.id,
        revision: current.revision + 1,
        createdAt: current.createdAt,
        updatedAt: nowIso(),
      })
      await atomicWriteJson(this.boardJsonPath(id), updated)
      return updated
    })
  }

  public async deleteBoard(
    boardId: string,
    expectedRevision: number,
  ): Promise<{ id: string; revision: number; deleted: true }> {
    await this.initialize()
    const id = this.assertBoardId(boardId)
    return this.withLock(id, async () => {
      const current = await this.readActiveBoard(id)
      if (current.revision !== expectedRevision) {
        throw conflictError(
          'ボードのrevisionが一致しません。再読み込みしてください。',
          current.revision,
        )
      }
      const trashDir = join(workspacePaths(this.workspacePath).trash, id)
      await rm(trashDir, { recursive: true, force: true })
      await movePathAtomically(this.boardDir(id), trashDir)
      return { id, revision: current.revision, deleted: true as const }
    })
  }

  public async restoreBoard(
    boardId: string,
    expectedRevision: number,
  ): Promise<StoredBoard> {
    await this.initialize()
    const id = this.assertBoardId(boardId)
    return this.withLock(id, async () => {
      const trashDir = join(workspacePaths(this.workspacePath).trash, id)
      const board = await this.readBoardFile(join(trashDir, 'board.json'))
      if (board.revision !== expectedRevision) {
        throw conflictError(
          'ボードのrevisionが一致しません。再読み込みしてください。',
          board.revision,
        )
      }
      if (await this.exists(this.boardDir(id))) {
        throw conflictError(
          '同じIDのボードが既に存在します。',
          board.revision,
        )
      }
      await movePathAtomically(trashDir, this.boardDir(id))
      return board
    })
  }

  public async putAsset(
    boardId: string,
    imageId: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.initialize()
    const id = this.assertBoardId(boardId)
    const assetId = assertImageId(imageId)
    await this.withLock(id, async () => {
      await this.readActiveBoard(id)
      const path = this.assetPath(id, assetId)
      await atomicWriteBuffer(path, data)
      const metaPath = `${path}.meta.json`
      await atomicWriteJson(metaPath, { contentType })
    })
  }

  public async getAsset(
    boardId: string,
    imageId: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    await this.initialize()
    const id = this.assertBoardId(boardId)
    const assetId = assertImageId(imageId)
    return this.withLock(id, async () => {
      await this.readActiveBoard(id)
      const path = this.assetPath(id, assetId)
      try {
        const data = await readFile(path)
        let contentType = 'application/octet-stream'
        try {
          const meta = JSON.parse(
            await readFile(`${path}.meta.json`, 'utf8'),
          ) as { contentType?: string }
          if (typeof meta.contentType === 'string') {
            contentType = meta.contentType
          }
        } catch {
          // ignore missing meta
        }
        return { data, contentType }
      } catch (error) {
        if (isMissingFile(error)) {
          throw notFoundError('画像アセットが見つかりません。')
        }
        throw error
      }
    })
  }

  public async deleteAsset(boardId: string, imageId: string): Promise<void> {
    await this.initialize()
    const id = this.assertBoardId(boardId)
    const assetId = assertImageId(imageId)
    await this.withLock(id, async () => {
      await this.readActiveBoard(id)
      const path = this.assetPath(id, assetId)
      await rm(path, { force: true })
      await rm(`${path}.meta.json`, { force: true })
    })
  }

  private boardDir(boardId: string): string {
    return join(this.workspacePath, boardId)
  }

  private boardJsonPath(boardId: string): string {
    return join(this.boardDir(boardId), 'board.json')
  }

  private assetPath(boardId: string, imageId: string): string {
    return join(this.boardDir(boardId), 'assets', imageId)
  }

  private assertBoardId(boardId: string): string {
    const parsed = boardIdSchema.safeParse(boardId)
    if (!parsed.success) {
      throw validationError('ボードIDが不正です。')
    }
    return parsed.data
  }

  private async readActiveBoard(boardId: string): Promise<StoredBoard> {
    try {
      return await this.readBoardFile(this.boardJsonPath(boardId))
    } catch (error) {
      if (isMissingFile(error)) {
        throw notFoundError('ボードが見つかりません。')
      }
      throw error
    }
  }

  private async readBoardFile(filePath: string): Promise<StoredBoard> {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    return parseStoredBoard(raw)
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }

  private async withLock<T>(
    key: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    this.locks.set(
      key,
      previous.then(
        () => gate,
        () => gate,
      ),
    )
    await previous.catch(() => undefined)
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(key) === gate) {
        this.locks.delete(key)
      }
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
