import { mulberry32 } from '../random/prng.ts'
import type { WatermarkOptions } from '../types.ts'

/**
 * Shared canvas-2D drawing routine for the watermark overlay. Used by:
 *   - preview composite (live redraw in the UI)
 *   - image export (canvas.toBlob path)
 *
 * The PDF export path in src/core/pdf/watermark.ts mirrors the same math using
 * pdf-lib primitives. Both paths seed the same PRNG so the preview and the
 * exported artifact match visually.
 */
export interface DrawArgs {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  lines: string[]
  options: WatermarkOptions
  /** Font size after DPI/scale adjustment, in canvas pixels. */
  effectiveFontSize: number
  /** CSS-style color string, e.g. `rgba(...)`. */
  colorBase: (alpha: number) => string
  /** How to draw the actual glyphs. Defaults to ctx.fillText. */
  drawText?: (text: string, x: number, y: number) => void
}

export function drawWatermarkOnCanvas({
  ctx,
  width,
  height,
  lines,
  options,
  effectiveFontSize,
  colorBase,
  drawText,
}: DrawArgs): void {
  if (lines.every((l) => !l.trim())) {
    // Still draw patterns if requested, even without text.
    drawPatterns(ctx, width, height, options, colorBase)
    return
  }

  const lineHeight = effectiveFontSize * 1.2
  const rng = mulberry32(options.seed || 1)
  const centered = () => rng() - 0.5

  ctx.save()
  ctx.font = `bold ${effectiveFontSize}px Inter, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const paint = drawText ?? ((text, x, y) => ctx.fillText(text, x, y))

  if (options.tile) {
    const scaleFactor = Math.min(width, height) / 800
    const stepX = Math.max(160, options.tileGapX * scaleFactor)
    const stepY = Math.max(120, options.tileGapY * scaleFactor)
    const diagonal = Math.hypot(width, height)
    for (let y = -diagonal; y < diagonal * 2; y += stepY) {
      for (let x = -diagonal; x < diagonal * 2; x += stepX) {
        drawJitteredBlock(
          ctx,
          lines,
          x,
          y,
          options,
          effectiveFontSize,
          lineHeight,
          centered,
          rng,
          colorBase,
          paint,
        )
      }
    }
  } else {
    // Single centered block, no jitter for the "Basic" look.
    ctx.fillStyle = colorBase(options.opacity)
    drawBlock(ctx, lines, width / 2, height / 2, options.rotationDeg, lineHeight, paint)
  }
  ctx.restore()

  drawPatterns(ctx, width, height, options, colorBase)
}

function drawJitteredBlock(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  gridCx: number,
  gridCy: number,
  options: WatermarkOptions,
  fontSize: number,
  _lineHeight: number,
  centered: () => number,
  rng: () => number,
  colorBase: (alpha: number) => string,
  paint: (text: string, x: number, y: number) => void,
): void {
  const j = Math.max(0, Math.min(1, options.jitter))

  // Position jitter, up to ±40% of tile gap.
  const dx = centered() * options.tileGapX * 0.4 * j
  const dy = centered() * options.tileGapY * 0.4 * j
  const cx = gridCx + dx
  const cy = gridCy + dy

  // Rotation jitter, up to ±12° added to base.
  const rot = options.rotationDeg + centered() * 24 * j

  // Opacity jitter, multiplicative in [1 - 0.4j, 1 + 0.4j] clamped to [0.05, 1].
  const opacityMul = 1 + centered() * 0.8 * j
  const opacity = Math.max(0.05, Math.min(1, options.opacity * opacityMul))

  // Size jitter, multiplicative in [1 - 0.25j, 1 + 0.25j].
  const sizeMul = 1 + centered() * 0.5 * j
  const size = Math.max(10, fontSize * sizeMul)
  const lh = size * 1.2

  // Occasionally use a bolder or lighter weight variant via a random opacity band.
  const shouldEmphasize = j > 0.1 && rng() < 0.12
  const finalOpacity = shouldEmphasize ? Math.min(1, opacity * 1.7) : opacity

  ctx.save()
  ctx.font = `bold ${size}px Inter, system-ui, sans-serif`
  ctx.fillStyle = colorBase(finalOpacity)
  drawBlock(ctx, lines, cx, cy, rot, lh, paint)
  ctx.restore()
}

function drawBlock(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  cx: number,
  cy: number,
  rotationDeg: number,
  lineHeight: number,
  paint: (text: string, x: number, y: number) => void,
): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((rotationDeg * Math.PI) / 180)
  const startY = -((lines.length - 1) * lineHeight) / 2
  lines.forEach((text, i) => {
    if (text) paint(text, 0, startY + i * lineHeight)
  })
  ctx.restore()
}

function drawPatterns(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: WatermarkOptions,
  colorBase: (alpha: number) => string,
): void {
  if (options.patterns.crosshatch) {
    drawCrosshatch(ctx, width, height, options, colorBase)
  }
  if (options.patterns.frame) {
    drawFrame(ctx, width, height, options, colorBase)
  }
}

function drawCrosshatch(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: WatermarkOptions,
  colorBase: (alpha: number) => string,
): void {
  const scaleFactor = Math.min(width, height) / 800
  const spacing = Math.max(12, 22 * scaleFactor)
  const alpha = Math.max(0.03, options.opacity * 0.18)
  const diagonal = Math.hypot(width, height)

  ctx.save()
  ctx.strokeStyle = colorBase(alpha)
  ctx.lineWidth = Math.max(0.5, 0.6 * scaleFactor)

  // Direction 1: ~+30°
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate((30 * Math.PI) / 180)
  ctx.beginPath()
  for (let y = -diagonal; y <= diagonal; y += spacing) {
    ctx.moveTo(-diagonal, y)
    ctx.lineTo(diagonal, y)
  }
  ctx.stroke()
  ctx.restore()

  // Direction 2: ~-60° (perpendicular-ish for a real crosshatch feel)
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate((-60 * Math.PI) / 180)
  ctx.beginPath()
  for (let y = -diagonal; y <= diagonal; y += spacing * 1.4) {
    ctx.moveTo(-diagonal, y)
    ctx.lineTo(diagonal, y)
  }
  ctx.stroke()
  ctx.restore()

  ctx.restore()
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: WatermarkOptions,
  colorBase: (alpha: number) => string,
): void {
  const scaleFactor = Math.min(width, height) / 800
  const margin = Math.max(14, 24 * scaleFactor)
  const gap = Math.max(3, 5 * scaleFactor)
  const stroke = Math.max(0.8, 1.2 * scaleFactor)
  const alpha = Math.min(1, options.opacity * 1.4)

  ctx.save()
  ctx.strokeStyle = colorBase(alpha)
  ctx.lineWidth = stroke
  ctx.strokeRect(margin, margin, width - margin * 2, height - margin * 2)
  ctx.strokeRect(margin + gap, margin + gap, width - (margin + gap) * 2, height - (margin + gap) * 2)
  ctx.restore()
}
