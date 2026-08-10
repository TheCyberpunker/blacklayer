export type DocumentKind = 'pdf' | 'image'

export interface RenderedPage {
  /** 0-based page index in the original document. */
  index: number
  /** Full preview-resolution bitmap. Drawn into the main canvas. */
  bitmap: ImageBitmap
  /** Small bitmap for the page-strip thumbnail. */
  thumbnail: ImageBitmap
  intrinsicWidth: number
  intrinsicHeight: number
}

export interface RenderedBase {
  kind: DocumentKind
  /** Number of pages actually rendered in `pages` (may be < totalPages when capped). */
  renderedPageCount: number
  /** Total pages in the source document. */
  totalPages: number
  pages: RenderedPage[]
}

const PREVIEW_LONG_EDGE = 1200
const THUMB_LONG_EDGE = 220
const MAX_PDF_PAGES = 20 // POC cap; real product will render on demand

export async function renderBase(file: File): Promise<RenderedBase> {
  const type = file.type.toLowerCase()
  if (type === 'application/pdf') {
    return await renderPdf(file)
  }
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') {
    const bitmap = await createImageBitmap(file)
    const thumb = await makeThumb(bitmap)
    return {
      kind: 'image',
      renderedPageCount: 1,
      totalPages: 1,
      pages: [
        {
          index: 0,
          bitmap,
          thumbnail: thumb,
          intrinsicWidth: bitmap.width,
          intrinsicHeight: bitmap.height,
        },
      ],
    }
  }
  throw new Error(`unsupported file type: ${file.type || 'unknown'}`)
}

async function renderPdf(file: File): Promise<RenderedBase> {
  const { ensurePdfjs } = await import('./pdfjs.ts')
  const pdfjs = ensurePdfjs()
  const buf = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) })
  const doc = await loadingTask.promise
  try {
    const totalPages = doc.numPages
    const pagesToRender = Math.min(MAX_PDF_PAGES, totalPages)
    const pages: RenderedPage[] = []

    for (let i = 0; i < pagesToRender; i++) {
      const page = await doc.getPage(i + 1)
      const rawViewport = page.getViewport({ scale: 1 })
      const longEdge = Math.max(rawViewport.width, rawViewport.height)
      const scale = Math.max(0.5, Math.min(3, PREVIEW_LONG_EDGE / longEdge))
      const viewport = page.getViewport({ scale })

      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) throw new Error('canvas 2d context unavailable')

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport, canvas }).promise

      const bitmap = await createImageBitmap(canvas)
      const thumb = await makeThumb(bitmap)
      pages.push({
        index: i,
        bitmap,
        thumbnail: thumb,
        intrinsicWidth: canvas.width,
        intrinsicHeight: canvas.height,
      })
    }

    return {
      kind: 'pdf',
      renderedPageCount: pagesToRender,
      totalPages,
      pages,
    }
  } finally {
    await doc.cleanup()
    loadingTask.destroy()
  }
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

export function releaseBase(base: RenderedBase | null | undefined): void {
  if (!base) return
  for (const p of base.pages) {
    p.bitmap.close?.()
    p.thumbnail.close?.()
  }
}
