import type { RedactionRect } from '../types.ts'

/**
 * Paint solid fills over normalized redaction rectangles on an existing canvas
 * context. This is the destructive step: after this runs, canvas pixel data at
 * the redacted regions is opaque black. Subsequent toBlob/encode drops the
 * original pixels permanently.
 */
export function applyRedactionsToCanvas(
  ctx: CanvasRenderingContext2D,
  rects: readonly RedactionRect[],
  width: number,
  height: number,
): void {
  if (!rects.length) return
  ctx.save()
  ctx.fillStyle = '#000000'
  for (const r of rects) {
    const rx = Math.round(r.x * width)
    const ry = Math.round(r.y * height)
    const rw = Math.round(r.w * width)
    const rh = Math.round(r.h * height)
    if (rw <= 0 || rh <= 0) continue
    ctx.fillRect(rx, ry, rw, rh)
  }
  ctx.restore()
}
