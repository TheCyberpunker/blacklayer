import type { WatermarkOptions } from '../types.ts'
import { drawWavyPage } from './wavy.ts'
import { mulberry32 } from '../random/prng.ts'

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
}

export function drawWatermarkOnCanvas({
  ctx,
  width,
  height,
  lines,
  options,
  effectiveFontSize,
  colorBase,
}: DrawArgs): void {
  const hasText = lines.some((l) => l.trim())

  if (hasText) {
    if (options.tile) {
      // Wavy microtext pattern (security-document style). Small font, sinusoidal
      // paths, dense coverage. options.fontSize is the base; scaleFactor keeps
      // the pattern legible on both preview canvases and huge PDFs.
      const scaleFactor = Math.min(width, height) / 800
      const wavyFontSize = Math.max(6, Math.round(options.fontSize * scaleFactor))
      const rowText = lines.filter((l) => l.trim()).join('  ·  ')
      drawWavyPage({
        ctx,
        width,
        height,
        text: rowText,
        fontSize: wavyFontSize,
        opacity: options.opacity,
        color: colorBase,
        seed: options.seed,
        baseRotationDeg: options.rotationDeg,
      })
    } else {
      // Single centered mark: keep the readable large text used by "Basic".
      drawSingleMark(ctx, lines, width, height, options, effectiveFontSize, colorBase)
    }
  }

  if (options.patterns.iridescent) drawIridescent(ctx, width, height, options)
  if (options.patterns.guilloche) drawGuilloche(ctx, width, height, options, colorBase)
  if (options.patterns.moire) drawMoire(ctx, width, height, options, colorBase)
  if (options.patterns.crosshatch) drawCrosshatch(ctx, width, height, options, colorBase)
  if (options.patterns.frame) drawFrame(ctx, width, height, options, colorBase)
}

/**
 * Moiré interference overlay — two fine parallel grids drawn on top of each
 * other with slightly different angles. Where the lines cross at low angles
 * they produce the visible beat pattern that gives moiré its distinctive
 * shimmer. Anti-copy printing has used it for decades because a photocopy or
 * downscaled screenshot distorts the fringe visibly. Low opacity keeps the
 * document readable underneath.
 */
function drawMoire(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: WatermarkOptions,
  colorBase: (alpha: number) => string,
): void {
  const scaleFactor = Math.min(width, height) / 800
  const spacing = Math.max(3, 4.5 * scaleFactor)
  const alpha = Math.max(0.09, Math.min(0.22, options.opacity * 0.42))
  const stroke = Math.max(0.5, 0.7 * scaleFactor)
  const diagonal = Math.hypot(width, height)

  const drawGrid = (angleDeg: number) => {
    ctx.save()
    ctx.translate(width / 2, height / 2)
    ctx.rotate((angleDeg * Math.PI) / 180)
    ctx.beginPath()
    for (let y = -diagonal; y <= diagonal; y += spacing) {
      ctx.moveTo(-diagonal, y)
      ctx.lineTo(diagonal, y)
    }
    ctx.stroke()
    ctx.restore()
  }

  ctx.save()
  ctx.strokeStyle = colorBase(alpha)
  ctx.lineWidth = stroke
  // Two grids ~7° apart — small enough that the interference fringe reads,
  // large enough that neither grid looks like a simple screen texture.
  drawGrid(11)
  drawGrid(18)
  ctx.restore()
}

/**
 * Decorative guilloche pattern — a family of Lissajous curves layered at low
 * alpha, evocative of the fine interwoven line-work found on banknotes and
 * official certificates. Purely visual; document content stays readable. Not a
 * claim of authenticity, and the curve parameters are jittered per seed so it
 * doesn't match any real security print.
 */
