import { PDFDocument } from 'pdf-lib'
import type { RedactionRect } from '../types.ts'
import { applyRedactionsToCanvas } from '../redact/apply.ts'

/**
 * Render a single page from a source PDF via pdfjs, apply redactions to the
 * pixel data, embed the resulting bitmap as a PNG image page in `targetDoc`,
 * and return the new page (already inserted at `insertIndex`).
 *
 * Callers use this to replace an original page whose redactions overlap text
 * (rasterization guarantees the underlying text is gone).
 */
export interface RasterizeArgs {
  sourceBytes: ArrayBuffer
  sourcePageIndex: number
  targetDoc: PDFDocument
  insertIndex: number
  redactions: readonly RedactionRect[]
  dpi?: number
}

export async function rasterizePageWithRedactions({
  sourceBytes,
  sourcePageIndex,
  targetDoc,
  insertIndex,
  redactions,
  dpi = 150,
}: RasterizeArgs): Promise<void> {
  // Lazy import so Node / non-browser callers of applyPdfWatermark (e.g. unit tests
  // that never trigger redaction) do not pull in the pdfjs worker URL binding,
  // which is a Vite-only import syntax.
  const { ensurePdfjs } = await import('../preview/pdfjs.ts')
  const pdfjs = ensurePdfjs()
  // pdfjs transfers the underlying ArrayBuffer to its worker. Rasterizing more
  // than one page from the same source would detach the buffer between calls,
  // throwing "Cannot perform Construct on a detached ArrayBuffer". Copy the
  // bytes so each call owns its own buffer.
  const dataCopy = new Uint8Array(sourceBytes.byteLength)
  dataCopy.set(new Uint8Array(sourceBytes))
  const loadingTask = pdfjs.getDocument({ data: dataCopy })
  const doc = await loadingTask.promise
  try {
    const page = await doc.getPage(sourcePageIndex + 1)
    const scale = dpi / 72
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('canvas 2d context unavailable')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvasContext: ctx, viewport, canvas }).promise

    if (redactions.length) {
      applyRedactionsToCanvas(ctx, redactions, canvas.width, canvas.height)
    }

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png')
    })
    const pngBytes = new Uint8Array(await pngBlob.arrayBuffer())
    const png = await targetDoc.embedPng(pngBytes)

    // Match the ORIGINAL page dimensions (in points), not the rendered pixel dims.
    const rawViewport = page.getViewport({ scale: 1 })
    const pageWidth = rawViewport.width
    const pageHeight = rawViewport.height

    const newPage = targetDoc.insertPage(insertIndex, [pageWidth, pageHeight])
    newPage.drawImage(png, { x: 0, y: 0, width: pageWidth, height: pageHeight })
  } finally {
    await doc.cleanup()
    loadingTask.destroy()
  }
}
