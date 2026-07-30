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
  createStarterDocument,
  fromDocument,
  loadFromLocalStorage,
  parseDocument,
  saveToLocalStorage,
  toDocument,
} from '../persistence/storage'
import {
  DEFAULT_VIEWPORT,
  type BoardSnapshot,
  type LabeledEdge,
  type NoteColorId,
  type StickyNode,
} from '../types'

const MAX_HISTORY = 80
const AUTOSAVE_MS = 400

function cloneSnapshot(nodes: StickyNode[], edges: LabeledEdge[]): BoardSnapshot {
  return {
    nodes: structuredClone(nodes),
    edges: structuredClone(edges),
  }
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

function initialBoard() {
  const stored = loadFromLocalStorage()
  const doc = stored ?? createStarterDocument()
  const { nodes, edges, viewport } = fromDocument(doc)
  return { nodes, edges, viewport }
}

type BoardState = {
  nodes: StickyNode[]
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

  onNodesChange: (changes: NodeChange<StickyNode>[]) => void
  onEdgesChange: (changes: EdgeChange<LabeledEdge>[]) => void
  onConnect: (connection: Connection) => void

  addNote: (position: XYPosition, color?: NoteColorId) => void
  updateNoteText: (id: string, text: string, withHistory: boolean) => void
  setSelectedColor: (color: NoteColorId) => void
  updateEdgeLabel: (id: string, label: string, withHistory: boolean) => void
  deleteSelected: () => void

  setViewport: (viewport: Viewport) => void
  captureBeforeDrag: () => void
  commitAfterDrag: () => void

  exportDocument: () => ReturnType<typeof toDocument>
  importDocument: (raw: unknown) => boolean
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
      const { nodes, edges, viewport } = get()
      try {
        saveToLocalStorage(toDocument(nodes, edges, viewport))
        set({ saveError: null })
      } catch {
        set({ saveError: '自動保存に失敗しました（容量不足の可能性）' })
      }
    }, AUTOSAVE_MS)
  }

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
      set({ nodes: applyNodeChanges(changes, get().nodes) })
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

    updateNoteText: (id, text, withHistory) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || node.data.text === text) return
      if (withHistory) get().commit()
      set({
        nodes: get().nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, text } } : n,
        ),
      })
      scheduleAutosave()
    },

    setSelectedColor: (color) => {
      const selected = get().nodes.filter((n) => n.selected)
      if (selected.length === 0) return
      if (selected.every((n) => n.data.color === color)) return
      get().commit()
      set({
        nodes: get().nodes.map((n) =>
          n.selected ? { ...n, data: { ...n.data, color } } : n,
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
      const beforeById = new Map(
        dragBaseline.nodes.map((n) => [n.id, n.position]),
      )
      const moved =
        nodes.length !== dragBaseline.nodes.length ||
        nodes.some((n) => {
          const before = beforeById.get(n.id)
          return (
            !before ||
            before.x !== n.position.x ||
            before.y !== n.position.y
          )
        })
      if (moved) {
        set({
          past: [...past, dragBaseline].slice(-MAX_HISTORY),
          future: [],
        })
        scheduleAutosave()
      }
      dragBaseline = null
    },

    exportDocument: () => {
      const { nodes, edges, viewport } = get()
      return toDocument(nodes, edges, viewport)
    },

    importDocument: (raw) => {
      const doc = parseDocument(raw)
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
