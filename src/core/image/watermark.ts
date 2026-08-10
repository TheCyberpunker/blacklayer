import type { ProtectionProfile, RedactionRect } from '../types.ts'
import { formatWatermarkLines } from '../types.ts'
import { applyRedactionsToCanvas } from '../redact/apply.ts'
import { drawWatermarkOnCanvas } from '../watermark/draw.ts'

export interface ApplyImageWatermarkArgs {
  source: Blob
  profile: ProtectionProfile
  lang: 'en' | 'es'
  redactions?: readonly RedactionRect[]
  outputType?: 'image/png' | 'image/jpeg' | 'image/webp'
  quality?: number
}

/**
 * Draw redactions, then watermark, then re-encode. Metadata is dropped by the
 * canvas re-encode (see note in the previous revision).
 */
export async function applyImageWatermark({
  source,
  profile,
  lang,
  redactions,
  outputType = 'image/png',
  quality = 0.92,
}: ApplyImageWatermarkArgs): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()

  if (redactions?.length) {
    applyRedactionsToCanvas(ctx, redactions, canvas.width, canvas.height)
  }

  const options = profile.watermark
  const lines = formatWatermarkLines(options.text, lang)
  const scaleFactor = Math.min(canvas.width, canvas.height) / 800
  const fontSize = Math.max(18, Math.round(options.fontSize * scaleFactor))
  const { r, g, b } = options.color
  const rr = Math.round(r * 255)
  const gg = Math.round(g * 255)
  const bb = Math.round(b * 255)
  const colorBase = (alpha: number) => `rgba(${rr}, ${gg}, ${bb}, ${alpha})`

  drawWatermarkOnCanvas({
    ctx,
    width: canvas.width,
    height: canvas.height,
    lines,
    options,
    effectiveFontSize: fontSize,
    colorBase,
  })

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas toBlob returned null'))),
      outputType,
      quality,
    )
  })
}
