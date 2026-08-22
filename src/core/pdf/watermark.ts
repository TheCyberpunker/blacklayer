import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import type { ProtectionProfile, RedactionRect, WatermarkOptions } from '../types.ts'
import { formatWatermarkLines } from '../types.ts'
import { applyMetadataMode, hasDigitalSignature } from './metadata.ts'
import { rasterizePageWithRedactions } from './rasterize-page.ts'
import { mulberry32 } from '../random/prng.ts'
import { drawWatermarkOnCanvas } from '../watermark/draw.ts'

export interface ApplyPdfWatermarkArgs {
  source: ArrayBuffer
  profile: ProtectionProfile
  lang: 'en' | 'es'
  redactionsByPage?: ReadonlyMap<number, readonly RedactionRect[]>
}

export interface ApplyPdfWatermarkResult {
  bytes: Uint8Array
  hadDigitalSignature: boolean
  rasterizedPages: readonly number[]
}

export async function applyPdfWatermark({
  source,
  profile,
  lang,
  redactionsByPage,
}: ApplyPdfWatermarkArgs): Promise<ApplyPdfWatermarkResult> {
  const pdf = await PDFDocument.load(source, { ignoreEncryption: false, updateMetadata: false })
  const hadSignature = hasDigitalSignature(pdf)
  const rasterized: number[] = []

  if (redactionsByPage && redactionsByPage.size) {
    const indices = Array.from(redactionsByPage.keys()).sort((a, b) => b - a)
    for (const idx of indices) {
      const rects = redactionsByPage.get(idx) ?? []
      if (!rects.length) continue
      await rasterizePageWithRedactions({
        sourceBytes: source,
        sourcePageIndex: idx,
        targetDoc: pdf,
        insertIndex: idx,
        redactions: rects,
      })
      pdf.removePage(idx + 1)
      rasterized.push(idx)
    }
  }

  const font = await pdf.embedFont(StandardFonts.HelveticaBold)
  const options = profile.watermark
  const lines = formatWatermarkLines(options.text, lang)
  const canUseCanvas = typeof document !== 'undefined' && typeof document.createElement === 'function'

  const pages = pdf.getPages()
  for (const page of pages) {
    await drawWatermarkOnPdfPage(pdf, page, font, lines, options, canUseCanvas)
  }

  applyMetadataMode(pdf, profile.metadata)

  const bytes = await pdf.save()
  return { bytes, hadDigitalSignature: hadSignature, rasterizedPages: rasterized.sort((a, b) => a - b) }
}

async function drawWatermarkOnPdfPage(
  pdf: PDFDocument,
  page: ReturnType<PDFDocument['getPages']>[number],
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  lines: string[],
  options: WatermarkOptions,
  canUseCanvas: boolean,
): Promise<void> {
  const { width, height } = page.getSize()
  const { r, g, b } = options.color
  const color = rgb(r, g, b)
  const anyLines = lines.some((l) => l.trim())

  const rowText = anyLines ? lines.filter((l) => l.trim()).join('  ·  ') : ''
  const willTileText = anyLines && options.tile
  const needsCanvasStamp =
    willTileText ||
    options.patterns.iridescent ||
    options.patterns.guilloche ||
    options.patterns.moire

  if (anyLines && !options.tile) {
    drawPdfBlock(page, lines, font, width / 2, height / 2, options.rotationDeg, options.fontSize, options.opacity, color)
  }

  if (needsCanvasStamp) {
    if (canUseCanvas) {
      // Browser export: render wavy + iridescent + guilloche + moire onto one
      // offscreen canvas and embed as a single PNG stamp per page. One drawImage
      // beats thousands of per-glyph text ops and lets the canvas-only overlays
      // (iridescent gradient, guilloche curves, moire fringe) reach the export.
      await drawPdfCanvasStamp(pdf, page, rowText, width, height, options, {
        renderWavy: willTileText,
      })
    } else if (willTileText) {
      // Node / test fallback: per-glyph drawText for wavy. Iridescent and
      // guilloche require canvas 2D, so they're only in the browser export.
      const scaleFactor = Math.min(width, height) / 800
      const fontSize = Math.max(6, options.fontSize * scaleFactor)
      drawPdfWavy(page, font, rowText, width, height, fontSize, options.opacity, color, options.seed, options.rotationDeg)
    }
  }

  if (options.patterns.crosshatch) drawPdfCrosshatch(page, width, height, options, color)
  if (options.patterns.frame) drawPdfFrame(page, width, height, options, color)
}

