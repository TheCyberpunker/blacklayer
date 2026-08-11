import { PDFDocument } from 'pdf-lib'

/**
 * Build a single PDF whose pages are the input images, one image per page.
 *
 * Used by the "combine as one PDF" action so a user with two photos (e.g. DNI
 * front + DNI back) can protect both as a single 2-page document with per-page
 * templates and redactions.
 *
 * Each page size matches the intrinsic image size in points (1 image px = 1 pt),
 * which keeps the aspect ratio faithful.
 */
export async function combineImagesToPdf(files: readonly File[]): Promise<Blob> {
  if (!files.length) throw new Error('combineImagesToPdf: no files')
  const pdf = await PDFDocument.create({ updateMetadata: false })
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const type = file.type.toLowerCase()
    let image
    if (type === 'image/jpeg') {
      image = await pdf.embedJpg(bytes)
    } else if (type === 'image/png') {
      image = await pdf.embedPng(bytes)
    } else if (type === 'image/webp') {
      // pdf-lib does not embed webp directly; convert via canvas to PNG.
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas 2d context unavailable')
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close?.()
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
          'image/png',
        )
      })
      image = await pdf.embedPng(new Uint8Array(await png.arrayBuffer()))
    } else {
      throw new Error(`combineImagesToPdf: unsupported image type ${file.type || 'unknown'}`)
    }
    const page = pdf.addPage([image.width, image.height])
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  }
  const out = await pdf.save()
  return new Blob([out as unknown as ArrayBuffer], { type: 'application/pdf' })
}
