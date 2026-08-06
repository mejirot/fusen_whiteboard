import {
  NodeResizer,
  type Node,
  type NodeProps,
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
import {
  MIN_FRAME_HEIGHT,
  MIN_FRAME_WIDTH,
  type FrameNodeData,
} from '../types'

type FrameNodeType = Node<FrameNodeData, 'frame'>

function FrameNodeComponent({
  id,
  data,
  selected,
}: NodeProps<FrameNodeType>) {
  const { title, width, height } = data
  const updateFrameTitle = useBoardStore((s) => s.updateFrameTitle)
  const updateFrameSize = useBoardStore((s) => s.updateFrameSize)
  const captureBeforeDrag = useBoardStore((s) => s.captureBeforeDrag)
  const commitAfterDrag = useBoardStore((s) => s.commitAfterDrag)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const baselineRef = useRef(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(title)
  }, [title, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const startEdit = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      baselineRef.current = title
      setDraft(title)
      setEditing(true)
    },
    [title],
  )

  const finishEdit = useCallback(() => {
    setEditing(false)
    if (draft !== baselineRef.current) {
      updateFrameTitle(id, draft, true)
    }
  }, [draft, id, updateFrameTitle])

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
    <div
      className={`frame-node${selected ? ' selected' : ''}`}
      style={{ width, height }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={MIN_FRAME_WIDTH}
        minHeight={MIN_FRAME_HEIGHT}
        onResizeStart={() => captureBeforeDrag()}
        onResizeEnd={(_e, params) => {
          updateFrameSize(
            id,
            Math.round(params.width),
            Math.round(params.height),
          )
          commitAfterDrag()
        }}
      />

      <div
        className="frame-node__title nopan"
        onDoubleClick={startEdit}
        onClick={(e) => e.stopPropagation()}
      >
        {editing ? (
          <input
            ref={inputRef}
            className="frame-node__title-input nodrag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={finishEdit}
            onKeyDown={onKeyDown}
            placeholder="タイトル"
            aria-label="枠タイトル"
          />
        ) : (
          <span className="frame-node__title-text">
            {title || (
              <span className="frame-node__title-hint">
                ダブルクリックでタイトル
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

export const FrameNode = memo(FrameNodeComponent)
