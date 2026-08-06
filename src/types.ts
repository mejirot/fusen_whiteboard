import type { Edge, Node, Viewport } from '@xyflow/react'

export const NOTE_COLORS = [
  { id: 'yellow', label: '黄', bg: '#FFE566', border: '#E6C200' },
  { id: 'peach', label: '桃', bg: '#FFD4C2', border: '#E8A080' },
  { id: 'mint', label: '緑', bg: '#C8F0D8', border: '#7BC49A' },
  { id: 'sky', label: '青', bg: '#CDE8FF', border: '#7AB3E0' },
  { id: 'lavender', label: '紫', bg: '#E4D4FF', border: '#B49AE0' },
  { id: 'rose', label: '紅', bg: '#FFD0D8', border: '#E090A0' },
] as const

export type NoteColorId = (typeof NOTE_COLORS)[number]['id']

export type StickyNoteData = {
  text: string
  color: NoteColorId
}

export type ImageNodeData = {
  imageId: string
  caption: string
  width: number
  height: number
}

export type FrameNodeData = {
  title: string
  width: number
  height: number
}

export type StickyNode = Node<StickyNoteData, 'sticky'>
export type ImageNode = Node<ImageNodeData, 'image'>
export type FrameNode = Node<FrameNodeData, 'frame'>
export type BoardNode = StickyNode | ImageNode | FrameNode

export type LabeledEdgeData = {
  label: string
}

export type LabeledEdge = Edge<LabeledEdgeData, 'labeled'>

export type BoardDocumentV1 = {
  version: 1
  notes: Array<{
    id: string
    x: number
    y: number
    text: string
    color: NoteColorId
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
    label: string
  }>
  viewport: Viewport
}

export type BoardDocument = {
  version: 3
  notes: Array<{
    id: string
    x: number
    y: number
    text: string
    color: NoteColorId
  }>
  images: Array<{
    id: string
    x: number
    y: number
    width: number
    height: number
    imageId: string
    caption: string
  }>
  frames: Array<{
    id: string
    x: number
    y: number
    width: number
    height: number
    title: string
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
    label: string
  }>
  viewport: Viewport
  /** File export only: imageId → data URL. Omitted from workspace saves. */
  assets?: Record<string, string>
}

/** Workspace-persisted board (server board.json). */
export type StoredBoard = {
  schemaVersion: 1
  id: string
  title: string
  revision: number
  createdAt: string
  updatedAt: string
  notes: BoardDocument['notes']
  images: BoardDocument['images']
  frames: BoardDocument['frames']
  edges: BoardDocument['edges']
  viewport: Viewport
}

export type BoardSummary = {
  id: string
  title: string
  revision: number
  updatedAt: string
  noteCount: number
  imageCount: number
  frameCount: number
  edgeCount: number
}

export type BoardSnapshot = {
  nodes: BoardNode[]
  edges: LabeledEdge[]
}

export const STORAGE_KEY = 'fusen-whiteboard-v1'
export const ACTIVE_BOARD_KEY = 'fusen-active-board-id'

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

export const DEFAULT_IMAGE_MAX = 320
export const MIN_IMAGE_SIZE = 80

export const DEFAULT_FRAME_WIDTH = 420
export const DEFAULT_FRAME_HEIGHT = 280
export const MIN_FRAME_WIDTH = 160
export const MIN_FRAME_HEIGHT = 120
export const DEFAULT_FRAME_TITLE = '枠'
/** Keep frames behind stickies / images. */
export const FRAME_Z_INDEX = -1
export const FRAME_DRAG_HANDLE = '.frame-node__title'

export function isStickyNode(node: BoardNode): node is StickyNode {
  return node.type === 'sticky'
}

export function isImageNode(node: BoardNode): node is ImageNode {
  return node.type === 'image'
}

export function isFrameNode(node: BoardNode): node is FrameNode {
  return node.type === 'frame'
}
