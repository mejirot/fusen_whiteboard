import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useReactFlow,
} from '@xyflow/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type DragEvent,
  type MouseEvent,
} from 'react'
import { useBoardStore } from '../store/boardStore'
import { isImageNode, isStickyNode, type BoardNode } from '../types'
import { ImageNode } from './ImageNode'
import { LabeledEdge } from './LabeledEdge'
import { StickyNoteNode } from './StickyNoteNode'
import { Toolbar } from './Toolbar'

const nodeTypes = { sticky: StickyNoteNode, image: ImageNode }
const edgeTypes = { labeled: LabeledEdge }

const IMAGE_MIME = /^image\//

function captionFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').trim()
  return base || name || '画像'
}

function extractImageFiles(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return []
  const files: File[] = []
  for (const file of Array.from(dataTransfer.files)) {
    if (IMAGE_MIME.test(file.type)) files.push(file)
  }
  if (files.length > 0) return files

  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind === 'file' && IMAGE_MIME.test(item.type)) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  return files
}

function BoardCanvas() {
  const nodes = useBoardStore((s) => s.nodes)
  const edges = useBoardStore((s) => s.edges)
  const initialViewport = useBoardStore((s) => s.viewport)
  const boardEpoch = useBoardStore((s) => s.boardEpoch)
  const onNodesChange = useBoardStore((s) => s.onNodesChange)
  const onEdgesChange = useBoardStore((s) => s.onEdgesChange)
  const onConnect = useBoardStore((s) => s.onConnect)
  const addNote = useBoardStore((s) => s.addNote)
  const addImageFromBlob = useBoardStore((s) => s.addImageFromBlob)
  const nextPasteCaption = useBoardStore((s) => s.nextPasteCaption)
  const setViewport = useBoardStore((s) => s.setViewport)
  const captureBeforeDrag = useBoardStore((s) => s.captureBeforeDrag)
  const commitAfterDrag = useBoardStore((s) => s.commitAfterDrag)
  const undo = useBoardStore((s) => s.undo)
  const redo = useBoardStore((s) => s.redo)
  const deleteSelected = useBoardStore((s) => s.deleteSelected)

  const { screenToFlowPosition, setViewport: setFlowViewport } = useReactFlow()
  const lastPointerRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

  useEffect(() => {
    if (boardEpoch === 0) return
    setFlowViewport(useBoardStore.getState().viewport, { duration: 0 })
  }, [boardEpoch, setFlowViewport])

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointermove', onPointer)
    return () => window.removeEventListener('pointermove', onPointer)
  }, [])

  const placeImage = useCallback(
    async (blob: Blob, clientX: number, clientY: number, caption: string) => {
      const position = screenToFlowPosition({ x: clientX, y: clientY })
      await addImageFromBlob(
        blob,
        { x: position.x - 160, y: position.y - 120 },
        caption,
      )
    },
    [addImageFromBlob, screenToFlowPosition],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return
      }

      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
        return
      }
      if (
        (mod && e.key.toLowerCase() === 'y') ||
        (mod && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault()
        redo()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, deleteSelected])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return
      }

      const files = extractImageFiles(e.clipboardData)
      if (files.length === 0) return

      e.preventDefault()
      const { x, y } = lastPointerRef.current
      void (async () => {
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i]!
          const caption = nextPasteCaption()
          await placeImage(file, x + i * 28, y + i * 28, caption)
        }
      })()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [nextPasteCaption, placeImage])

  const onPaneClick = useCallback(
    (event: MouseEvent) => {
      if (event.detail !== 2) return
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      addNote({ x: position.x - 90, y: position.y - 60 })
    },
    [addNote, screenToFlowPosition],
  )

  const onDragOver = useCallback((e: DragEvent) => {
    if (extractImageFiles(e.dataTransfer).length === 0) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      const files = extractImageFiles(e.dataTransfer)
      if (files.length === 0) return
      e.preventDefault()
      void (async () => {
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i]!
          await placeImage(
            file,
            e.clientX + i * 28,
            e.clientY + i * 28,
            captionFromFilename(file.name),
          )
        }
      })()
    },
    [placeImage],
  )

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'labeled' as const,
      markerEnd: { type: 'arrowclosed' as const },
    }),
    [],
  )

  return (
    <div className="board">
      <Toolbar />
      <div className="board__canvas" onDragOver={onDragOver} onDrop={onDrop}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          connectionMode={ConnectionMode.Loose}
          defaultViewport={initialViewport}
          fitView={false}
          minZoom={0.2}
          maxZoom={2.5}
          panOnScroll={false}
          zoomOnScroll
          panOnDrag={[1, 2]}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode="Shift"
          deleteKeyCode={null}
          onlyRenderVisibleElements
          onPaneClick={onPaneClick}
          zoomOnDoubleClick={false}
          onNodeDragStart={captureBeforeDrag}
          onNodeDragStop={commitAfterDrag}
          onSelectionDragStart={captureBeforeDrag}
          onSelectionDragStop={commitAfterDrag}
          onMoveEnd={(_, next) => setViewport(next)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="#d0d4dc" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              const node = n as BoardNode
              if (isImageNode(node)) return '#9aa3b5'
              if (isStickyNode(node)) {
                switch (node.data.color) {
                  case 'peach':
                    return '#FFD4C2'
                  case 'mint':
                    return '#C8F0D8'
                  case 'sky':
                    return '#CDE8FF'
                  case 'lavender':
                    return '#E4D4FF'
                  case 'rose':
                    return '#FFD0D8'
                  default:
                    return '#FFE566'
                }
              }
              return '#FFE566'
            }}
          />
        </ReactFlow>
      </div>
    </div>
  )
}

export function Board() {
  return <BoardCanvas />
}
