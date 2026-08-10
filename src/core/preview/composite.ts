import type { RedactionRect, WatermarkOptions } from '../types.ts'
import { formatWatermarkLines } from '../types.ts'
import type { Lang } from '../../hooks/use-lang.ts'
import type { RenderedPage } from './render.ts'
import { drawWatermarkOnCanvas } from '../watermark/draw.ts'

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
    drawRedactions(ctx, target.width, target.height, redactions, false)
  }
  if (activeRect) {
    drawRedactions(ctx, target.width, target.height, [activeRect], true)
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

function drawRedactions(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rects: readonly RedactionRect[],
  active: boolean,
): void {
  ctx.save()
  ctx.fillStyle = active ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.9)'
  if (active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
  }
  for (const r of rects) {
    const rx = Math.round(r.x * w)
    const ry = Math.round(r.y * h)
    const rw = Math.round(r.w * w)
    const rh = Math.round(r.h * h)
    if (rw <= 0 || rh <= 0) continue
    ctx.fillRect(rx, ry, rw, rh)
    if (active) ctx.strokeRect(rx, ry, rw, rh)
  }
  ctx.restore()
}