async function drawPdfCanvasStamp(
  pdf: PDFDocument,
  page: ReturnType<PDFDocument['getPages']>[number],
  text: string,
  pageWidth: number,
  pageHeight: number,
  options: WatermarkOptions,
  flags: { renderWavy: boolean },
): Promise<void> {
  // Render at 2× the page point size so the stamp holds up under viewer zoom.
  const scale = 2
  const w = Math.max(1, Math.floor(pageWidth * scale))
  const h = Math.max(1, Math.floor(pageHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Transparent background so the stamp overlays the source page cleanly.
  const { r, g, b } = options.color
  const rr = Math.round(r * 255)
  const gg = Math.round(g * 255)
  const bb = Math.round(b * 255)
  const colorBase = (alpha: number) => `rgba(${rr}, ${gg}, ${bb}, ${alpha})`

  // The crosshatch and frame layers stay as pdf-lib vector primitives (crisper
  // and smaller than a raster), so we mask them off before delegating the rest
  // to the shared canvas routine. The wavy layer is opt-in per call.
  const stampOptions: WatermarkOptions = {
    ...options,
    patterns: {
      ...options.patterns,
      crosshatch: false,
      frame: false,
    },
    // Force tile so drawWatermarkOnCanvas takes the wavy branch when we want it.
    tile: flags.renderWavy,
  }

  const scaleFactor = Math.min(w, h) / 800
  const effectiveFontSize = Math.max(6, options.fontSize * scaleFactor)
  const lines = flags.renderWavy ? [text] : []

  drawWatermarkOnCanvas({
    ctx,
    width: w,
    height: h,
    lines,
    options: stampOptions,
    effectiveFontSize,
    colorBase,
  })

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
      'image/png',
    )
  })
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer())
  const stamp = await pdf.embedPng(pngBytes)
  page.drawImage(stamp, { x: 0, y: 0, width: pageWidth, height: pageHeight })
}

function drawPdfWavy(
  page: ReturnType<PDFDocument['getPages']>[number],
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  text: string,
  width: number,
  height: number,
  fontSize: number,
  opacity: number,
  color: ReturnType<typeof rgb>,
  seed: number,
  baseRotationDeg: number,
): void {
  const rng = mulberry32(seed || 1)
  const baseRotRad = (baseRotationDeg * Math.PI) / 180
  const cx = width / 2
  const cy = height / 2

  const diag = Math.hypot(width, height)
  const halfW = diag / 2
  const halfH = diag / 2

  // Denser rows and per-glyph shadow would balloon the PDF file size (every
  // drawText emits a text-showing operator). We keep the row gap wider than the
  // canvas preview to trade a small amount of visual density for a much smaller
  // output file, and skip the shadow pass in the PDF path.
  const rowGap = fontSize * 3.2
  const amplitude = fontSize * 1.0
  const wavelength = Math.max(fontSize * 7, width * 0.45)
  const omega = (2 * Math.PI) / wavelength

  const chars = [...(text + '   ')]

  const cosR = Math.cos(baseRotRad)
  const sinR = Math.sin(baseRotRad)
  const toPage = (rx: number, ry: number): { x: number; y: number } => ({
    x: cx + rx * cosR - ry * sinR,
    y: cy + rx * sinR + ry * cosR,
  })

  for (let baseY = -halfH; baseY <= halfH; baseY += rowGap) {
    const yOffset = (rng() - 0.5) * fontSize * 0.15
    const phase = rng() * Math.PI * 2
    let idx = 0
    let dist = 0
    const totalLen = halfW * 2
    while (dist < totalLen) {
      const ch = chars[idx % chars.length] || ' '
      idx++
      const cw = font.widthOfTextAtSize(ch, fontSize)
      const mid = dist + cw / 2
      const t = mid * omega + phase
      const localX = -halfW + mid
      const localY = baseY + yOffset + Math.sin(t) * amplitude
      const slope = Math.cos(t) * amplitude * omega
      const angleLocal = Math.atan(slope)
      const anchorLocalY = localY - fontSize * 0.35
      const anchor = toPage(localX - cw / 2, anchorLocalY)
      page.drawText(ch, {
        x: anchor.x,
        y: anchor.y,
        size: fontSize,
        font,
        color,
        opacity,
        rotate: degrees(((baseRotRad + angleLocal) * 180) / Math.PI),
      })
      dist += cw
    }
  }
}

