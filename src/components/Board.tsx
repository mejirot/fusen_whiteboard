import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, type MouseEvent } from 'react'
import { useBoardStore } from '../store/boardStore'
import { LabeledEdge } from './LabeledEdge'
import { StickyNoteNode } from './StickyNoteNode'
import { Toolbar } from './Toolbar'

const nodeTypes = { sticky: StickyNoteNode }
const edgeTypes = { labeled: LabeledEdge }

function BoardCanvas() {
  const nodes = useBoardStore((s) => s.nodes)
  const edges = useBoardStore((s) => s.edges)
  const initialViewport = useBoardStore((s) => s.viewport)
  const boardEpoch = useBoardStore((s) => s.boardEpoch)
  const onNodesChange = useBoardStore((s) => s.onNodesChange)
  const onEdgesChange = useBoardStore((s) => s.onEdgesChange)
  const onConnect = useBoardStore((s) => s.onConnect)
  const addNote = useBoardStore((s) => s.addNote)
  const setViewport = useBoardStore((s) => s.setViewport)
  const captureBeforeDrag = useBoardStore((s) => s.captureBeforeDrag)
  const commitAfterDrag = useBoardStore((s) => s.commitAfterDrag)
  const undo = useBoardStore((s) => s.undo)
  const redo = useBoardStore((s) => s.redo)
  const deleteSelected = useBoardStore((s) => s.deleteSelected)

  const { screenToFlowPosition, setViewport: setFlowViewport } = useReactFlow()

  useEffect(() => {
    if (boardEpoch === 0) return
    setFlowViewport(useBoardStore.getState().viewport, { duration: 0 })
  }, [boardEpoch, setFlowViewport])

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
      <div className="board__canvas">
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
              const color = (n.data as { color?: string } | undefined)?.color
              switch (color) {
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
