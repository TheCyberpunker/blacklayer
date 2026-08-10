import type { RedactionRect } from '../types.ts'

/**
 * Paint redactions onto an existing canvas context. Runs both in the live preview
 * (so the user sees the exact effect) and in the export path (where it becomes
 * destructive because subsequent toBlob/re-encode drops the original pixels).
 *
 * Modes:
 *   solid    - opaque black fill. Safest for sensitive fields.
 *   blur     - gaussian-style blur via canvas filter. May leak information;
 *              recover-from-blur techniques exist.
 *   pixelate - downsample then upsample with nearest-neighbor. Same caveat as
 *              blur regarding partial recoverability.
 */
export function applyRedactionsToCanvas(
  ctx: CanvasRenderingContext2D,
  rects: readonly RedactionRect[],
  width: number,
  height: number,
): void {
  if (!rects.length) return
  const src = ctx.canvas
  for (const r of rects) {
    const rx = Math.round(r.x * width)
    const ry = Math.round(r.y * height)
    const rw = Math.round(r.w * width)
    const rh = Math.round(r.h * height)
    if (rw <= 0 || rh <= 0) continue
    switch (r.mode) {
      case 'solid':
        drawSolid(ctx, rx, ry, rw, rh)
        break
      case 'blur':
        drawBlurred(ctx, src, rx, ry, rw, rh)
        break
      case 'pixelate':
        drawPixelated(ctx, src, rx, ry, rw, rh)
        break
    }
  }
}

function drawSolid(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save()
  ctx.fillStyle = '#000000'
  ctx.fillRect(x, y, w, h)
  ctx.restore()
}

function drawBlurred(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  // Radius scales with region size; clamp so tiny/huge regions still look right.
  const radius = Math.max(6, Math.min(28, Math.min(w, h) / 6))
  const off = document.createElement('canvas')
  off.width = w
  off.height = h
  const offCtx = off.getContext('2d')
  if (!offCtx) return
  // Apply the filter BEFORE drawing so the source pixels get blurred on copy.
  offCtx.filter = `blur(${radius}px)`
  offCtx.drawImage(src, x, y, w, h, 0, 0, w, h)
  offCtx.filter = 'none'
  ctx.save()
  ctx.drawImage(off, x, y)
  ctx.restore()
}

function drawPixelated(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  // Target roughly 24 blocks across the shorter edge, minimum 4px per block.
  const factor = Math.max(4, Math.floor(Math.min(w, h) / 24))
  const smallW = Math.max(1, Math.floor(w / factor))
  const smallH = Math.max(1, Math.floor(h / factor))
  const off = document.createElement('canvas')
  off.width = smallW
  off.height = smallH
  const offCtx = off.getContext('2d')
  if (!offCtx) return
  offCtx.imageSmoothingEnabled = false
  offCtx.drawImage(src, x, y, w, h, 0, 0, smallW, smallH)

  ctx.save()
  const prev = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(off, 0, 0, smallW, smallH, x, y, w, h)
  ctx.imageSmoothingEnabled = prev
  ctx.restore()
}