function drawPdfBlock(
  page: ReturnType<PDFDocument['getPages']>[number],
  lines: string[],
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  cx: number,
  cy: number,
  rotDeg: number,
  fontSize: number,
  opacity: number,
  color: ReturnType<typeof rgb>,
): void {
  const lineHeight = fontSize * 1.2
  const blockHeight = lines.length * lineHeight
  const startY = cy + blockHeight / 2 - lineHeight
  const rot = degrees(rotDeg)
  lines.forEach((text, i) => {
    if (!text) return
    const textWidth = font.widthOfTextAtSize(text, fontSize)
    page.drawText(text, {
      x: cx - textWidth / 2,
      y: startY - i * lineHeight,
      size: fontSize,
      font,
      color,
      opacity,
      rotate: rot,
    })
  })
}

function drawPdfCrosshatch(
  page: ReturnType<PDFDocument['getPages']>[number],
  width: number,
  height: number,
  options: WatermarkOptions,
  color: ReturnType<typeof rgb>,
): void {
  const scaleFactor = Math.min(width, height) / 800
  const spacing = Math.max(14, 20 * scaleFactor)
  const alpha = Math.max(0.12, Math.min(0.32, options.opacity * 0.55))
  const thickness = Math.max(0.9, 1.3 * scaleFactor)
  const diagonal = Math.hypot(width, height)
  const cx = width / 2
  const cy = height / 2

  const drawLines = (angleDeg: number, step: number) => {
    const a = (angleDeg * Math.PI) / 180
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    for (let y = -diagonal; y <= diagonal; y += step) {
      // Endpoints in local (unrotated) space, then rotated + translated.
      const x1 = -diagonal
      const y1 = y
      const x2 = diagonal
      const y2 = y
      const px1 = cx + x1 * cos - y1 * sin
      const py1 = cy + x1 * sin + y1 * cos
      const px2 = cx + x2 * cos - y2 * sin
      const py2 = cy + x2 * sin + y2 * cos
      page.drawLine({
        start: { x: px1, y: py1 },
        end: { x: px2, y: py2 },
        thickness,
        color,
        opacity: alpha,
      })
    }
  }

  drawLines(30, spacing)
  drawLines(-60, spacing * 1.4)
}

function drawPdfFrame(
  page: ReturnType<PDFDocument['getPages']>[number],
  width: number,
  height: number,
  options: WatermarkOptions,
  color: ReturnType<typeof rgb>,
): void {
  const scaleFactor = Math.min(width, height) / 800
  const margin = Math.max(14, 24 * scaleFactor)
  const gap = Math.max(3, 5 * scaleFactor)
  const thickness = Math.max(0.6, 1.2 * scaleFactor)
  const alpha = Math.min(1, options.opacity * 1.4)

  const rect = (m: number) => {
    const w = width - m * 2
    const h = height - m * 2
    if (w <= 0 || h <= 0) return
    page.drawRectangle({
      x: m,
      y: m,
      width: w,
      height: h,
      borderColor: color,
      borderWidth: thickness,
      borderOpacity: alpha,
      color: undefined,
      opacity: 0,
    })
  }

  rect(margin)
  rect(margin + gap)
}

export async function inspectPdf(source: ArrayBuffer): Promise<{ hasSignature: boolean; pageCount: number }> {
  const pdf = await PDFDocument.load(source, { ignoreEncryption: false, updateMetadata: false })
  return {
    hasSignature: hasDigitalSignature(pdf),
    pageCount: pdf.getPageCount(),
  }
}
