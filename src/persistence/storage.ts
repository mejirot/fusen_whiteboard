import {
  DEFAULT_VIEWPORT,
  NOTE_COLORS,
  STORAGE_KEY,
  type BoardDocument,
  type LabeledEdge,
  type NoteColorId,
  type StickyNode,
} from '../types'

const colorIds = new Set<string>(NOTE_COLORS.map((c) => c.id))

function isNoteColor(value: unknown): value is NoteColorId {
  return typeof value === 'string' && colorIds.has(value)
}

export function toDocument(
  nodes: StickyNode[],
  edges: LabeledEdge[],
  viewport: BoardDocument['viewport'],
): BoardDocument {
  return {
    version: 1,
    notes: nodes.map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      text: n.data.text,
      color: n.data.color,
    })),
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

export function fromDocument(doc: BoardDocument): {
  nodes: StickyNode[]
  edges: LabeledEdge[]
  viewport: BoardDocument['viewport']
} {
  return {
    nodes: doc.notes.map((n) => ({
      id: n.id,
      type: 'sticky' as const,
      position: { x: n.x, y: n.y },
      data: {
        text: n.text,
        color: isNoteColor(n.color) ? n.color : 'yellow',
      },
    })),
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
  if (obj.version !== 1) return null
  if (!Array.isArray(obj.notes) || !Array.isArray(obj.edges)) return null

  const notes: BoardDocument['notes'] = []
  for (const item of obj.notes) {
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
      color: isNoteColor(n.color) ? n.color : 'yellow',
    })
  }

  const edges: BoardDocument['edges'] = []
  for (const item of obj.edges) {
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

  let viewport = DEFAULT_VIEWPORT
  if (obj.viewport && typeof obj.viewport === 'object') {
    const v = obj.viewport as Record<string, unknown>
    if (
      typeof v.x === 'number' &&
      typeof v.y === 'number' &&
      typeof v.zoom === 'number'
    ) {
      viewport = { x: v.x, y: v.y, zoom: v.zoom }
    }
  }

  return { version: 1, notes, edges, viewport }
}

export function loadFromLocalStorage(): BoardDocument | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return parseDocument(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function saveToLocalStorage(doc: BoardDocument): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
}

export function downloadJson(doc: BoardDocument, filename = 'fusen-board.json'): void {
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
    version: 1,
    notes: [],
    edges: [],
    viewport: { ...DEFAULT_VIEWPORT },
  }
}

export function createStarterDocument(): BoardDocument {
  return {
    version: 1,
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
