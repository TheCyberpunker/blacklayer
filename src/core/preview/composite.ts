import type { WatermarkOptions } from '../types.ts'
import { formatWatermarkLines } from '../types.ts'
import type { Lang } from '../../hooks/use-lang.ts'
import type { RenderedBase } from './render.ts'

export interface CompositeArgs {
  target: HTMLCanvasElement
  base: RenderedBase
  options: WatermarkOptions
  lang: Lang
}

/**
 * Draw base bitmap plus watermark overlay onto target canvas.
 * Cheap enough to run on every keystroke for typical documents.
 */
export function composite({ target, base, options, lang }: CompositeArgs): void {
  const ctx = target.getContext('2d', { alpha: false })
  if (!ctx) return

  target.width = base.intrinsicWidth
  target.height = base.intrinsicHeight

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, target.width, target.height)
  ctx.drawImage(base.bitmap, 0, 0, target.width, target.height)

  const lines = formatWatermarkLines(options.text, lang)
  if (lines.every((l) => !l.trim())) return

  const scaleFactor = Math.min(target.width, target.height) / 800
  const fontSize = Math.max(16, Math.round(options.fontSize * scaleFactor))
  const lineHeight = fontSize * 1.2

  ctx.save()
  ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`
  const { r, g, b } = options.color
  ctx.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${options.opacity})`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (options.tile) {
    const stepX = Math.max(160, options.tileGapX * scaleFactor)
    const stepY = Math.max(120, options.tileGapY * scaleFactor)
    const diagonal = Math.hypot(target.width, target.height)
    for (let y = -diagonal; y < diagonal * 2; y += stepY) {
      for (let x = -diagonal; x < diagonal * 2; x += stepX) {
        drawBlock(ctx, lines, x, y, options.rotationDeg, lineHeight)
      }
    }
  } else {
    drawBlock(ctx, lines, target.width / 2, target.height / 2, options.rotationDeg, lineHeight)
  }

  ctx.restore()
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
    if (text) ctx.fillText(text, 0, startY + i * lineHeight)
  })
  ctx.restore()
}
