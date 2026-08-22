import { mulberry32 } from '../random/prng.ts'

/**
 * Wavy microtext watermark. Text runs along sinusoidal paths, one glyph at a
 * time, rotated to match the local tangent. Modelled after security-document
 * background print and the datosargentinos.com watermark technique, which uses
 * a two-layer paint (shadow + main) so the pattern reads as a texture rather
 * than as thin scratchy text.
 */

export interface WavyPageArgs {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  text: string
  fontSize: number
  opacity: number
  color: (alpha: number) => string
  seed: number
  /** Base rotation of the whole pattern, degrees. */
  baseRotationDeg: number
  /**
   * 0..1. 1 = current sinusoidal look. 0 = flat rows (straight diagonal tile).
   * Anything in between scales both wave amplitude and inter-row breathing so
   * rows never visually overlap even at max waviness.
   */
  waviness?: number
}

export function drawWavyPage({
  ctx,
  width,
  height,
  text,
  fontSize,
  opacity,
  color,
  seed,
  baseRotationDeg,
  waviness = 1,
}: WavyPageArgs): void {
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate((baseRotationDeg * Math.PI) / 180)

  // Cover the whole page even after rotation.
  const diag = Math.hypot(width, height)
  const halfW = diag / 2
  const halfH = diag / 2

  ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  // rowGap must always leave enough clear space between the furthest reach of
  // adjacent rows, even at max waviness. Wavelength kept short enough that the
  // pattern reads as many small waves per row, not two big lazy curves.
  const w = Math.max(0, Math.min(1, waviness))
  const amplitude = fontSize * (0.9 * w)
  const rowGap = fontSize * (2.6 + w * 1.6)
  const wavelength = Math.max(fontSize * 4, width * 0.2)
  const omega = (2 * Math.PI) / wavelength
  const rng = mulberry32(seed || 1)

  const rowText = text.replace(/\s+/g, ' ').trim() + '   '
  const chars = [...rowText]

  // Two paint passes per row: a subtle shadow (deeper opacity, +1 px offset)
  // and the main run. Together the pattern reads as a printed texture.
  const shadowAlpha = Math.max(0.05, opacity * 0.35)
  const mainAlpha = opacity

  for (let y = -halfH; y <= halfH; y += rowGap) {
    const yOffset = (rng() - 0.5) * fontSize * 0.15
    const phase = rng() * Math.PI * 2
    const baseY = y + yOffset

    let idx = 0
    let dist = 0
    const totalLen = halfW * 2
    while (dist < totalLen) {
      const ch = chars[idx % chars.length] || ' '
      idx++
      const cw = ctx.measureText(ch).width
      const mid = dist + cw / 2
      const t = mid * omega + phase
      const px = -halfW + mid
      const py = baseY + Math.sin(t) * amplitude
      const slope = Math.cos(t) * amplitude * omega
      const rot = Math.atan(slope)

      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(rot)
      // shadow
      ctx.fillStyle = color(shadowAlpha)
      ctx.fillText(ch, 1, 1)
      // main
      ctx.fillStyle = color(mainAlpha)
      ctx.fillText(ch, 0, 0)
      ctx.restore()

      dist += cw
    }
  }

  ctx.restore()
}
