import { PDFDocument } from 'pdf-lib'
import { ensurePdfjs } from '../preview/pdfjs.ts'
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
  const pdfjs = ensurePdfjs()
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(sourceBytes) })
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
