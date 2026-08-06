import { assetUrl, deleteAsset, putAsset } from '../api/boards'

/** Legacy IndexedDB (migration only). */
const DB_NAME = 'fusen-whiteboard-images'
const STORE = 'images'
const DB_VERSION = 1

let activeBoardId: string | null = null

export function setActiveBoardId(boardId: string | null): void {
  activeBoardId = boardId
}

export function getActiveBoardId(): string | null {
  return activeBoardId
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

export async function putImageBlob(id: string, blob: Blob): Promise<void> {
  if (!activeBoardId) {
    throw new Error('active board is not set')
  }
  await putAsset(activeBoardId, id, blob)
  revokeImageUrl(id)
}

export async function getImageBlob(id: string): Promise<Blob | undefined> {
  if (!activeBoardId) return undefined
  try {
    const response = await fetch(assetUrl(activeBoardId, id), {
      credentials: 'same-origin',
    })
    if (!response.ok) return undefined
    return await response.blob()
  } catch {
    return undefined
  }
}

export async function deleteImageBlobs(ids: string[]): Promise<void> {
  if (!activeBoardId || ids.length === 0) return
  const boardId = activeBoardId
  await Promise.all(ids.map((id) => deleteAsset(boardId, id)))
}

const urlCache = new Map<string, string>()

export async function resolveImageUrl(id: string): Promise<string | null> {
  if (!activeBoardId) return null
  const key = `${activeBoardId}:${id}`
  const cached = urlCache.get(key)
  if (cached) return cached
  const url = assetUrl(activeBoardId, id)
  urlCache.set(key, url)
  return url
}

export function revokeImageUrl(id: string): void {
  if (!activeBoardId) return
  const key = `${activeBoardId}:${id}`
  urlCache.delete(key)
}

export function revokeAllImageUrls(): void {
  urlCache.clear()
}

export function readImageSize(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('invalid image'))
    }
    img.src = url
  })
}

export function fitImageSize(
  naturalWidth: number,
  naturalHeight: number,
  maxSize = 320,
): { width: number; height: number } {
  const nw = Math.max(1, naturalWidth)
  const nh = Math.max(1, naturalHeight)
  const scale = Math.min(1, maxSize / nw, maxSize / nh)
  return {
    width: Math.max(80, Math.round(nw * scale)),
    height: Math.max(60, Math.round(nh * scale)),
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

export async function collectAssets(
  imageIds: string[],
): Promise<Record<string, string>> {
  const assets: Record<string, string> = {}
  for (const id of imageIds) {
    const blob = await getImageBlob(id)
    if (!blob) continue
    assets[id] = await blobToDataUrl(blob)
  }
  return assets
}

export async function hydrateAssets(
  assets: Record<string, string> | undefined,
): Promise<void> {
  if (!assets || !activeBoardId) return
  for (const [id, dataUrl] of Object.entries(assets)) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) continue
    try {
      const blob = await dataUrlToBlob(dataUrl)
      await putImageBlob(id, blob)
    } catch {
      // skip corrupt asset
    }
  }
}


/** Read legacy IndexedDB blobs for one-time migration. */
export async function listLegacyImageIds(): Promise<string[]> {
  try {
    const db = await openDb()
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('list failed'))
    })
    db.close()
    return keys.filter((k): k is string => typeof k === 'string')
  } catch {
    return []
  }
}

export async function getLegacyImageBlob(
  id: string,
): Promise<Blob | undefined> {
  try {
    const db = await openDb()
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
      req.onsuccess = () => resolve(req.result as Blob | undefined)
      req.onerror = () => reject(req.error ?? new Error('get failed'))
    })
    db.close()
    return blob
  } catch {
    return undefined
  }
}

export async function clearLegacyImageDb(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('clear failed'))
    })
    db.close()
  } catch {
    // ignore
  }
}
