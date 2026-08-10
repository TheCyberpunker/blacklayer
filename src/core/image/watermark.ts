import type { ProtectionProfile } from '../types.ts'
import { formatWatermarkLines } from '../types.ts'

export interface ApplyImageWatermarkArgs {
  source: Blob
  profile: ProtectionProfile
  lang: 'en' | 'es'
  outputType?: 'image/png' | 'image/jpeg' | 'image/webp'
  quality?: number
}

/**
 * Draw the watermark onto a canvas seeded with the source image, then re-encode.
 *
 * Metadata handling: canvas.toBlob() re-encodes pixel data only and does not
 * carry EXIF/XMP/IPTC through. That means "neutralize" and "preserve" produce
 * the same output for images through this path. When we add a preserve-metadata
 * variant, we'll need to re-inject fields from a piexifjs read of the original.
 */
export async function applyImageWatermark({
  source,
  profile,
  lang,
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

  const options = profile.watermark
  const lines = formatWatermarkLines(options.text, lang)
  const scaleFactor = Math.min(canvas.width, canvas.height) / 800
  const fontSize = Math.max(18, Math.round(options.fontSize * scaleFactor))
  const lineHeight = fontSize * 1.2

  ctx.save()
  ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`
  ctx.fillStyle = `rgba(${Math.round(options.color.r * 255)}, ${Math.round(options.color.g * 255)}, ${Math.round(options.color.b * 255)}, ${options.opacity})`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (options.tile) {
    const stepX = Math.max(160, options.tileGapX * scaleFactor)
    const stepY = Math.max(120, options.tileGapY * scaleFactor)
    const diagonal = Math.hypot(canvas.width, canvas.height)
    for (let y = -diagonal; y < diagonal * 2; y += stepY) {
      for (let x = -diagonal; x < diagonal * 2; x += stepX) {
        drawBlock(ctx, lines, x, y, options.rotationDeg, lineHeight)
      }
    }
  } else {
    drawBlock(ctx, lines, canvas.width / 2, canvas.height / 2, options.rotationDeg, lineHeight)
  }

  ctx.restore()

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas toBlob returned null'))),
      outputType,
      quality,
    )
  })
}

function drawBlock(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  cx: number,
  cy: number,
  rotationDeg: number,
  lineHeight: number,
): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((rotationDeg * Math.PI) / 180)
  const startY = -((lines.length - 1) * lineHeight) / 2
  lines.forEach((text, i) => {
    ctx.fillText(text, 0, startY + i * lineHeight)
  })
  ctx.restore()
}
