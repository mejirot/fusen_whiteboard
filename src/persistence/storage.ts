import {
  DEFAULT_VIEWPORT,
  FRAME_DRAG_HANDLE,
  FRAME_Z_INDEX,
  NOTE_COLORS,
  STORAGE_KEY,
  type BoardDocument,
  type BoardNode,
  type FrameNode,
  type ImageNode,
  type LabeledEdge,
  type NoteColorId,
  type StickyNode,
  type StoredBoard,
  isFrameNode,
  isImageNode,
  isStickyNode,
} from '../types'
import { collectAssets, hydrateAssets } from './imageDb'

const colorIds = new Set<string>(NOTE_COLORS.map((c) => c.id))

function isNoteColor(value: unknown): value is NoteColorId {
  return typeof value === 'string' && colorIds.has(value)
}

function parseNotes(raw: unknown): BoardDocument['notes'] | null {
  if (!Array.isArray(raw)) return null
  const notes: BoardDocument['notes'] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const n = item as Record<string, unknown>
    if (typeof n.id !== 'string') return null
    if (typeof n.x !== 'number' || typeof n.y !== 'number') return null
    if (typeof n.text !== 'string') return null
    notes.push({
      id: n.id,
      x: n.x,
      y: n.y,
      text: n.text,
      detail: typeof n.detail === 'string' ? n.detail : '',
      color: isNoteColor(n.color) ? n.color : 'yellow',
    })
  }
  return notes
}

function parseImages(raw: unknown): BoardDocument['images'] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const images: BoardDocument['images'] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const img = item as Record<string, unknown>
    if (typeof img.id !== 'string') return null
    if (typeof img.x !== 'number' || typeof img.y !== 'number') return null
    if (typeof img.width !== 'number' || typeof img.height !== 'number') {
      return null
    }
    if (typeof img.imageId !== 'string') return null
    if (typeof img.caption !== 'string') return null
    images.push({
      id: img.id,
      x: img.x,
      y: img.y,
      width: img.width,
      height: img.height,
      imageId: img.imageId,
      caption: img.caption,
    })
  }
  return images
}

function parseFrames(raw: unknown): BoardDocument['frames'] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const frames: BoardDocument['frames'] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const frame = item as Record<string, unknown>
    if (typeof frame.id !== 'string') return null
    if (typeof frame.x !== 'number' || typeof frame.y !== 'number') return null
    if (typeof frame.width !== 'number' || typeof frame.height !== 'number') {
      return null
    }
    if (typeof frame.title !== 'string') return null
    frames.push({
      id: frame.id,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      title: frame.title,
    })
  }
  return frames
}

function parseEdges(raw: unknown): BoardDocument['edges'] | null {
  if (!Array.isArray(raw)) return null
  const edges: BoardDocument['edges'] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const e = item as Record<string, unknown>
    if (typeof e.id !== 'string') return null
    if (typeof e.source !== 'string' || typeof e.target !== 'string') return null
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: typeof e.sourceHandle === 'string' ? e.sourceHandle : null,
      targetHandle: typeof e.targetHandle === 'string' ? e.targetHandle : null,
      label: typeof e.label === 'string' ? e.label : '',
    })
  }
  return edges
}

function parseViewport(raw: unknown): BoardDocument['viewport'] {
  if (!raw || typeof raw !== 'object') return DEFAULT_VIEWPORT
  const v = raw as Record<string, unknown>
  if (
    typeof v.x === 'number' &&
    typeof v.y === 'number' &&
    typeof v.zoom === 'number'
  ) {
    return { x: v.x, y: v.y, zoom: v.zoom }
  }
  return DEFAULT_VIEWPORT
}

function parseAssets(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const assets: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.startsWith('data:')) {
      assets[key] = value
    }
  }
  return Object.keys(assets).length > 0 ? assets : undefined
}

export function toDocument(
  nodes: BoardNode[],
  edges: LabeledEdge[],
  viewport: BoardDocument['viewport'],
): BoardDocument {
  const notes = nodes.filter(isStickyNode).map((n: StickyNode) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    text: n.data.text,
    detail: n.data.detail,
    color: n.data.color,
  }))

  const images = nodes.filter(isImageNode).map((n: ImageNode) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    width: n.data.width,
    height: n.data.height,
    imageId: n.data.imageId,
    caption: n.data.caption,
  }))

  const frames = nodes.filter(isFrameNode).map((n: FrameNode) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    width: n.data.width,
    height: n.data.height,
    title: n.data.title,
  }))

  return {
    version: 3,
    notes,
    images,
    frames,
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      label: e.data?.label ?? '',
    })),
    viewport,
  }
}

