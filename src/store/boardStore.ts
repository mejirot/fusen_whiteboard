import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Viewport,
  type XYPosition,
} from '@xyflow/react'
import { create } from 'zustand'
import {
  fitImageSize,
  gcUnusedImages,
  putImageBlob,
  readImageSize,
  resolveImageUrl,
} from '../persistence/imageDb'
import {
  buildExportDocument,
  createStarterDocument,
  fromDocument,
  loadFromLocalStorage,
  prepareImportedDocument,
  saveToLocalStorage,
  toDocument,
} from '../persistence/storage'
import {
  DEFAULT_VIEWPORT,
  type BoardDocument,
  type BoardNode,
  type BoardSnapshot,
  type ImageNode,
  type LabeledEdge,
  type NoteColorId,
  type StickyNode,
  isImageNode,
  isStickyNode,
} from '../types'

const MAX_HISTORY = 80
const AUTOSAVE_MS = 400

function cloneSnapshot(nodes: BoardNode[], edges: LabeledEdge[]): BoardSnapshot {
  return {
    nodes: structuredClone(nodes),
    edges: structuredClone(edges),
  }
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

function collectReferencedImageIds(
  nodes: BoardNode[],
  past: BoardSnapshot[],
  future: BoardSnapshot[],
): Set<string> {
  const ids = new Set<string>()
  const addFrom = (list: BoardNode[]) => {
    for (const n of list) {
      if (isImageNode(n)) ids.add(n.data.imageId)
    }
  }
  addFrom(nodes)
  for (const snap of past) addFrom(snap.nodes)
  for (const snap of future) addFrom(snap.nodes)
  return ids
}

function nextPasteCaption(nodes: BoardNode[]): string {
  const used = new Set(
    nodes.filter(isImageNode).map((n) => n.data.caption),
  )
  let i = 1
  while (used.has(`画像 ${i}`)) i += 1
  return `画像 ${i}`
}

function initialBoard() {
  const stored = loadFromLocalStorage()
  const doc = stored ?? createStarterDocument()
  const { nodes, edges, viewport } = fromDocument(doc)
  return { nodes, edges, viewport }
}

type BoardState = {
  nodes: BoardNode[]
  edges: LabeledEdge[]
  viewport: Viewport
  past: BoardSnapshot[]
  future: BoardSnapshot[]
  saveError: string | null
  hydrated: boolean
  boardEpoch: number

  commit: () => void
  undo: () => void
  redo: () => void

  onNodesChange: (changes: NodeChange<BoardNode>[]) => void
  onEdgesChange: (changes: EdgeChange<LabeledEdge>[]) => void
  onConnect: (connection: Connection) => void

  addNote: (position: XYPosition, color?: NoteColorId) => void
  addImageFromBlob: (
    blob: Blob,
    position: XYPosition,
    caption: string,
  ) => Promise<boolean>
  nextPasteCaption: () => string
  updateNoteText: (id: string, text: string, withHistory: boolean) => void
  updateImageCaption: (id: string, caption: string, withHistory: boolean) => void
  updateImageSize: (id: string, width: number, height: number) => void
  setSelectedColor: (color: NoteColorId) => void
  updateEdgeLabel: (id: string, label: string, withHistory: boolean) => void
  deleteSelected: () => void

  setViewport: (viewport: Viewport) => void
  captureBeforeDrag: () => void
  commitAfterDrag: () => void

  exportDocument: () => Promise<BoardDocument>
  importDocument: (raw: unknown) => Promise<boolean>
  clearSaveError: () => void
  scheduleAutosave: () => void
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null
let dragBaseline: BoardSnapshot | null = null

export const useBoardStore = create<BoardState>((set, get) => {
  const boot = initialBoard()

  const scheduleAutosave = () => {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => {
      const { nodes, edges, viewport, past, future } = get()
      try {
        saveToLocalStorage(toDocument(nodes, edges, viewport))
        set({ saveError: null })
        const keep = collectReferencedImageIds(nodes, past, future)
        void gcUnusedImages(keep)
      } catch {
        set({ saveError: '自動保存に失敗しました（容量不足の可能性）' })
      }
    }, AUTOSAVE_MS)
  }

  const syncImageDimensions = (nodes: BoardNode[]): BoardNode[] =>
    nodes.map((n) => {
      if (!isImageNode(n)) return n
      const width = n.width ?? n.data.width
      const height = n.height ?? n.data.height
      if (width === n.data.width && height === n.data.height) {
        return n
      }
      return {
        ...n,
        style: { ...n.style, width, height },
        data: { ...n.data, width, height },
      }
    })

  return {
    nodes: boot.nodes,
    edges: boot.edges,
    viewport: boot.viewport,
    past: [],
    future: [],
    saveError: null,
    hydrated: true,
    boardEpoch: 0,

    scheduleAutosave,

    commit: () => {
      const { nodes, edges, past } = get()
      set({
        past: [...past, cloneSnapshot(nodes, edges)].slice(-MAX_HISTORY),
        future: [],
      })
    },

    undo: () => {
      const { past, nodes, edges, future } = get()
      if (past.length === 0) return
      const previous = past[past.length - 1]!
      set({
        past: past.slice(0, -1),
        future: [cloneSnapshot(nodes, edges), ...future].slice(0, MAX_HISTORY),
        nodes: previous.nodes,
        edges: previous.edges,
      })
      scheduleAutosave()
    },

    redo: () => {
      const { future, nodes, edges, past } = get()
      if (future.length === 0) return
      const next = future[0]!
      set({
        future: future.slice(1),
        past: [...past, cloneSnapshot(nodes, edges)].slice(-MAX_HISTORY),
        nodes: next.nodes,
        edges: next.edges,
      })
      scheduleAutosave()
    },

    onNodesChange: (changes) => {
      const structural = changes.some(
        (c) => c.type === 'remove' || c.type === 'add',
      )
      if (structural) get().commit()
      const next = syncImageDimensions(
        applyNodeChanges(changes, get().nodes),
      )
      set({ nodes: next })
      scheduleAutosave()
    },

    onEdgesChange: (changes) => {
      const structural = changes.some(
        (c) => c.type === 'remove' || c.type === 'add',
      )
      if (structural) get().commit()
      set({ edges: applyEdgeChanges(changes, get().edges) })
      scheduleAutosave()
    },

    onConnect: (connection) => {
      if (!connection.source || !connection.target) return
      if (connection.source === connection.target) return
      get().commit()
      const edge: LabeledEdge = {
        id: uid('edge'),
        type: 'labeled',
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        data: { label: '' },
        markerEnd: { type: 'arrowclosed' },
      }
      set({ edges: [...get().edges, edge] })
      scheduleAutosave()
    },

    addNote: (position, color = 'yellow') => {
      get().commit()
      const node: StickyNode = {
        id: uid('note'),
        type: 'sticky',
        position,
        data: { text: '', color },
      }
      set({ nodes: [...get().nodes, node] })
      scheduleAutosave()
    },

    nextPasteCaption: () => nextPasteCaption(get().nodes),

    addImageFromBlob: async (blob, position, caption) => {
      try {
        const size = await readImageSize(blob)
        const fitted = fitImageSize(size.width, size.height)
        const imageId = uid('img')
        await putImageBlob(imageId, blob)
        await resolveImageUrl(imageId)

        get().commit()
        const node: ImageNode = {
          id: uid('image'),
          type: 'image',
          position,
          style: { width: fitted.width, height: fitted.height },
          width: fitted.width,
          height: fitted.height,
          data: {
            imageId,
            caption,
            width: fitted.width,
            height: fitted.height,
          },
        }
        set({ nodes: [...get().nodes, node] })
        scheduleAutosave()
        return true
      } catch {
        set({ saveError: '画像の追加に失敗しました' })
        return false
      }
    },

    updateNoteText: (id, text, withHistory) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isStickyNode(node) || node.data.text === text) return
      if (withHistory) get().commit()
      set({
        nodes: get().nodes.map((n) =>
          n.id === id && isStickyNode(n)
            ? { ...n, data: { ...n.data, text } }
            : n,
        ),
      })
      scheduleAutosave()
    },

    updateImageCaption: (id, caption, withHistory) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isImageNode(node) || node.data.caption === caption) return
      if (withHistory) get().commit()
      set({
        nodes: get().nodes.map((n) =>
          n.id === id && isImageNode(n)
            ? { ...n, data: { ...n.data, caption } }
            : n,
        ),
      })
      scheduleAutosave()
    },

    updateImageSize: (id, width, height) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isImageNode(node)) return
      if (node.data.width === width && node.data.height === height) return
      set({
        nodes: get().nodes.map((n) =>
          n.id === id && isImageNode(n)
            ? {
                ...n,
                width,
                height,
                style: { ...n.style, width, height },
                data: { ...n.data, width, height },
              }
            : n,
        ),
      })
      scheduleAutosave()
    },

    setSelectedColor: (color) => {
      const selected = get().nodes.filter(
        (n) => n.selected && isStickyNode(n),
      ) as StickyNode[]
      if (selected.length === 0) return
      if (selected.every((n) => n.data.color === color)) return
      get().commit()
      set({
        nodes: get().nodes.map((n) =>
          n.selected && isStickyNode(n)
            ? { ...n, data: { ...n.data, color } }
            : n,
        ),
      })
      scheduleAutosave()
    },

    updateEdgeLabel: (id, label, withHistory) => {
      const edge = get().edges.find((e) => e.id === id)
      if (!edge || (edge.data?.label ?? '') === label) return
      if (withHistory) get().commit()
      set({
        edges: get().edges.map((e) =>
          e.id === id ? { ...e, data: { ...e.data, label } } : e,
        ),
      })
      scheduleAutosave()
    },

    deleteSelected: () => {
      const { nodes, edges } = get()
      const selectedNodeIds = new Set(
        nodes.filter((n) => n.selected).map((n) => n.id),
      )
      const selectedEdgeIds = new Set(
        edges.filter((e) => e.selected).map((e) => e.id),
      )
      if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return
      get().commit()
      set({
        nodes: nodes.filter((n) => !selectedNodeIds.has(n.id)),
        edges: edges.filter(
          (e) =>
            !selectedEdgeIds.has(e.id) &&
            !selectedNodeIds.has(e.source) &&
            !selectedNodeIds.has(e.target),
        ),
      })
      scheduleAutosave()
    },

    setViewport: (viewport) => {
      set({ viewport })
      scheduleAutosave()
    },

    captureBeforeDrag: () => {
      const { nodes, edges } = get()
      dragBaseline = cloneSnapshot(nodes, edges)
    },

    commitAfterDrag: () => {
      if (!dragBaseline) return
      const { nodes, past } = get()
      const beforeById = new Map(dragBaseline.nodes.map((n) => [n.id, n]))
      const changed =
        nodes.length !== dragBaseline.nodes.length ||
        nodes.some((n) => {
          const before = beforeById.get(n.id)
          if (!before) return true
          if (
            before.position.x !== n.position.x ||
            before.position.y !== n.position.y
          ) {
            return true
          }
          const beforeW = before.width ?? (isImageNode(before) ? before.data.width : 0)
          const beforeH = before.height ?? (isImageNode(before) ? before.data.height : 0)
          const afterW = n.width ?? (isImageNode(n) ? n.data.width : 0)
          const afterH = n.height ?? (isImageNode(n) ? n.data.height : 0)
          return beforeW !== afterW || beforeH !== afterH
        })
      if (changed) {
        set({
          past: [...past, dragBaseline].slice(-MAX_HISTORY),
          future: [],
        })
        scheduleAutosave()
      }
      dragBaseline = null
    },

    exportDocument: async () => {
      const { nodes, edges, viewport } = get()
      return buildExportDocument(nodes, edges, viewport)
    },

    importDocument: async (raw) => {
      const doc = await prepareImportedDocument(raw)
      if (!doc) return false
      get().commit()
      const { nodes, edges, viewport } = fromDocument(doc)
      set({
        nodes,
        edges,
        viewport: viewport ?? DEFAULT_VIEWPORT,
        boardEpoch: get().boardEpoch + 1,
      })
      scheduleAutosave()
      return true
    },

    clearSaveError: () => set({ saveError: null }),
  }
})
