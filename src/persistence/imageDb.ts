const DB_NAME = 'fusen-whiteboard-images'
const STORE = 'images'
const DB_VERSION = 1

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

function storeTx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE)
}

export async function putImageBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('putImageBlob failed'))
  })
  db.close()
}

export async function getImageBlob(id: string): Promise<Blob | undefined> {
  const db = await openDb()
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const req = storeTx(db, 'readonly').get(id)
    req.onsuccess = () => resolve(req.result as Blob | undefined)
    req.onerror = () => reject(req.error ?? new Error('getImageBlob failed'))
  })
  db.close()
  return blob
}

export async function deleteImageBlobs(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const id of ids) store.delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('deleteImageBlobs failed'))
  })
  db.close()
}

export async function listImageIds(): Promise<string[]> {
  const db = await openDb()
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const req = storeTx(db, 'readonly').getAllKeys()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('listImageIds failed'))
  })
  db.close()
  return keys.filter((k): k is string => typeof k === 'string')
}

const urlCache = new Map<string, string>()

export async function resolveImageUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id)
  if (cached) return cached
  const blob = await getImageBlob(id)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urlCache.set(id, url)
  return url
}

export function revokeImageUrl(id: string): void {
  const url = urlCache.get(id)
  if (!url) return
  URL.revokeObjectURL(url)
  urlCache.delete(id)
}

export function revokeAllImageUrls(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
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
  if (!assets) return
  for (const [id, dataUrl] of Object.entries(assets)) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) continue
    try {
      const blob = await dataUrlToBlob(dataUrl)
      await putImageBlob(id, blob)
      revokeImageUrl(id)
    } catch {
      // skip corrupt asset
    }
  }
}

export async function gcUnusedImages(keepIds: Iterable<string>): Promise<void> {
  const keep = new Set(keepIds)
  const existing = await listImageIds()
  const stale = existing.filter((id) => !keep.has(id))
  for (const id of stale) revokeImageUrl(id)
  await deleteImageBlobs(stale)
}
