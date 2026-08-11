export type DocumentKind = 'pdf' | 'image'

export interface RenderedThumb {
  index: number
  thumbnail: ImageBitmap
  /** Full preview-resolution dimensions of this page in canvas pixels. */
  intrinsicWidth: number
  intrinsicHeight: number
}

export interface RenderedPage {
  index: number
  bitmap: ImageBitmap
  intrinsicWidth: number
  intrinsicHeight: number
}

export interface RenderedBase {
  kind: DocumentKind
  totalPages: number
  thumbnails: RenderedThumb[]
  /** Resolves the full preview-resolution bitmap for a page. Cached with an LRU. */
  getPage: (index: number) => Promise<RenderedPage>
  /** Close all bitmaps and destroy the underlying pdfjs task, if any. */
  release: () => void
}

const PREVIEW_LONG_EDGE = 1200
const THUMB_LONG_EDGE = 220
const PAGE_CACHE_SIZE = 5

/**
 * Prepare a document for viewing and protecting.
 *
 * For images: renders the source directly and returns a single "page".
 * For PDFs: renders a thumbnail for every page up-front (cheap, small), keeps
 * the pdfjs document open so the full preview-resolution bitmap for any page
 * can be produced on demand via getPage(), and caches the last few renders in
 * an LRU. The 20-page cap the previous revision imposed is gone.
 */
export async function renderBase(file: File): Promise<RenderedBase> {
  const type = file.type.toLowerCase()
  if (type === 'application/pdf') {
    return await renderPdf(file)
  }
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') {
    return await renderImage(file)
  }
  throw new Error(`unsupported file type: ${file.type || 'unknown'}`)
}

async function renderImage(file: File): Promise<RenderedBase> {
  const bitmap = await createImageBitmap(file)
  const thumbnail = await makeThumb(bitmap)
  const page: RenderedPage = {
    index: 0,
    bitmap,
    intrinsicWidth: bitmap.width,
    intrinsicHeight: bitmap.height,
  }
  const thumb: RenderedThumb = {
    index: 0,
    thumbnail,
    intrinsicWidth: bitmap.width,
    intrinsicHeight: bitmap.height,
  }
  let released = false
  return {
    kind: 'image',
    totalPages: 1,
    thumbnails: [thumb],
    getPage: async () => page,
    release: () => {
      if (released) return
      released = true
      bitmap.close?.()
      thumbnail.close?.()
    },
  }
}

async function renderPdf(file: File): Promise<RenderedBase> {
  const { ensurePdfjs } = await import('./pdfjs.ts')
  const pdfjs = ensurePdfjs()
  // Own our own bytes: pdfjs transfers the underlying ArrayBuffer to its worker
  // and other paths (protect, inspectPdf, text search) read from the same File
  // afterwards.
  const buf = await file.arrayBuffer()
  const data = new Uint8Array(buf.byteLength)
  data.set(new Uint8Array(buf))
  const loadingTask = pdfjs.getDocument({ data })
  const doc = await loadingTask.promise
  const totalPages = doc.numPages

  // Collect intrinsic dimensions and thumbnails for every page.
  const thumbnails: RenderedThumb[] = []
  for (let i = 0; i < totalPages; i++) {
    const page = await doc.getPage(i + 1)
    try {
      const raw = page.getViewport({ scale: 1 })
      const longEdge = Math.max(raw.width, raw.height)
      const previewScale = Math.max(0.5, Math.min(3, PREVIEW_LONG_EDGE / longEdge))
      const previewViewport = page.getViewport({ scale: previewScale })
      const intrinsicWidth = Math.max(1, Math.floor(previewViewport.width))
      const intrinsicHeight = Math.max(1, Math.floor(previewViewport.height))

      const thumbnail = await renderPdfPageToBitmap(page, THUMB_LONG_EDGE / longEdge)
      thumbnails.push({ index: i, thumbnail, intrinsicWidth, intrinsicHeight })
    } finally {
      page.cleanup?.()
    }
  }

  // LRU cache for full-resolution page bitmaps.
  const cache = new Map<number, RenderedPage>()
  const evict = (): void => {
    while (cache.size > PAGE_CACHE_SIZE) {
      const oldestKey = cache.keys().next().value
      if (oldestKey === undefined) break
      const old = cache.get(oldestKey)
      cache.delete(oldestKey)
      old?.bitmap.close?.()
    }
  }

  const getPage = async (index: number): Promise<RenderedPage> => {
    if (index < 0 || index >= totalPages) {
      throw new Error(`page index ${index} out of range (0..${totalPages - 1})`)
    }
    const cached = cache.get(index)
    if (cached) {
      // Refresh LRU position.
      cache.delete(index)
      cache.set(index, cached)
      return cached
    }
    const page = await doc.getPage(index + 1)
    try {
      const raw = page.getViewport({ scale: 1 })
      const longEdge = Math.max(raw.width, raw.height)
      const scale = Math.max(0.5, Math.min(3, PREVIEW_LONG_EDGE / longEdge))
      const bitmap = await renderPdfPageToBitmap(page, scale)
      const thumb = thumbnails[index]
      const rendered: RenderedPage = {
        index,
        bitmap,
        intrinsicWidth: thumb?.intrinsicWidth ?? bitmap.width,
        intrinsicHeight: thumb?.intrinsicHeight ?? bitmap.height,
      }
      cache.set(index, rendered)
      evict()
      return rendered
    } finally {
      page.cleanup?.()
    }
  }

  let released = false
  const release = (): void => {
    if (released) return
    released = true
    for (const t of thumbnails) t.thumbnail.close?.()
    for (const p of cache.values()) p.bitmap.close?.()
    cache.clear()
    // Best-effort. cleanup returns a promise; we do not await during teardown.
    void doc.cleanup()
    loadingTask.destroy()
  }

  return {
    kind: 'pdf',
    totalPages,
    thumbnails,
    getPage,
    release,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderPdfPageToBitmap(page: any, scale: number): Promise<ImageBitmap> {
  const viewport = page.getViewport({ scale: Math.max(0.05, scale) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  return await createImageBitmap(canvas)
}

async function makeThumb(source: ImageBitmap): Promise<ImageBitmap> {
  const longEdge = Math.max(source.width, source.height)
  const scale = Math.min(1, THUMB_LONG_EDGE / longEdge)
  const w = Math.max(1, Math.round(source.width * scale))
  const h = Math.max(1, Math.round(source.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return await createImageBitmap(canvas)
}

/**
 * Backward-compatible releaser used by callers that only kept a RenderedBase
 * reference and want to free its bitmaps.
 */
export function releaseBase(base: RenderedBase | null | undefined): void {
  base?.release()
}
