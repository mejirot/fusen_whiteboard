import type { BoardSummary, StoredBoard } from '../types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body !== undefined &&
      !(init.body instanceof Blob) &&
      !(init.body instanceof ArrayBuffer) &&
      !(init.body instanceof Uint8Array)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  })
  return response
}

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as unknown
  if (!response.ok) {
    const err = data as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> }
    }
    throw new ApiError(
      response.status,
      err.error?.code ?? 'IO',
      err.error?.message ?? `リクエストに失敗しました (${response.status})`,
      err.error?.details,
    )
  }
  return data as T
}

export async function ensureSession(): Promise<void> {
  const response = await apiFetch('/api/session')
  if (!response.ok) {
    throw new ApiError(
      response.status,
      'UNAUTHORIZED',
      'ローカルサービスに接続できません。`npm run dev:service` または `npm start` を実行してください。',
    )
  }
}

export async function listBoards(): Promise<BoardSummary[]> {
  const data = await parseJson<{ boards: BoardSummary[] }>(
    await apiFetch('/api/boards'),
  )
  return data.boards
}

export async function listTrash(): Promise<BoardSummary[]> {
  const data = await parseJson<{ boards: BoardSummary[] }>(
    await apiFetch('/api/trash'),
  )
  return data.boards
}

export async function getBoard(boardId: string): Promise<StoredBoard> {
  const data = await parseJson<{ board: StoredBoard }>(
    await apiFetch(`/api/boards/${boardId}`),
  )
  return data.board
}

export async function createBoard(input?: {
  title?: string
  starter?: boolean
  board?: Partial<
    Pick<StoredBoard, 'notes' | 'images' | 'edges' | 'viewport' | 'title'>
  >
}): Promise<StoredBoard> {
  const qs = input?.starter ? '?starter=1' : ''
  const body: Record<string, unknown> = {}
  if (input?.title) body.title = input.title
  if (input?.board) body.board = { schemaVersion: 1, ...input.board }
  const data = await parseJson<{ board: StoredBoard }>(
    await apiFetch(`/api/boards${qs}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )
  return data.board
}

export async function putBoard(
  boardId: string,
  expectedRevision: number,
  board: Omit<
    StoredBoard,
    'id' | 'revision' | 'createdAt' | 'updatedAt'
  >,
): Promise<StoredBoard> {
  const data = await parseJson<{ board: StoredBoard }>(
    await apiFetch(`/api/boards/${boardId}`, {
      method: 'PUT',
      body: JSON.stringify({ expectedRevision, board }),
    }),
  )
  return data.board
}

export async function deleteBoard(
  boardId: string,
  expectedRevision: number,
): Promise<void> {
  await parseJson(
    await apiFetch(
      `/api/boards/${boardId}?expectedRevision=${expectedRevision}`,
      { method: 'DELETE' },
    ),
  )
}

export async function restoreBoard(
  boardId: string,
  expectedRevision: number,
): Promise<StoredBoard> {
  const data = await parseJson<{ board: StoredBoard }>(
    await apiFetch(`/api/trash/${boardId}/restore`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision }),
    }),
  )
  return data.board
}

export async function putAsset(
  boardId: string,
  imageId: string,
  blob: Blob,
): Promise<void> {
  const response = await apiFetch(
    `/api/boards/${boardId}/assets/${encodeURIComponent(imageId)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': blob.type || 'application/octet-stream',
      },
      body: blob,
    },
  )
  if (!response.ok) {
    throw new ApiError(
      response.status,
      'IO',
      '画像の保存に失敗しました。',
    )
  }
}

export async function deleteAsset(
  boardId: string,
  imageId: string,
): Promise<void> {
  const response = await apiFetch(
    `/api/boards/${boardId}/assets/${encodeURIComponent(imageId)}`,
    { method: 'DELETE' },
  )
  if (!response.ok && response.status !== 404) {
    throw new ApiError(response.status, 'IO', '画像の削除に失敗しました。')
  }
}

export function assetUrl(boardId: string, imageId: string): string {
  return `/api/boards/${boardId}/assets/${encodeURIComponent(imageId)}`
}
