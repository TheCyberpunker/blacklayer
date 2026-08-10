import type { RedactionRect, WatermarkOptions } from '../types.ts'
import { formatWatermarkLines } from '../types.ts'
import type { Lang } from '../../hooks/use-lang.ts'
import type { RenderedPage } from './render.ts'
import { drawWatermarkOnCanvas } from '../watermark/draw.ts'
import { applyRedactionsToCanvas } from '../redact/apply.ts'

export interface CompositeArgs {
  target: HTMLCanvasElement
  page: RenderedPage
  options: WatermarkOptions
  lang: Lang
  redactions?: readonly RedactionRect[]
  activeRect?: RedactionRect | null
}

export function composite({
  target,
  page,
  options,
  lang,
  redactions,
  activeRect,
}: CompositeArgs): void {
  const ctx = target.getContext('2d', { alpha: false })
  if (!ctx) return

  target.width = page.intrinsicWidth
  target.height = page.intrinsicHeight

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, target.width, target.height)
  ctx.drawImage(page.bitmap, 0, 0, target.width, target.height)

  if (redactions && redactions.length) {
    applyRedactionsToCanvas(ctx, redactions, target.width, target.height)
  }
  if (activeRect) {
    drawActiveDragOverlay(ctx, target.width, target.height, activeRect)
  }

  const lines = formatWatermarkLines(options.text, lang)
  const scaleFactor = Math.min(target.width, target.height) / 800
  const fontSize = Math.max(16, Math.round(options.fontSize * scaleFactor))
  const { r, g, b } = options.color
  const rr = Math.round(r * 255)
  const gg = Math.round(g * 255)
  const bb = Math.round(b * 255)
  const colorBase = (alpha: number) => `rgba(${rr}, ${gg}, ${bb}, ${alpha})`

  drawWatermarkOnCanvas({
    ctx,
    width: target.width,
    height: target.height,
    lines,
    options,
    effectiveFontSize: fontSize,
    colorBase,
  })
}

/**
 * Semi-transparent fill + dashed outline for the rectangle currently being
 * dragged. This is a UI affordance, not the final look of the redaction.
 */
function drawActiveDragOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rect: RedactionRect,
): void {
  const rx = Math.round(rect.x * w)
  const ry = Math.round(rect.y * h)
  const rw = Math.round(rect.w * w)
  const rh = Math.round(rect.h * h)
  if (rw <= 0 || rh <= 0) return
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.fillRect(rx, ry, rw, rh)
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 2
  ctx.setLineDash([6, 4])
  ctx.strokeRect(rx, ry, rw, rh)
  ctx.restore()
}

/**
 * Draw just the base page bitmap to a target canvas, at the same intrinsic
 * size as the composite. Used by the "before/after" compare mode.
 */
export function drawOriginal(target: HTMLCanvasElement, page: RenderedPage): void {
  const ctx = target.getContext('2d', { alpha: false })
  if (!ctx) return
  target.width = page.intrinsicWidth
  target.height = page.intrinsicHeight
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, target.width, target.height)
  ctx.drawImage(page.bitmap, 0, 0, target.width, target.height)
}
