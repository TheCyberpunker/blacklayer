/**
 * Pure canvas-based image transforms. Each returns a new Blob so the rest of
 * the pipeline (renderBase, protect, etc.) can treat the transformed image as
 * if it were freshly dropped by the user.
 */

export type OutputMime = 'image/jpeg' | 'image/png' | 'image/webp'

export interface AdjustResult {
  blob: Blob
  filename: string
}

function chooseMimeFrom(file: File): OutputMime {
  const t = file.type.toLowerCase()
  if (t === 'image/jpeg') return 'image/jpeg'
  if (t === 'image/webp') return 'image/webp'
  return 'image/png'
}

function stemAndExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' }
}

async function encode(canvas: HTMLCanvasElement, type: OutputMime, quality = 0.95): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas toBlob returned null'))),
      type,
      quality,
    )
  })
}

/**
 * Rotate an image. `degrees` must be a multiple of 90 (90, 180, 270, -90).
 * Any other value falls back to no rotation.
 */
export async function rotateImageFile(file: File, degrees: number): Promise<AdjustResult> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  const norm = ((degrees % 360) + 360) % 360
  const swap = norm === 90 || norm === 270
  canvas.width = swap ? bitmap.height : bitmap.width
  canvas.height = swap ? bitmap.width : bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((norm * Math.PI) / 180)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  ctx.restore()
  bitmap.close?.()
  const mime = chooseMimeFrom(file)
  const blob = await encode(canvas, mime)
  return { blob, filename: file.name }
}

/**
 * Desaturate an image to grayscale using standard perceptual weights.
 */
export async function grayscaleImageFile(file: File): Promise<AdjustResult> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    // ITU-R BT.601 luma weights.
    const y = px[i]! * 0.299 + px[i + 1]! * 0.587 + px[i + 2]! * 0.114
    px[i] = y
    px[i + 1] = y
    px[i + 2] = y
  }
  ctx.putImageData(data, 0, 0)
  const mime = chooseMimeFrom(file)
  const blob = await encode(canvas, mime)
  return { blob, filename: file.name }
}

/**
 * Wrap a Blob in a File so it can flow back through the normal file-drop path.
 */
export function fileFromBlob(blob: Blob, originalName: string, tag: string): File {
  const { stem, ext } = stemAndExt(originalName)
  return new File([blob], `${stem}${tag}${ext}`, { type: blob.type, lastModified: Date.now() })
}

/**
 * Crop an image to the given normalized rectangle (top-left origin, values in
 * 0..1). The output is bytes-of-the-crop-region only, so the resulting image is
 * strictly smaller than the input.
 */
export async function cropImageFile(
  file: File,
  rect: { x: number; y: number; w: number; h: number },
): Promise<AdjustResult> {
  const bitmap = await createImageBitmap(file)
  const sx = Math.max(0, Math.floor(rect.x * bitmap.width))
  const sy = Math.max(0, Math.floor(rect.y * bitmap.height))
  const sw = Math.min(bitmap.width - sx, Math.max(1, Math.floor(rect.w * bitmap.width)))
  const sh = Math.min(bitmap.height - sy, Math.max(1, Math.floor(rect.h * bitmap.height)))
  if (sw < 1 || sh < 1) {
    bitmap.close?.()
    throw new Error('crop rectangle is empty')
  }
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
  bitmap.close?.()
  const mime = chooseMimeFrom(file)
  const blob = await encode(canvas, mime)
  return { blob, filename: file.name }
}
