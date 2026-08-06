import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { downloadJson } from '../persistence/storage'
import { useBoardStore } from '../store/boardStore'
import { NOTE_COLORS } from '../types'

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const { screenToFlowPosition } = useReactFlow()

  const addNote = useBoardStore((s) => s.addNote)
  const setSelectedColor = useBoardStore((s) => s.setSelectedColor)
  const deleteSelected = useBoardStore((s) => s.deleteSelected)
  const undo = useBoardStore((s) => s.undo)
  const redo = useBoardStore((s) => s.redo)
  const canUndo = useBoardStore((s) => s.past.length > 0)
  const canRedo = useBoardStore((s) => s.future.length > 0)
  const exportDocument = useBoardStore((s) => s.exportDocument)
  const importDocument = useBoardStore((s) => s.importDocument)
  const saveError = useBoardStore((s) => s.saveError)
  const clearSaveError = useBoardStore((s) => s.clearSaveError)
  const title = useBoardStore((s) => s.title)
  const renameBoard = useBoardStore((s) => s.renameBoard)
  const setLibraryOpen = useBoardStore((s) => s.setLibraryOpen)
  const createBoard = useBoardStore((s) => s.createBoard)
  const libraryOpen = useBoardStore((s) => s.libraryOpen)

  const [draftTitle, setDraftTitle] = useState(title)

  useEffect(() => {
    setDraftTitle(title)
  }, [title])

  const onAdd = useCallback(() => {
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    })
    addNote({
      x: center.x - 90,
      y: center.y - 60,
    })
  }, [addNote, screenToFlowPosition])

  const onExport = useCallback(() => {
    void (async () => {
      try {
        const doc = await exportDocument()
        downloadJson(doc)
      } catch {
        window.alert('書き出しに失敗しました')
      }
    })()
  }, [exportDocument])

  const onImportClick = useCallback(() => {
    fileRef.current?.click()
  }, [])

  const onImportFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      try {
        const text = await file.text()
        const ok = await importDocument(JSON.parse(text) as unknown)
        if (!ok) window.alert('JSONの形式が正しくありません')
      } catch {
        window.alert('ファイルを読み込めませんでした')
      }
    },
    [importDocument],
  )

  const commitTitle = useCallback(() => {
    renameBoard(draftTitle)
  }, [draftTitle, renameBoard])

  return (
    <header className="toolbar">
      <div className="toolbar__brand-block">
        <div className="toolbar__brand">付箋ホワイトボード</div>
        <input
          ref={titleRef}
          className="toolbar__title"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitTitle()
              titleRef.current?.blur()
            }
          }}
          aria-label="ボードタイトル"
          title="ボードタイトル"
        />
        <button
          type="button"
          className={libraryOpen ? 'is-active' : undefined}
          onClick={() => setLibraryOpen(!libraryOpen)}
          title="ボード一覧"
        >
          ボード一覧
        </button>
        <button
          type="button"
          onClick={() => void createBoard()}
          title="新規ボード"
        >
          新規
        </button>
      </div>

      <div className="toolbar__group">
        <button type="button" onClick={onAdd} title="付箋を追加 (ダブルクリックでも可)">
          付箋追加
        </button>
        <button type="button" onClick={deleteSelected} title="選択を削除 (Delete)">
          削除
        </button>
      </div>

      <div className="toolbar__group toolbar__colors" role="group" aria-label="色">
        {NOTE_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="color-swatch"
            style={{ background: c.bg, borderColor: c.border }}
            title={`色: ${c.label}`}
            aria-label={c.label}
            onClick={() => setSelectedColor(c.id)}
          />
        ))}
      </div>

      <div className="toolbar__group">
        <button type="button" onClick={undo} disabled={!canUndo} title="元に戻す (Ctrl+Z)">
          Undo
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title="やり直し (Ctrl+Y)">
          Redo
        </button>
      </div>

      <div className="toolbar__group">
        <button type="button" onClick={onExport} title="JSON書き出し">
          書き出し
        </button>
        <button type="button" onClick={onImportClick} title="JSON読み込み（新規ボードとして）">
          読み込み
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            void onImportFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>

      {saveError && (
        <div className="toolbar__error" role="status">
          <span>{saveError}</span>
          <button type="button" onClick={clearSaveError}>
            ×
          </button>
        </div>
      )}

      <p className="toolbar__hint">
        画像は Ctrl+V またはドロップ / キャプションはダブルクリック / 空白ドラッグで選択 /
        中ボタンドラッグでパン
      </p>
    </header>
  )
}
