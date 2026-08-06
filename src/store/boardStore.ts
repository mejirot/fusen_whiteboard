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
  ApiError,
  createBoard as apiCreateBoard,
  deleteBoard as apiDeleteBoard,
  ensureSession,
  getBoard as apiGetBoard,
  listBoards,
  listTrash,
  putBoard as apiPutBoard,
  restoreBoard as apiRestoreBoard,
} from '../api/boards'
import {
  clearLegacyImageDb,
  deleteImageBlobs,
  fitImageSize,
  getLegacyImageBlob,
  listLegacyImageIds,
  putImageBlob,
  readImageSize,
  resolveImageUrl,
  revokeAllImageUrls,
  setActiveBoardId,
} from '../persistence/imageDb'
import {
  boardContentFromDocument,
  buildExportDocument,
  clearLocalStorageDocument,
  fromDocument,
  loadFromLocalStorage,
  parseDocument,
  prepareImportedDocument,
  toStoredBoardPayload,
} from '../persistence/storage'
import {
  ACTIVE_BOARD_KEY,
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_FRAME_TITLE,
  DEFAULT_FRAME_WIDTH,
  DEFAULT_VIEWPORT,
  FRAME_DRAG_HANDLE,
  FRAME_Z_INDEX,
  type BoardDocument,
  type BoardNode,
  type BoardSnapshot,
  type BoardSummary,
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
  const used = new Set(nodes.filter(isImageNode).map((n) => n.data.caption))
  let i = 1
  while (used.has(`画像 ${i}`)) i += 1
  return `画像 ${i}`
}

function rememberActiveBoardId(boardId: string): void {
  try {
    localStorage.setItem(ACTIVE_BOARD_KEY, boardId)
  } catch {
    // ignore
  }
}

function readRememberedBoardId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_BOARD_KEY)
  } catch {
    return null
  }
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

  boardId: string | null
  title: string
  revision: number
  boards: BoardSummary[]
  trashedBoards: BoardSummary[]
  libraryOpen: boolean
  bootstrapping: boolean

  commit: () => void
  undo: () => void
  redo: () => void

  onNodesChange: (changes: NodeChange<BoardNode>[]) => void
  onEdgesChange: (changes: EdgeChange<LabeledEdge>[]) => void
  onConnect: (connection: Connection) => void

  addNote: (position: XYPosition, color?: NoteColorId) => void
  addFrame: (
    position: XYPosition,
    size?: { width: number; height: number },
  ) => void
  addImageFromBlob: (
    blob: Blob,
    position: XYPosition,
    caption: string,
  ) => Promise<boolean>
  nextPasteCaption: () => string
  updateNoteText: (id: string, text: string, withHistory: boolean) => void
  updateImageCaption: (id: string, caption: string, withHistory: boolean) => void
  updateImageSize: (id: string, width: number, height: number) => void
  updateFrameTitle: (id: string, title: string, withHistory: boolean) => void
  updateFrameSize: (id: string, width: number, height: number) => void
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

  bootstrap: () => Promise<void>
  refreshLibrary: () => Promise<void>
  createBoard: (title?: string) => Promise<void>
  openBoard: (boardId: string) => Promise<void>
  renameBoard: (title: string) => void
  deleteCurrentBoard: () => Promise<void>
  restoreBoard: (boardId: string) => Promise<void>
  setLibraryOpen: (open: boolean) => void
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null
let dragBaseline: BoardSnapshot | null = null
let knownImageIds = new Set<string>()
let saveGeneration = 0

