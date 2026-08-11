import { PDFDocument } from 'pdf-lib'

/**
 * Guess whether a set of filenames represents the two sides of the same
 * document (front + back of a DNI, passport data page + observations, etc).
 * Returns the files sorted front-first when the pattern is unambiguous.
 */
const FRONT_TOKENS = ['front', 'anverso', 'cara-a', 'cara_a', 'caraa', 'frente', 'delante', 'a-cara']
const BACK_TOKENS = ['back', 'reverso', 'cara-b', 'cara_b', 'carab', 'reves', 'dorso', 'detras', 'b-cara']

export interface FrontBackDetection {
  detected: boolean
  ordered: readonly File[]
}

export function detectFrontBack(files: readonly File[]): FrontBackDetection {
  if (files.length !== 2) return { detected: false, ordered: files }
  const [a, b] = files
  const na = a!.name.toLowerCase()
  const nb = b!.name.toLowerCase()
  const aFront = FRONT_TOKENS.some((t) => na.includes(t))
  const bFront = FRONT_TOKENS.some((t) => nb.includes(t))
  const aBack = BACK_TOKENS.some((t) => na.includes(t))
  const bBack = BACK_TOKENS.some((t) => nb.includes(t))

  if (aFront && bBack) return { detected: true, ordered: [a!, b!] }
  if (aBack && bFront) return { detected: true, ordered: [b!, a!] }

  // Numeric hint: foo-1.jpg + foo-2.jpg (with the same stem)
  const numMatch = /^(.*?)[-_. ]?(\d+)$/
  const stripExt = (n: string) => n.replace(/\.[^.]+$/, '')
  const ma = numMatch.exec(stripExt(na))
  const mb = numMatch.exec(stripExt(nb))
  if (ma && mb && ma[1] && mb[1] && ma[1] === mb[1]) {
    const ia = parseInt(ma[2]!, 10)
    const ib = parseInt(mb[2]!, 10)
    if (!isNaN(ia) && !isNaN(ib) && ia !== ib) {
      return { detected: true, ordered: ia < ib ? [a!, b!] : [b!, a!] }
    }
  }

  return { detected: false, ordered: files }
}

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
