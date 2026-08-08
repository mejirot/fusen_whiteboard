import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useBoardStore } from '../store/boardStore'
import { isStickyNode, type StickyNode } from '../types'

function useSelectedSticky(): StickyNode | null {
  return useBoardStore((s) => {
    const selected = s.nodes.filter((n) => n.selected && isStickyNode(n))
    return selected.length === 1 ? (selected[0] as StickyNode) : null
  })
}

export function NoteDetailPanel() {
  const note = useSelectedSticky()
  const updateNoteText = useBoardStore((s) => s.updateNoteText)
  const updateNoteDetail = useBoardStore((s) => s.updateNoteDetail)
  const clearSelection = useBoardStore((s) => s.clearSelection)

  const textId = useId()
  const detailId = useId()
  const [textDraft, setTextDraft] = useState('')
  const [detailDraft, setDetailDraft] = useState('')
  const textBaselineRef = useRef('')
  const detailBaselineRef = useRef('')
  const noteIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!note) {
      noteIdRef.current = null
      return
    }
    if (noteIdRef.current !== note.id) {
      noteIdRef.current = note.id
      textBaselineRef.current = note.data.text
      detailBaselineRef.current = note.data.detail
      setTextDraft(note.data.text)
      setDetailDraft(note.data.detail)
      return
    }
    // Keep drafts in sync when the same note changes elsewhere (e.g. canvas edit).
    if (document.activeElement?.closest('.note-detail-panel') == null) {
      textBaselineRef.current = note.data.text
      detailBaselineRef.current = note.data.detail
      setTextDraft(note.data.text)
      setDetailDraft(note.data.detail)
    }
  }, [note])

  useEffect(() => {
    if (!note) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target
      if (
        target instanceof HTMLElement &&
        target.closest('.note-detail-panel')
      ) {
        return
      }
      clearSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [note, clearSelection])

  const commitText = useCallback(() => {
    if (!note) return
    if (textDraft !== textBaselineRef.current) {
      updateNoteText(note.id, textDraft, true)
      textBaselineRef.current = textDraft
    }
  }, [note, textDraft, updateNoteText])

  const commitDetail = useCallback(() => {
    if (!note) return
    if (detailDraft !== detailBaselineRef.current) {
      updateNoteDetail(note.id, detailDraft, true)
      detailBaselineRef.current = detailDraft
    }
  }, [note, detailDraft, updateNoteDetail])

  const onPanelKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      commitText()
      commitDetail()
      clearSelection()
    },
    [clearSelection, commitDetail, commitText],
  )

  if (!note) return null

  return (
    <aside
      className="note-detail-panel"
      aria-label="付箋の詳細"
      onKeyDown={onPanelKeyDown}
    >
      <div className="note-detail-panel__header">
        <h2 className="note-detail-panel__title">付箋の詳細</h2>
        <button
          type="button"
          className="note-detail-panel__close"
          onClick={() => {
            commitText()
            commitDetail()
            clearSelection()
          }}
          aria-label="閉じる"
        >
          ×
        </button>
      </div>

      <label className="note-detail-panel__label" htmlFor={textId}>
        短いテキスト
      </label>
      <textarea
        id={textId}
        className="note-detail-panel__text"
        value={textDraft}
        rows={3}
        placeholder="ホワイトボード上に表示"
        onChange={(e) => setTextDraft(e.target.value)}
        onBlur={commitText}
      />

      <label className="note-detail-panel__label" htmlFor={detailId}>
        詳細
      </label>
      <textarea
        id={detailId}
        className="note-detail-panel__detail"
        value={detailDraft}
        rows={12}
        placeholder="詳細情報（ホワイトボードには表示されません）"
        onChange={(e) => setDetailDraft(e.target.value)}
        onBlur={commitDetail}
      />
    </aside>
  )
}
