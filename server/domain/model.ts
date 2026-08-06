import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export const NOTE_COLOR_IDS = [
  'yellow',
  'peach',
  'mint',
  'sky',
  'lavender',
  'rose',
] as const

const noteSchema = z
  .object({
    id: z.string().min(1).max(128),
    x: z.number().finite(),
    y: z.number().finite(),
    text: z.string().max(100_000),
    color: z.enum(NOTE_COLOR_IDS),
  })
  .strict()

const imageSchema = z
  .object({
    id: z.string().min(1).max(128),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    imageId: z.string().min(1).max(128),
    caption: z.string().max(10_000),
  })
  .strict()

const frameSchema = z
  .object({
    id: z.string().min(1).max(128),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    title: z.string().max(10_000),
  })
  .strict()

const edgeSchema = z
  .object({
    id: z.string().min(1).max(128),
    source: z.string().min(1).max(128),
    target: z.string().min(1).max(128),
    sourceHandle: z.string().max(64).nullable().optional(),
    targetHandle: z.string().max(64).nullable().optional(),
    label: z.string().max(10_000),
  })
  .strict()

const viewportSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().finite().positive(),
  })
  .strict()

export const boardIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

export const storedBoardSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: boardIdSchema,
    title: z.string().min(1).max(200),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    notes: z.array(noteSchema).max(5_000),
    images: z.array(imageSchema).max(2_000),
    frames: z.array(frameSchema).max(2_000),
    edges: z.array(edgeSchema).max(10_000),
    viewport: viewportSchema,
  })
  .strict()

export type StoredBoard = z.infer<typeof storedBoardSchema>

const boardContentSchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    title: z.string().min(1).max(200).optional(),
    notes: z.array(noteSchema).max(5_000).optional(),
    images: z.array(imageSchema).max(2_000).optional(),
    frames: z.array(frameSchema).max(2_000).optional(),
    edges: z.array(edgeSchema).max(10_000).optional(),
    viewport: viewportSchema.optional(),
  })
  .strict()

export const createBoardBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    board: boardContentSchema.optional(),
  })
  .strict()

export type CreateBoardBody = z.infer<typeof createBoardBodySchema>

export const putBoardBodySchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    board: storedBoardSchema.omit({
      id: true,
      revision: true,
      createdAt: true,
      updatedAt: true,
    }),
  })
  .strict()

export const expectedRevisionBodySchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict()

export interface BoardSummary {
  id: string
  title: string
  revision: number
  updatedAt: string
  noteCount: number
  imageCount: number
  frameCount: number
  edgeCount: number
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function createEmptyStoredBoard(title = '無題のボード'): StoredBoard {
  const stamp = nowIso()
  return {
    schemaVersion: 1,
    id: randomUUID(),
    title,
    revision: 0,
    createdAt: stamp,
    updatedAt: stamp,
    notes: [],
    images: [],
    frames: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

export function createStarterStoredBoard(title = 'はじめてのボード'): StoredBoard {
  const stamp = nowIso()
  return {
    schemaVersion: 1,
    id: randomUUID(),
    title,
    revision: 0,
    createdAt: stamp,
    updatedAt: stamp,
    notes: [
      {
        id: 'note-1',
        x: 120,
        y: 140,
        text: 'ダブルクリックで編集',
        color: 'yellow',
      },
      {
        id: 'note-2',
        x: 420,
        y: 220,
        text: 'ハンドルからドラッグして矢印',
        color: 'mint',
      },
    ],
    images: [],
    frames: [],
    edges: [
      {
        id: 'edge-1',
        source: 'note-1',
        target: 'note-2',
        sourceHandle: 'right',
        targetHandle: 'left',
        label: 'つながり',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

export function toBoardSummary(board: StoredBoard): BoardSummary {
  return {
    id: board.id,
    title: board.title,
    revision: board.revision,
    updatedAt: board.updatedAt,
    noteCount: board.notes.length,
    imageCount: board.images.length,
    frameCount: board.frames.length,
    edgeCount: board.edges.length,
  }
}

export function parseStoredBoard(raw: unknown): StoredBoard {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return storedBoardSchema.parse(raw)
  }
  const obj = raw as Record<string, unknown>
  return storedBoardSchema.parse({
    ...obj,
    frames: obj.frames ?? [],
  })
}

const IMAGE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/

export function assertImageId(imageId: string): string {
  if (!IMAGE_ID_RE.test(imageId)) {
    throw new Error('invalid image id')
  }
  return imageId
}