function drawGuilloche(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: WatermarkOptions,
  colorBase: (alpha: number) => string,
): void {
  const scaleFactor = Math.min(width, height) / 800
  const alpha = Math.max(0.1, Math.min(0.28, options.opacity * 0.55))
  const stroke = Math.max(0.5, 0.75 * scaleFactor)
  const rng = mulberry32(options.seed || 1)
  const cx = width / 2
  const cy = height / 2
  const rx = width * 0.42
  const ry = height * 0.42

  const curves = 5
  const steps = 720

  ctx.save()
  ctx.strokeStyle = colorBase(alpha)
  ctx.lineWidth = stroke
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  for (let i = 0; i < curves; i++) {
    // Distinct Lissajous frequency pair + phase per curve so the family
    // weaves without repeating exactly.
    const a = 3 + Math.floor(rng() * 4)
    const b = 4 + Math.floor(rng() * 4)
    const phase = rng() * Math.PI * 2
    const rot = (rng() - 0.5) * 0.6
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)

    ctx.beginPath()
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * Math.PI * 2
      const lx = Math.sin(a * t + phase) * rx
      const ly = Math.sin(b * t) * ry
      const x = cx + lx * cos - ly * sin
      const y = cy + lx * sin + ly * cos
      if (s === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * Decorative iridescent overlay — diagonal linear gradient across magenta,
 * cyan, and gold at low alpha, plus a fine dot texture on top. Intentionally
 * reads as an added visual layer rather than as a real security foil, so that
 * a viewer cannot mistake the exported copy for a genuine, holographically
 * laminated document.
 */
function drawIridescent(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: WatermarkOptions,
): void {
  // Gradient alpha scales with base opacity so it stays roughly in visual sync
  // with the text mark. Clamped so it never overpowers the document content.
  const gradAlpha = Math.max(0.06, Math.min(0.18, options.opacity * 0.5))
  ctx.save()
  const g = ctx.createLinearGradient(0, 0, width, height)
  g.addColorStop(0, `rgba(255, 0, 214, ${gradAlpha})`) // magenta
  g.addColorStop(0.35, `rgba(0, 199, 255, ${gradAlpha})`) // cyan
  g.addColorStop(0.7, `rgba(140, 255, 100, ${gradAlpha * 0.8})`) // green tint
  g.addColorStop(1, `rgba(255, 194, 0, ${gradAlpha})`) // gold
  ctx.fillStyle = g
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillRect(0, 0, width, height)
  ctx.restore()

  // Fine dot texture on top — a sparse grid of ~1px white dots at very low
  // alpha, which adds a subtle "print" grain that reads as decorative rather
  // than as a genuine security feature.
  const scaleFactor = Math.min(width, height) / 800
  const step = Math.max(6, 8 * scaleFactor)
  const dotAlpha = Math.max(0.05, Math.min(0.15, options.opacity * 0.4))
  const radius = Math.max(0.4, 0.6 * scaleFactor)
  ctx.save()
  ctx.fillStyle = `rgba(255, 255, 255, ${dotAlpha})`
  for (let y = step / 2; y < height; y += step) {
    for (let x = step / 2; x < width; x += step) {
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

function drawSingleMark(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  width: number,
  height: number,
  options: WatermarkOptions,
  fontSize: number,
  colorBase: (alpha: number) => string,
): void {
  const lineHeight = fontSize * 1.2
  ctx.save()
  ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`
  ctx.fillStyle = colorBase(options.opacity)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.translate(width / 2, height / 2)
  ctx.rotate((options.rotationDeg * Math.PI) / 180)
  const startY = -((lines.length - 1) * lineHeight) / 2
  lines.forEach((text, i) => {
    if (text) ctx.fillText(text, 0, startY + i * lineHeight)
  })
  ctx.restore()
}

function drawCrosshatch(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: WatermarkOptions,
  colorBase: (alpha: number) => string,
): void {
  const scaleFactor = Math.min(width, height) / 800
  const spacing = Math.max(14, 20 * scaleFactor)
  const alpha = Math.max(0.12, Math.min(0.32, options.opacity * 0.55))
  const diagonal = Math.hypot(width, height)

  ctx.save()
  ctx.strokeStyle = colorBase(alpha)
  ctx.lineWidth = Math.max(1, 1.4 * scaleFactor)

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
