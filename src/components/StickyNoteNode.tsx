import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
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
import { NOTE_COLORS, type StickyNoteData } from '../types'

type StickyNoteNodeType = Node<StickyNoteData, 'sticky'>

function colorStyle(colorId: StickyNoteData['color']) {
  const found = NOTE_COLORS.find((c) => c.id === colorId) ?? NOTE_COLORS[0]
  return { background: found.bg, borderColor: found.border }
}

function StickyNoteNodeComponent({
  id,
  data,
  selected,
}: NodeProps<StickyNoteNodeType>) {
  const { text, detail = '', color } = data
  const updateNoteText = useBoardStore((s) => s.updateNoteText)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const baselineRef = useRef(text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hasDetail = detail.trim().length > 0

  useEffect(() => {
    if (!editing) setDraft(text)
  }, [text, editing])

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    }
  }, [editing])

  const startEdit = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      baselineRef.current = text
      setDraft(text)
      setEditing(true)
    },
    [text],
  )

  const finishEdit = useCallback(() => {
    setEditing(false)
    const next = draft
    if (next !== baselineRef.current) {
      updateNoteText(id, next, true)
    }
  }, [draft, id, updateNoteText])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(baselineRef.current)
      setEditing(false)
    }
    e.stopPropagation()
  }, [])

  const style = colorStyle(color)

  return (
    <div
      className={`sticky-note${selected ? ' selected' : ''}`}
      style={{ background: style.background, borderColor: style.borderColor }}
      onDoubleClick={startEdit}
    >
      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />

      {hasDetail ? (
        <span
          className="sticky-note__detail-mark"
          title="詳細あり"
          aria-label="詳細あり"
        >
          ▤
        </span>
      ) : null}

      {editing ? (
        <textarea
          ref={textareaRef}
          className="sticky-note__editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finishEdit}
          onKeyDown={onKeyDown}
          rows={4}
        />
      ) : (
        <div className="sticky-note__text">
          {text || (
            <span className="sticky-note__placeholder">ダブルクリックで編集</span>
          )}
        </div>
      )}
    </div>
  )
}

export const StickyNoteNode = memo(StickyNoteNodeComponent)
