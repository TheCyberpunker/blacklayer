import { ensurePdfjs } from './pdfjs.ts'

export type DocumentKind = 'pdf' | 'image'

export interface RenderedBase {
  bitmap: ImageBitmap
  kind: DocumentKind
  pageCount: number
  intrinsicWidth: number
  intrinsicHeight: number
}

/**
 * Render the first "visual page" of a File to an ImageBitmap so the UI can
 * composite watermarks on top in real time. For images this is the image itself.
 * For PDFs this is the first page rasterized via pdfjs at a preview-friendly DPR.
 */
export async function renderBase(file: File, targetLongEdge = 1200): Promise<RenderedBase> {
  const type = file.type.toLowerCase()
  if (type === 'application/pdf') {
    return await renderPdfFirstPage(file, targetLongEdge)
  }
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') {
    const bitmap = await createImageBitmap(file)
    return {
      bitmap,
      kind: 'image',
      pageCount: 1,
      intrinsicWidth: bitmap.width,
      intrinsicHeight: bitmap.height,
    }
  }
  throw new Error(`unsupported file type: ${file.type || 'unknown'}`)
}

async function renderPdfFirstPage(file: File, targetLongEdge: number): Promise<RenderedBase> {
  const pdfjs = ensurePdfjs()
  const buf = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) })
  const doc = await loadingTask.promise
  try {
    const page = await doc.getPage(1)
    const rawViewport = page.getViewport({ scale: 1 })
    const longEdge = Math.max(rawViewport.width, rawViewport.height)
    const scale = Math.max(0.5, Math.min(4, targetLongEdge / longEdge))
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

    return {
      bitmap,
      kind: 'pdf',
      pageCount: doc.numPages,
      intrinsicWidth: canvas.width,
      intrinsicHeight: canvas.height,
    }
  } finally {
    await doc.cleanup()
    loadingTask.destroy()
  }
}
