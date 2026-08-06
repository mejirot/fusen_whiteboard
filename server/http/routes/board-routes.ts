import type { FastifyInstance } from 'fastify'

import { validationError } from '../../domain/errors.js'
import {
  assertImageId,
  boardIdSchema,
  createBoardBodySchema,
  expectedRevisionBodySchema,
  putBoardBodySchema,
} from '../../domain/model.js'
import type { BoardWorkspaceStore } from '../../storage/workspace-store.js'

interface BoardParams {
  boardId: string
}

interface AssetParams {
  boardId: string
  imageId: string
}

export function registerBoardRoutes(
  app: FastifyInstance,
  store: BoardWorkspaceStore,
): void {
  app.get('/api/boards', async () => {
    const { boards, invalidDirs } = await store.listBoards()
    return { boards, invalidDirs }
  })

  app.get('/api/trash', async () => {
    const boards = await store.listTrashedBoards()
    return { boards }
  })

  app.post('/api/boards', async (request, reply) => {
    const parsed = createBoardBodySchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      throw validationError('新しいボードの入力が不正です。', {
        issues: parsed.error.issues.map((issue) => issue.message),
      })
    }
    const starter =
      !parsed.data.board &&
      (request.query as { starter?: string } | undefined)?.starter === '1'
    const board = await store.createBoard(parsed.data, { starter })
    return reply.code(201).send({ board })
  })

  app.get<{ Params: BoardParams }>('/api/boards/:boardId', async (request) => {
    assertBoardParam(request.params.boardId)
    return { board: await store.getBoard(request.params.boardId) }
  })

  app.put<{ Params: BoardParams }>('/api/boards/:boardId', async (request) => {
    assertBoardParam(request.params.boardId)
    const parsed = putBoardBodySchema.safeParse(request.body)
    if (!parsed.success) {
      throw validationError('ボード保存の入力が不正です。', {
        issues: parsed.error.issues.map((issue) => issue.message),
      })
    }
    const board = await store.putBoard(
      request.params.boardId,
      parsed.data.expectedRevision,
      parsed.data.board,
    )
    return { board }
  })

  app.delete<{ Params: BoardParams }>(
    '/api/boards/:boardId',
    async (request) => {
      assertBoardParam(request.params.boardId)
      const expectedRevision = readExpectedRevision(request)
      return store.deleteBoard(request.params.boardId, expectedRevision)
    },
  )

  app.post<{ Params: BoardParams }>(
    '/api/trash/:boardId/restore',
    async (request) => {
      assertBoardParam(request.params.boardId)
      const parsed = expectedRevisionBodySchema.safeParse(request.body ?? {})
      if (!parsed.success) {
        throw validationError('復元リクエストが不正です。')
      }
      const board = await store.restoreBoard(
        request.params.boardId,
        parsed.data.expectedRevision,
      )
      return { board }
    },
  )

  app.put<{ Params: AssetParams }>(
    '/api/boards/:boardId/assets/:imageId',
    async (request, reply) => {
      assertBoardParam(request.params.boardId)
      try {
        assertImageId(request.params.imageId)
      } catch {
        throw validationError('画像IDが不正です。')
      }
      const body = request.body
      if (!(body instanceof Buffer) || body.length === 0) {
        throw validationError('画像データが空です。')
      }
      const contentType =
        typeof request.headers['content-type'] === 'string'
          ? request.headers['content-type'].split(';')[0]!.trim()
          : 'application/octet-stream'
      await store.putAsset(
        request.params.boardId,
        request.params.imageId,
        body,
        contentType || 'application/octet-stream',
      )
      return reply.code(204).send()
    },
  )

  app.get<{ Params: AssetParams }>(
    '/api/boards/:boardId/assets/:imageId',
    async (request, reply) => {
      assertBoardParam(request.params.boardId)
      try {
        assertImageId(request.params.imageId)
      } catch {
        throw validationError('画像IDが不正です。')
      }
      const asset = await store.getAsset(
        request.params.boardId,
        request.params.imageId,
      )
      return reply
        .header('Content-Type', asset.contentType)
        .header('Cache-Control', 'private, max-age=3600')
        .send(asset.data)
    },
  )

  app.delete<{ Params: AssetParams }>(
    '/api/boards/:boardId/assets/:imageId',
    async (request, reply) => {
      assertBoardParam(request.params.boardId)
      try {
        assertImageId(request.params.imageId)
      } catch {
        throw validationError('画像IDが不正です。')
      }
      await store.deleteAsset(request.params.boardId, request.params.imageId)
      return reply.code(204).send()
    },
  )
}

function assertBoardParam(boardId: string): void {
  if (!boardIdSchema.safeParse(boardId).success) {
    throw validationError('ボードIDが不正です。')
  }
}

function readExpectedRevision(request: {
  body: unknown
  query: unknown
}): number {
  const fromBody = expectedRevisionBodySchema.safeParse(request.body ?? {})
  if (fromBody.success) return fromBody.data.expectedRevision
  const query = request.query as { expectedRevision?: string } | undefined
  if (query?.expectedRevision !== undefined) {
    const value = Number(query.expectedRevision)
    if (Number.isInteger(value) && value >= 0) return value
  }
  throw validationError('削除リクエストが不正です。')
}
