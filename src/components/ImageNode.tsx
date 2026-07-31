import {
  Handle,
  NodeResizer,
  Position,
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
import { resolveImageUrl } from '../persistence/imageDb'
import { useBoardStore } from '../store/boardStore'
import { MIN_IMAGE_SIZE, type ImageNodeData } from '../types'

type ImageNodeType = Node<ImageNodeData, 'image'>

function ImageNodeComponent({
  id,
  data,
  selected,
}: NodeProps<ImageNodeType>) {
  const { imageId, caption, width, height } = data
  const updateImageCaption = useBoardStore((s) => s.updateImageCaption)
  const updateImageSize = useBoardStore((s) => s.updateImageSize)
  const captureBeforeDrag = useBoardStore((s) => s.captureBeforeDrag)
  const commitAfterDrag = useBoardStore((s) => s.commitAfterDrag)

  const [src, setSrc] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(caption)
  const baselineRef = useRef(caption)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void resolveImageUrl(imageId).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [imageId])

  useEffect(() => {
    if (!editing) setDraft(caption)
  }, [caption, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const startEdit = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      baselineRef.current = caption
      setDraft(caption)
      setEditing(true)
    },
    [caption],
  )

  const finishEdit = useCallback(() => {
    setEditing(false)
    if (draft !== baselineRef.current) {
      updateImageCaption(id, draft, true)
    }
  }, [draft, id, updateImageCaption])

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
      className={`image-node${selected ? ' selected' : ''}`}
      style={{ width, height }}
    >
      <NodeResizer
        isVisible={selected}
        keepAspectRatio
        minWidth={MIN_IMAGE_SIZE}
        minHeight={MIN_IMAGE_SIZE}
        onResizeStart={() => captureBeforeDrag()}
        onResizeEnd={(_e, params) => {
          updateImageSize(id, Math.round(params.width), Math.round(params.height))
          commitAfterDrag()
        }}
      />

      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />

      <div className="image-node__media">
        {src ? (
          <img
            className="image-node__img"
            src={src}
            alt={caption || '画像'}
            draggable={false}
          />
        ) : (
          <div className="image-node__missing">画像を読み込めません</div>
        )}
      </div>

      <div
        className="image-node__caption nodrag nopan"
        onDoubleClick={startEdit}
        onClick={(e) => e.stopPropagation()}
      >
        {editing ? (
          <input
            ref={inputRef}
            className="image-node__caption-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={finishEdit}
            onKeyDown={onKeyDown}
            placeholder="名前"
          />
        ) : (
          <span className="image-node__caption-text">
            {caption || (
              <span className="image-node__caption-hint">
                ダブルクリックで名前
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

export const ImageNode = memo(ImageNodeComponent)
