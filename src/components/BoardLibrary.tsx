import { useCallback, useState } from 'react'
import { useBoardStore } from '../store/boardStore'

export function BoardLibrary() {
  const open = useBoardStore((s) => s.libraryOpen)
  const setLibraryOpen = useBoardStore((s) => s.setLibraryOpen)
  const boards = useBoardStore((s) => s.boards)
  const trashedBoards = useBoardStore((s) => s.trashedBoards)
  const boardId = useBoardStore((s) => s.boardId)
  const openBoard = useBoardStore((s) => s.openBoard)
  const createBoard = useBoardStore((s) => s.createBoard)
  const deleteCurrentBoard = useBoardStore((s) => s.deleteCurrentBoard)
  const restoreBoard = useBoardStore((s) => s.restoreBoard)

  const [tab, setTab] = useState<'boards' | 'trash'>('boards')

  const onCreate = useCallback(() => {
    void createBoard()
  }, [createBoard])

  const onDelete = useCallback(() => {
    if (!window.confirm('このボードをゴミ箱へ移動しますか？')) return
    void deleteCurrentBoard()
  }, [deleteCurrentBoard])

  if (!open) return null

  return (
    <div className="library-backdrop" onClick={() => setLibraryOpen(false)}>
      <aside
        className="library"
        role="dialog"
        aria-label="ボード一覧"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="library__header">
          <h2>ボード</h2>
          <button type="button" onClick={() => setLibraryOpen(false)}>
            閉じる
          </button>
        </div>

        <div className="library__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'boards'}
            className={tab === 'boards' ? 'is-active' : undefined}
            onClick={() => setTab('boards')}
          >
            一覧
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'trash'}
            className={tab === 'trash' ? 'is-active' : undefined}
            onClick={() => setTab('trash')}
          >
            ゴミ箱 ({trashedBoards.length})
          </button>
        </div>

        {tab === 'boards' ? (
          <>
            <div className="library__actions">
              <button type="button" onClick={onCreate}>
                新規ボード
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={boards.length <= 1}
                title="現在のボードをゴミ箱へ"
              >
                現在を削除
              </button>
            </div>
            <ul className="library__list">
              {boards.map((board) => (
                <li key={board.id}>
                  <button
                    type="button"
                    className={
                      board.id === boardId
                        ? 'library__item is-active'
                        : 'library__item'
                    }
                    onClick={() => void openBoard(board.id)}
                  >
                    <span className="library__item-title">{board.title}</span>
                    <span className="library__item-meta">
                      付箋 {board.noteCount} / 画像 {board.imageCount}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <ul className="library__list">
            {trashedBoards.length === 0 ? (
              <li className="library__empty">ゴミ箱は空です</li>
            ) : (
              trashedBoards.map((board) => (
                <li key={board.id}>
                  <div className="library__item library__item--trash">
                    <div>
                      <span className="library__item-title">{board.title}</span>
                      <span className="library__item-meta">
                        {new Date(board.updatedAt).toLocaleString()}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restoreBoard(board.id)}
                    >
                      復元
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        )}
      </aside>
    </div>
  )
}