export const useBoardStore = create<BoardState>((set, get) => {
  const applyBoard = (board: StoredBoard, resetHistory = true) => {
    setActiveBoardId(board.id)
    rememberActiveBoardId(board.id)
    revokeAllImageUrls()
    const { nodes, edges, viewport } = fromDocument(board)
    knownImageIds = new Set(board.images.map((img) => img.imageId))
    set({
      boardId: board.id,
      title: board.title,
      revision: board.revision,
      nodes,
      edges,
      viewport: viewport ?? DEFAULT_VIEWPORT,
      ...(resetHistory ? { past: [], future: [] } : {}),
      boardEpoch: get().boardEpoch + 1,
      saveError: null,
    })
  }

  const scheduleAutosave = () => {
    if (!get().boardId || !get().hydrated) return
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => {
      void persistBoard()
    }, AUTOSAVE_MS)
  }

  const persistBoard = async () => {
    const {
      boardId,
      title,
      revision,
      nodes,
      edges,
      viewport,
      past,
      future,
    } = get()
    if (!boardId) return
    const gen = ++saveGeneration
    try {
      const payload = toStoredBoardPayload(title, nodes, edges, viewport)
      const updated = await apiPutBoard(boardId, revision, payload)
      if (gen !== saveGeneration) return
      set({ revision: updated.revision, saveError: null })
      const keep = collectReferencedImageIds(nodes, past, future)
      const stale = [...knownImageIds].filter((id) => !keep.has(id))
      if (stale.length > 0) {
        await deleteImageBlobs(stale)
        for (const id of stale) knownImageIds.delete(id)
      }
      for (const id of keep) knownImageIds.add(id)
      void get().refreshLibrary()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        set({
          saveError: '他で更新されたため保存できません。ボードを再読み込みしてください。',
        })
        return
      }
      set({
        saveError:
          error instanceof Error
            ? error.message
            : '自動保存に失敗しました',
      })
    }
  }

  const migrateLegacyIfNeeded = async (
    boards: BoardSummary[],
  ): Promise<StoredBoard | null> => {
    if (boards.length > 0) return null
    const legacy = loadFromLocalStorage()
    if (!legacy) return null

    const created = await apiCreateBoard({
      title: '移行したボード',
      board: boardContentFromDocument(legacy),
    })
    setActiveBoardId(created.id)
    const imageIds = new Set(legacy.images.map((img) => img.imageId))
    const legacyIds = await listLegacyImageIds()
    for (const id of legacyIds) {
      if (!imageIds.has(id)) continue
      const blob = await getLegacyImageBlob(id)
      if (blob) await putImageBlob(id, blob)
    }
    clearLocalStorageDocument()
    await clearLegacyImageDb()
    return created
  }

  const syncSizedNodeDimensions = (nodes: BoardNode[]): BoardNode[] =>
    nodes.map((n) => {
      if (isImageNode(n)) {
        const width = n.width ?? n.data.width
        const height = n.height ?? n.data.height
        if (width === n.data.width && height === n.data.height) return n
        return {
          ...n,
          style: { ...n.style, width, height },
          data: { ...n.data, width, height },
        }
      }
      if (isFrameNode(n)) {
        const width = n.width ?? n.data.width
        const height = n.height ?? n.data.height
        if (width === n.data.width && height === n.data.height) return n
        return {
          ...n,
          style: { ...n.style, width, height },
          data: { ...n.data, width, height },
        }
      }
      return n
    })

  return {
    nodes: [],
    edges: [],
    viewport: DEFAULT_VIEWPORT,
    past: [],
    future: [],
    saveError: null,
    hydrated: false,
    boardEpoch: 0,
    boardId: null,
    title: '',
    revision: 0,
    boards: [],
    trashedBoards: [],
    libraryOpen: false,
    bootstrapping: true,

    scheduleAutosave,

    bootstrap: async () => {
      set({ bootstrapping: true, saveError: null })
      try {
        await ensureSession()
        let boards = await listBoards()
        const migrated = await migrateLegacyIfNeeded(boards)
        if (migrated) {
          boards = await listBoards()
          applyBoard(migrated)
        } else if (boards.length === 0) {
          const created = await apiCreateBoard({ starter: true })
          boards = await listBoards()
          applyBoard(created)
        } else {
          const remembered = readRememberedBoardId()
          const target =
            boards.find((b) => b.id === remembered)?.id ?? boards[0]!.id
          const board = await apiGetBoard(target)
          applyBoard(board)
        }
        const trashedBoards = await listTrash()
        set({
          boards,
          trashedBoards,
          hydrated: true,
          bootstrapping: false,
        })
      } catch (error) {
        set({
          bootstrapping: false,
          hydrated: false,
          saveError:
            error instanceof Error
              ? error.message
              : 'ワークスペースに接続できません',
        })
      }
    },

    refreshLibrary: async () => {
      try {
        const [boards, trashedBoards] = await Promise.all([
          listBoards(),
          listTrash(),
        ])
        set({ boards, trashedBoards })
      } catch {
        // ignore refresh failures
      }
    },

    createBoard: async (title) => {
      await persistBoard()
      const board = await apiCreateBoard({ title: title ?? '無題のボード' })
      applyBoard(board)
      await get().refreshLibrary()
      set({ libraryOpen: false })
    },

    openBoard: async (boardId) => {
      if (boardId === get().boardId) {
        set({ libraryOpen: false })
        return
      }
      await persistBoard()
      const board = await apiGetBoard(boardId)
      applyBoard(board)
      set({ libraryOpen: false })
    },

    renameBoard: (title) => {
      const next = title.trim() || '無題のボード'
      if (next === get().title) return
      set({ title: next })
      scheduleAutosave()
    },

    deleteCurrentBoard: async () => {
      const { boardId, revision, boards } = get()
      if (!boardId) return
      if (boards.length <= 1) {
        set({ saveError: '最後のボードは削除できません' })
        return
      }
      if (autosaveTimer) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
      }
      await apiDeleteBoard(boardId, revision)
      const remaining = (await listBoards()).filter((b) => b.id !== boardId)
      const nextId = remaining[0]?.id
      if (!nextId) {
        const created = await apiCreateBoard({ starter: true })
        applyBoard(created)
      } else {
        applyBoard(await apiGetBoard(nextId))
      }
      await get().refreshLibrary()
      set({ libraryOpen: false })
    },

    restoreBoard: async (boardId) => {
      const trashed = get().trashedBoards.find((b) => b.id === boardId)
      if (!trashed) return
      await persistBoard()
      const board = await apiRestoreBoard(boardId, trashed.revision)
      applyBoard(board)
      await get().refreshLibrary()
      set({ libraryOpen: false })
    },

    setLibraryOpen: (open) => {
      set({ libraryOpen: open })
      if (open) void get().refreshLibrary()
    },

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
      const next = syncSizedNodeDimensions(
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

    addFrame: (position, size) => {
      get().commit()
      const width = size?.width ?? DEFAULT_FRAME_WIDTH
      const height = size?.height ?? DEFAULT_FRAME_HEIGHT
      const node: FrameNode = {
        id: uid('frame'),
        type: 'frame',
        position,
        style: { width, height },
        width,
        height,
        zIndex: FRAME_Z_INDEX,
        connectable: false,
        dragHandle: FRAME_DRAG_HANDLE,
        data: {
          title: DEFAULT_FRAME_TITLE,
          width,
          height,
        },
      }
      // Keep frames under other nodes in paint order as well as zIndex.
      set({ nodes: [node, ...get().nodes] })
      scheduleAutosave()
    },

    nextPasteCaption: () => nextPasteCaption(get().nodes),

    addImageFromBlob: async (blob, position, caption) => {
      try {
        const size = await readImageSize(blob)
        const fitted = fitImageSize(size.width, size.height)
        const imageId = uid('img')
        await putImageBlob(imageId, blob)
        knownImageIds.add(imageId)
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

    updateFrameTitle: (id, title, withHistory) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isFrameNode(node) || node.data.title === title) return
      if (withHistory) get().commit()
      set({
        nodes: get().nodes.map((n) =>
          n.id === id && isFrameNode(n)
            ? { ...n, data: { ...n.data, title } }
            : n,
        ),
      })
      scheduleAutosave()
    },

    updateFrameSize: (id, width, height) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isFrameNode(node)) return
      if (node.data.width === width && node.data.height === height) return
      set({
        nodes: get().nodes.map((n) =>
          n.id === id && isFrameNode(n)
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
          const beforeW =
            before.width ?? (isImageNode(before) ? before.data.width : 0)
          const beforeH =
            before.height ?? (isImageNode(before) ? before.data.height : 0)
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
      const parsed = parseDocument(raw)
      if (!parsed) return false
      await persistBoard()
      const board = await apiCreateBoard({
        title: '読み込んだボード',
        board: {
          notes: parsed.notes,
          images: parsed.images,
          edges: parsed.edges,
          viewport: parsed.viewport,
        },
      })
      setActiveBoardId(board.id)
      const prepared = await prepareImportedDocument(raw)
      if (!prepared) return false
      // Re-save with hydrated assets already uploaded via prepareImportedDocument
      const { nodes, edges, viewport } = fromDocument(prepared)
      knownImageIds = new Set(prepared.images.map((img) => img.imageId))
      set({
        boardId: board.id,
        title: board.title,
        revision: board.revision,
        nodes,
        edges,
        viewport: viewport ?? DEFAULT_VIEWPORT,
        past: [],
        future: [],
        boardEpoch: get().boardEpoch + 1,
      })
      rememberActiveBoardId(board.id)
      scheduleAutosave()
      await get().refreshLibrary()
      return true
    },

    clearSaveError: () => set({ saveError: null }),
  }
})
