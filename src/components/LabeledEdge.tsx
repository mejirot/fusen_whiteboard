import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { useBoardStore } from '../store/boardStore'
import type { LabeledEdgeData } from '../types'

type LabeledEdgeType = Edge<LabeledEdgeData, 'labeled'>

function LabeledEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
  selected,
}: EdgeProps<LabeledEdgeType>) {
  const label = data?.label ?? ''
  const updateEdgeLabel = useBoardStore((s) => s.updateEdgeLabel)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const baselineRef = useRef(label)
  const inputRef = useRef<HTMLInputElement>(null)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  useEffect(() => {
    if (!editing) setDraft(label)
  }, [label, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const startEdit = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      baselineRef.current = label
      setDraft(label)
      setEditing(true)
    },
    [label],
  )

  const finishEdit = useCallback(() => {
    setEditing(false)
    if (draft !== baselineRef.current) {
      updateEdgeLabel(id, draft, true)
    }
  }, [draft, id, updateEdgeLabel])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        finishEdit()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDraft(baselineRef.current)
        setEditing(false)
      }
      e.stopPropagation()
    },
    [finishEdit],
  )

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: selected ? 2.5 : 2,
          stroke: selected ? '#2a5a8a' : '#4a5568',
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`edge-label${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onDoubleClick={startEdit}
          onClick={(e) => e.stopPropagation()}
        >
          {editing ? (
            <input
              ref={inputRef}
              className="edge-label__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={finishEdit}
              onKeyDown={onKeyDown}
              placeholder="ラベル"
            />
          ) : (
            <span className="edge-label__text">
              {label || <span className="edge-label__hint">＋</span>}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const LabeledEdge = memo(LabeledEdgeComponent)
