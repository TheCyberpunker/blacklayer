/**
 * Render every page of a PDF (already-protected bytes) into a PNG. Used by the
 * "Individual images" output path so a user who combined front+back photos of
 * an ID can still download two independent PNGs rather than a single PDF.
 *
 * Runs in the browser (needs canvas 2D). Caller passes the finished PDF bytes;
 * this module has no knowledge of watermarking or redactions.
 */
export async function rasterizeAllPagesToPng(
  sourceBytes: Uint8Array,
  dpi = 150,
): Promise<Uint8Array[]> {
  const { ensurePdfjs } = await import('../preview/pdfjs.ts')
  const pdfjs = ensurePdfjs()
  // Copy the bytes because pdfjs transfers to its worker. The caller's buffer
  // would otherwise be detached and cannot be reused.
  const dataCopy = new Uint8Array(sourceBytes.byteLength)
  dataCopy.set(sourceBytes)
  const loadingTask = pdfjs.getDocument({ data: dataCopy })
  const results: Uint8Array[] = []
  try {
    const doc = await loadingTask.promise
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
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
      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png')
      })
      results.push(new Uint8Array(await pngBlob.arrayBuffer()))
    }
    await doc.cleanup()
  } finally {
    loadingTask.destroy()
  }
  return results
}