export function fromDocument(doc: BoardDocument | StoredBoard): {
  nodes: BoardNode[]
  edges: LabeledEdge[]
  viewport: BoardDocument['viewport']
} {
  const stickyNodes: StickyNode[] = doc.notes.map((n) => ({
    id: n.id,
    type: 'sticky' as const,
    position: { x: n.x, y: n.y },
    data: {
      text: n.text,
      detail: n.detail ?? '',
      color: isNoteColor(n.color) ? n.color : 'yellow',
    },
  }))

  const imageNodes: ImageNode[] = doc.images.map((img) => ({
    id: img.id,
    type: 'image' as const,
    position: { x: img.x, y: img.y },
    style: { width: img.width, height: img.height },
    width: img.width,
    height: img.height,
    data: {
      imageId: img.imageId,
      caption: img.caption,
      width: img.width,
      height: img.height,
    },
  }))

  const frameList = 'frames' in doc && Array.isArray(doc.frames) ? doc.frames : []
  const frameNodes: FrameNode[] = frameList.map((frame) => ({
    id: frame.id,
    type: 'frame' as const,
    position: { x: frame.x, y: frame.y },
    style: { width: frame.width, height: frame.height },
    width: frame.width,
    height: frame.height,
    zIndex: FRAME_Z_INDEX,
    connectable: false,
    dragHandle: FRAME_DRAG_HANDLE,
    data: {
      title: frame.title,
      width: frame.width,
      height: frame.height,
    },
  }))

  return {
    nodes: [...frameNodes, ...stickyNodes, ...imageNodes],
    edges: doc.edges.map((e) => ({
      id: e.id,
      type: 'labeled' as const,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      data: { label: e.label ?? '' },
      markerEnd: { type: 'arrowclosed' as const },
    })),
    viewport: doc.viewport ?? DEFAULT_VIEWPORT,
  }
}

export function parseDocument(raw: unknown): BoardDocument | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1 && obj.version !== 2 && obj.version !== 3) return null

  const notes = parseNotes(obj.notes)
  if (!notes) return null

  const images = obj.version === 1 ? [] : parseImages(obj.images)
  if (!images) return null

  const frames =
    obj.version === 1 || obj.version === 2 ? [] : parseFrames(obj.frames)
  if (!frames) return null

  const edges = parseEdges(obj.edges)
  if (!edges) return null

  const viewport = parseViewport(obj.viewport)
  const assets = parseAssets(obj.assets)

  return {
    version: 3,
    notes,
    images,
    frames,
    edges,
    viewport,
    ...(assets ? { assets } : {}),
  }
}

export function loadFromLocalStorage(): BoardDocument | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const doc = parseDocument(JSON.parse(raw) as unknown)
    if (!doc) return null
    const { assets: _assets, ...rest } = doc
    return rest
  } catch {
    return null
  }
}

export function clearLocalStorageDocument(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function boardContentFromDocument(doc: BoardDocument): Pick<
  StoredBoard,
  | 'schemaVersion'
  | 'title'
  | 'notes'
  | 'images'
  | 'frames'
  | 'edges'
  | 'viewport'
> {
  return {
    schemaVersion: 1,
    title: '移行したボード',
    notes: doc.notes,
    images: doc.images,
    frames: doc.frames,
    edges: doc.edges,
    viewport: doc.viewport,
  }
}

export function toStoredBoardPayload(
  title: string,
  nodes: BoardNode[],
  edges: LabeledEdge[],
  viewport: BoardDocument['viewport'],
): Omit<StoredBoard, 'id' | 'revision' | 'createdAt' | 'updatedAt'> {
  const doc = toDocument(nodes, edges, viewport)
  return {
    schemaVersion: 1,
    title,
    notes: doc.notes,
    images: doc.images,
    frames: doc.frames,
    edges: doc.edges,
    viewport: doc.viewport,
  }
}

export async function buildExportDocument(
  nodes: BoardNode[],
  edges: LabeledEdge[],
  viewport: BoardDocument['viewport'],
): Promise<BoardDocument> {
  const doc = toDocument(nodes, edges, viewport)
  const imageIds = doc.images.map((img) => img.imageId)
  const assets = await collectAssets(imageIds)
  return { ...doc, assets }
}

export async function prepareImportedDocument(
  raw: unknown,
): Promise<BoardDocument | null> {
  const doc = parseDocument(raw)
  if (!doc) return null
  await hydrateAssets(doc.assets)
  const { assets: _assets, ...rest } = doc
  return rest
}

export function downloadJson(
  doc: BoardDocument,
  filename = 'fusen-board.json',
): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function createEmptyDocument(): BoardDocument {
  return {
    version: 3,
    notes: [],
    images: [],
    frames: [],
    edges: [],
    viewport: { ...DEFAULT_VIEWPORT },
  }
}

export function createStarterDocument(): BoardDocument {
  return {
    version: 3,
    notes: [
      {
        id: 'note-1',
        x: 120,
        y: 140,
        text: 'ダブルクリックで編集',
        detail: '',
        color: 'yellow',
      },
      {
        id: 'note-2',
        x: 420,
        y: 220,
        text: 'ハンドルからドラッグして矢印',
        detail: '',
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
    viewport: { ...DEFAULT_VIEWPORT },
  }
}
